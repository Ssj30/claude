import db from "../db.server";
import { gql, setAppMetafield, setProductMetafields, type Admin } from "./admin.server";
import { LOOX_FEED_QUERY, PRODUCTS_BY_ID_QUERY } from "./queries";

/** Product metafield namespace the reviews theme blocks read. */
export const REVIEWS_NAMESPACE = "toolkit_reviews";

export type ReviewStatus = "pending" | "published" | "hidden";

export function summarize(ratings: number[]) {
  const count = ratings.length;
  const average = count ? ratings.reduce((a, b) => a + b, 0) / count : 0;
  const histogram = [1, 2, 3, 4, 5].map((star) => ratings.filter((r) => r === star).length);
  return { count, average: Math.round(average * 10) / 10, histogram };
}

/**
 * Rewrites the star summary and the latest published reviews onto each
 * product, so the theme can show them without calling the app.
 */
export async function syncProductReviews(
  admin: Admin,
  shop: string,
  productIds: string[],
) {
  const unique = [...new Set(productIds)].filter(Boolean);
  if (!unique.length) return;
  const metafields = [];
  for (const productId of unique) {
    const published = await db.review.findMany({
      where: { shop, productId, status: "published" },
      orderBy: { createdAt: "desc" },
    });
    const summary = summarize(published.map((r) => r.rating));
    metafields.push(
      {
        ownerId: productId,
        namespace: REVIEWS_NAMESPACE,
        key: "summary",
        type: "json",
        value: JSON.stringify(summary),
      },
      {
        ownerId: productId,
        namespace: REVIEWS_NAMESPACE,
        key: "list",
        type: "json",
        value: JSON.stringify(
          published.slice(0, 30).map((r) => ({
            rating: r.rating,
            title: r.title,
            // Keeps the metafield well under Shopify's size limit.
            body: r.body.slice(0, 1000),
            author: r.author,
            date: r.createdAt.toISOString().slice(0, 10),
            verified: r.verified,
          })),
        ),
      },
    );
  }
  await setProductMetafields(admin, metafields);
  await syncFeaturedReviews(admin, shop);
}

/** Shop-wide rating plus the best recent reviews, for the homepage carousel. */
export async function syncFeaturedReviews(admin: Admin, shop: string) {
  const all = await db.review.findMany({
    where: { shop, status: "published" },
    orderBy: { createdAt: "desc" },
    select: {
      rating: true,
      title: true,
      body: true,
      author: true,
      createdAt: true,
      verified: true,
      productTitle: true,
      productHandle: true,
    },
  });
  const { count, average } = summarize(all.map((r) => r.rating));
  await setAppMetafield(admin, "featured_reviews", {
    count,
    average,
    reviews: all
      .filter((r) => r.rating >= 4)
      .slice(0, 16)
      .map((r) => ({
        rating: r.rating,
        title: r.title,
        body: r.body.slice(0, 400),
        author: r.author,
        date: r.createdAt.toISOString().slice(0, 10),
        verified: r.verified,
        product: r.productTitle,
        handle: r.productHandle,
      })),
  });
}

interface LooxReview {
  id: string;
  rating: number;
  review: string;
  author: string;
  date: string;
  verified?: boolean;
  product?: { id?: string | number };
}

/** Reviews in the old Loox feed that aren't imported yet. */
export async function pendingLooxImports(admin: Admin, shop: string) {
  let feed: LooxReview[] = [];
  try {
    const data = await gql(admin, LOOX_FEED_QUERY);
    feed = (data.shop.metafield?.jsonValue?.reviews ?? []) as LooxReview[];
  } catch {
    return [];
  }
  const existing = await db.review.findMany({
    where: { shop, source: "loox" },
    select: { externalId: true },
  });
  const seen = new Set(existing.map((e) => e.externalId));
  return feed.filter((r) => r.id && r.product?.id && !seen.has(`loox:${r.id}`));
}

export async function importLooxReviews(admin: Admin, shop: string) {
  const todo = await pendingLooxImports(admin, shop);
  if (!todo.length) return 0;
  const ids = [...new Set(todo.map((r) => `gid://shopify/Product/${r.product!.id}`))];
  const data = await gql(admin, PRODUCTS_BY_ID_QUERY, { ids });
  const products = new Map<string, { title: string; handle: string }>();
  for (const node of data.nodes ?? []) {
    if (node?.id) products.set(node.id, { title: node.title, handle: node.handle });
  }
  let imported = 0;
  for (const r of todo) {
    const productId = `gid://shopify/Product/${r.product!.id}`;
    const product = products.get(productId);
    if (!product) continue; // product was deleted
    await db.review.create({
      data: {
        shop,
        productId,
        productTitle: product.title,
        productHandle: product.handle,
        rating: Math.min(5, Math.max(1, Math.round(r.rating))),
        body: r.review ?? "",
        author: r.author || "Customer",
        status: "published",
        source: "loox",
        externalId: `loox:${r.id}`,
        verified: !!r.verified,
        createdAt: r.date ? new Date(r.date) : new Date(),
      },
    });
    imported++;
  }
  await syncProductReviews(admin, shop, [...products.keys()]);
  return imported;
}

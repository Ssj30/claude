import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getSettings, gql } from "../lib/admin.server";
import { PRODUCTS_BY_ID_QUERY } from "../lib/queries";
import { syncProductReviews } from "../lib/reviews.server";

// Storefront review form posts to /apps/toolkit/reviews, which Shopify
// forwards here with a signature that authenticate.public.appProxy checks.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.public.appProxy(request);
  if (!session || !admin) {
    return Response.json({ ok: false, error: "App not installed" }, { status: 400 });
  }
  const shop = session.shop;
  const settings = await getSettings(shop, "reviews");
  if (!settings.acceptSubmissions) {
    return Response.json({ ok: false, error: "Reviews are closed" }, { status: 403 });
  }

  const form = await request.formData();
  // Bots fill every field; people never see this one.
  if (String(form.get("website") ?? "")) {
    return Response.json({ ok: true, status: "pending" });
  }
  const productId = String(form.get("product_id") ?? "");
  const rating = Number(form.get("rating"));
  const author = String(form.get("author") ?? "").trim().slice(0, 60);
  const title = String(form.get("title") ?? "").trim().slice(0, 120);
  const body = String(form.get("body") ?? "").trim().slice(0, 3000);
  const email = String(form.get("email") ?? "").trim().slice(0, 120);

  if (!/^\d+$/.test(productId) || !(rating >= 1 && rating <= 5) || !author || body.length < 3) {
    return Response.json(
      { ok: false, error: "Please add a star rating, your name and a few words." },
      { status: 400 },
    );
  }

  // Simple flood guard: max 5 reviews per product per hour.
  const recent = await db.review.count({
    where: {
      shop,
      productId: `gid://shopify/Product/${productId}`,
      createdAt: { gte: new Date(Date.now() - 3600 * 1000) },
    },
  });
  if (recent >= 5) {
    return Response.json({ ok: false, error: "Please try again later." }, { status: 429 });
  }

  // Take the product name from Shopify, not from the form.
  const found = await gql(admin, PRODUCTS_BY_ID_QUERY, {
    ids: [`gid://shopify/Product/${productId}`],
  });
  const product = found.nodes?.[0];
  if (!product?.id) {
    return Response.json({ ok: false, error: "Unknown product" }, { status: 400 });
  }

  const autoPublish = settings.autoPublishMin > 0 && rating >= settings.autoPublishMin;
  const review = await db.review.create({
    data: {
      shop,
      productId: `gid://shopify/Product/${productId}`,
      productTitle: product.title,
      productHandle: product.handle,
      rating: Math.round(rating),
      title,
      body,
      author,
      email,
      status: autoPublish ? "published" : "pending",
      source: "form",
    },
  });
  if (autoPublish) await syncProductReviews(admin, shop, [review.productId]);

  return Response.json({ ok: true, status: review.status });
};

import { useEffect, useRef } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  getSettings,
  getThemeStatus,
  gql,
  saveSettingsFromForm,
} from "../lib/admin.server";
import { isLiveInTheme } from "../lib/modules";
import { PRODUCT_SEARCH_QUERY } from "../lib/queries";
import {
  importLooxReviews,
  pendingLooxImports,
  summarize,
  syncProductReviews,
} from "../lib/reviews.server";
import { parseReviewRows } from "../lib/reviewImport";
import { date, num, plural } from "../lib/format";
import { ConfirmDelete, ModuleIntro, StatGrid } from "../components/ui";
import {
  type ActionResult,
  errorResult,
  SettingsForm,
  useActionFetcher,
} from "../components/SettingsForm";

const FILTERS = [
  { key: "pending", label: "Waiting for approval" },
  { key: "published", label: "Published" },
  { key: "hidden", label: "Hidden" },
  { key: "all", label: "All" },
] as const;
type Filter = (typeof FILTERS)[number]["key"];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const pendingCount = await db.review.count({ where: { shop, status: "pending" } });
  const requested = url.searchParams.get("status") as Filter | null;
  const filter: Filter =
    requested && FILTERS.some((f) => f.key === requested)
      ? requested
      : pendingCount
        ? "pending"
        : "published";

  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const [settings, themeStatus, published, last30, reviews, products, loox] =
    await Promise.all([
      getSettings(shop, "reviews"),
      getThemeStatus(admin),
      db.review.findMany({
        where: { shop, status: "published" },
        select: { rating: true },
      }),
      db.review.count({ where: { shop, createdAt: { gte: since } } }),
      db.review.findMany({
        where: { shop, ...(filter === "all" ? {} : { status: filter }) },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      gql(admin, PRODUCT_SEARCH_QUERY, { query: "status:active" }),
      pendingLooxImports(admin, shop),
    ]);

  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    shop: session.shop,
    settings,
    themeStatus,
    filter,
    pendingCount,
    last30,
    summary: summarize(published.map((p) => p.rating)),
    reviews: reviews.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    products: products.products.nodes as { id: string; title: string; handle: string }[],
    looxAvailable: loox.length,
  };
};

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionResult> => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const intent = String(form.get("intent"));

  try {
    switch (intent) {
      case "save":
        return saveSettingsFromForm(admin, shop, "reviews", form);

      case "publish":
      case "hide":
      case "delete": {
        const id = String(form.get("id"));
        const review = await db.review.findFirst({ where: { id, shop } });
        if (!review) return { ok: false, intent, error: "Review not found" };
        if (intent === "delete") {
          await db.review.delete({ where: { id } });
        } else {
          await db.review.update({
            where: { id },
            data: { status: intent === "publish" ? "published" : "hidden" },
          });
        }
        await syncProductReviews(admin, shop, [review.productId]);
        const done = { publish: "Review published", hide: "Review hidden", delete: "Review deleted" };
        return { ok: true, intent, message: done[intent] };
      }

      case "publish-all": {
        const pending = await db.review.findMany({ where: { shop, status: "pending" } });
        await db.review.updateMany({
          where: { shop, status: "pending" },
          data: { status: "published" },
        });
        await syncProductReviews(admin, shop, pending.map((p) => p.productId));
        return { ok: true, intent, message: `${plural(pending.length, "review")} published` };
      }

      case "add": {
        const productId = String(form.get("productId"));
        const rating = Number(form.get("rating"));
        const body = String(form.get("body") ?? "").trim();
        const author = String(form.get("author") ?? "").trim();
        const errors: Record<string, string> = {};
        if (!productId) errors.productId = "Pick a product";
        if (!(rating >= 1 && rating <= 5)) errors.rating = "Pick 1 to 5 stars";
        if (!body) errors.body = "Write the review text";
        if (!author) errors.author = "Add a name";
        if (Object.keys(errors).length) return { ok: false, intent, errors };
        const products = await gql(admin, PRODUCT_SEARCH_QUERY, { query: "status:active" });
        const product = products.products.nodes.find((p: { id: string }) => p.id === productId);
        if (!product) return { ok: false, intent, error: "Product not found" };
        await db.review.create({
          data: {
            shop,
            productId,
            productTitle: product.title,
            productHandle: product.handle,
            rating,
            title: String(form.get("title") ?? "").trim(),
            body,
            author,
            status: "published",
            source: "manual",
          },
        });
        await syncProductReviews(admin, shop, [productId]);
        return { ok: true, intent, message: "Review added" };
      }

      case "import-loox": {
        const count = await importLooxReviews(admin, shop);
        return { ok: true, intent, message: `${plural(count, "review")} imported from Loox` };
      }

      case "import-csv": {
        const parsed = parseReviewRows(String(form.get("csv") ?? ""));
        if (!parsed.rows.length) {
          return { ok: false, intent, error: parsed.errors.join(" ") || "Nothing to import" };
        }
        const handles = [...new Set(parsed.rows.map((r) => r.handle))];
        const found = await gql(admin, PRODUCT_SEARCH_QUERY, {
          query: handles.map((h) => `handle:${h}`).join(" OR "),
        });
        const byHandle = new Map<string, { id: string; title: string; handle: string }>(
          found.products.nodes.map((p: { id: string; title: string; handle: string }) => [p.handle, p]),
        );
        let imported = 0;
        const unknown = new Set<string>();
        for (const row of parsed.rows) {
          const product = byHandle.get(row.handle);
          if (!product) {
            unknown.add(row.handle);
            continue;
          }
          await db.review.create({
            data: {
              shop,
              productId: product.id,
              productTitle: product.title,
              productHandle: product.handle,
              rating: row.rating,
              title: row.title,
              body: row.body,
              author: row.author,
              status: "published",
              source: "import",
              ...(row.date ? { createdAt: new Date(row.date) } : {}),
            },
          });
          imported++;
        }
        await syncProductReviews(admin, shop, [...byHandle.values()].map((p) => p.id));
        const skipped = parsed.errors.length + [...unknown].length;
        return {
          ok: true,
          intent,
          message:
            `${plural(imported, "review")} imported` +
            (skipped ? `, ${skipped} skipped${unknown.size ? ` (unknown products: ${[...unknown].slice(0, 3).join(", ")})` : ""}` : ""),
        };
      }
    }
  } catch (error) {
    return errorResult(error, intent);
  }
  return { ok: false, intent, error: "Unknown action" };
};

export default function Reviews() {
  const data = useLoaderData<typeof loader>();
  const { settings, summary, filter, reviews, pendingCount } = data;
  const actions = useActionFetcher();
  const inTheme = isLiveInTheme("reviews", data.themeStatus);

  return (
    <s-page heading="Reviews" inlineSize="large">
      {pendingCount > 1 && (
        <s-button
          slot="primary-action"
          variant="primary"
          onClick={() => actions.run("publish-all")}
          {...(actions.busy("publish-all") ? { loading: true } : {})}
        >
          Publish all {num(pendingCount)} waiting
        </s-button>
      )}

      <ModuleIntro
        module="reviews"
        apiKey={data.apiKey}
        shop={data.shop}
        themeStatus={data.themeStatus}
        status={
          pendingCount
            ? { label: `${plural(pendingCount, "review")} to approve`, tone: "warning" }
            : inTheme === false
              ? { label: "Not on product pages yet", tone: "warning" }
              : { label: "Collecting reviews", tone: "success" }
        }
      />

      <s-section heading="Overview">
        <StatGrid
          items={[
            {
              label: "Average rating",
              value: summary.count ? `${summary.average.toFixed(1)} ★` : "—",
              hint: summary.count ? `from ${plural(summary.count, "review")}` : "No published reviews yet",
            },
            { label: "Published", value: num(summary.count) },
            {
              label: "Waiting for approval",
              value: num(pendingCount),
              tone: pendingCount ? "warning" : undefined,
            },
            { label: "New in the last 30 days", value: num(data.last30) },
          ]}
        />
        {summary.count > 0 && (
          <s-box paddingBlockStart="base">
            <s-stack gap="small-200">
              {[5, 4, 3, 2, 1].map((star) => {
                const n = summary.histogram[star - 1];
                return (
                  <s-grid key={star} gridTemplateColumns="40px 1fr 40px" gap="small" alignItems="center">
                    <s-text>{star} ★</s-text>
                    <s-progress value={n} max={summary.count} accessibilityLabel={`${n} reviews with ${star} stars`} />
                    <s-text color="subdued">{num(n)}</s-text>
                  </s-grid>
                );
              })}
            </s-stack>
          </s-box>
        )}
      </s-section>

      <s-section padding="none">
        <s-box padding="base">
          <s-stack direction="inline" gap="small">
            {FILTERS.map((f) => (
              <s-button
                key={f.key}
                variant={f.key === filter ? "primary" : "secondary"}
                href={`/app/reviews?status=${f.key}`}
              >
                {f.label}
                {f.key === "pending" && pendingCount ? ` (${pendingCount})` : ""}
              </s-button>
            ))}
          </s-stack>
        </s-box>
        {reviews.length === 0 ? (
          <s-box padding="base">
            <s-text color="subdued">
              {filter === "pending" ? "Nothing to approve. 🎉" : "No reviews here yet."}
            </s-text>
          </s-box>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Review</s-table-header>
              <s-table-header listSlot="secondary">Product</s-table-header>
              <s-table-header>Date</s-table-header>
              <s-table-header listSlot="inline">Status</s-table-header>
              <s-table-header>Actions</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {reviews.map((r) => (
                <s-table-row key={r.id}>
                  <s-table-cell>
                    <s-stack gap="small-300">
                      <s-text>
                        <span style={{ color: settings.starColor, letterSpacing: 1 }}>
                          {"★".repeat(r.rating)}
                        </span>
                        <span style={{ color: "#c9c9c9", letterSpacing: 1 }}>{"★".repeat(5 - r.rating)}</span>
                        {r.title ? <strong> {r.title}</strong> : null}
                      </s-text>
                      <s-paragraph lineClamp={3}>{r.body}</s-paragraph>
                      <s-text color="subdued">
                        {r.author}
                        {r.verified ? " · Verified buyer" : ""}
                        {r.source !== "form" ? ` · ${sourceLabel(r.source)}` : ""}
                      </s-text>
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>{r.productTitle}</s-table-cell>
                  <s-table-cell>{date(r.createdAt)}</s-table-cell>
                  <s-table-cell>
                    <s-badge
                      tone={
                        r.status === "published" ? "success" : r.status === "pending" ? "warning" : "neutral"
                      }
                    >
                      {r.status === "published" ? "Published" : r.status === "pending" ? "Waiting" : "Hidden"}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    <s-button-group>
                      {r.status !== "published" && (
                        <s-button slot="secondary-actions" onClick={() => actions.run("publish", { id: r.id })}>
                          Publish
                        </s-button>
                      )}
                      {r.status !== "hidden" && (
                        <s-button slot="secondary-actions" onClick={() => actions.run("hide", { id: r.id })}>
                          Hide
                        </s-button>
                      )}
                      <ConfirmDelete
                        id={r.id}
                        label="Delete review"
                        heading="Delete this review?"
                        message="It's removed for good. Use Hide instead if you might want it back."
                        onConfirm={() => actions.run("delete", { id: r.id })}
                      />
                    </s-button-group>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section slot="aside" heading="Settings">
        <SettingsForm>
          {(errors) => (
            <>
              <s-switch
                label="Let shoppers write reviews on product pages"
                name="acceptSubmissions"
                defaultChecked={settings.acceptSubmissions}
              />
              <s-select
                label="New reviews from shoppers"
                name="autoPublishMin"
                value={String(settings.autoPublishMin)}
                error={errors.autoPublishMin}
              >
                <s-option value="0">Wait for my approval</s-option>
                <s-option value="5">Publish 5★ right away, others wait</s-option>
                <s-option value="4">Publish 4★ and 5★ right away, others wait</s-option>
                <s-option value="1">Publish everything right away</s-option>
              </s-select>
              <s-text-field label="Heading on product page" name="heading" defaultValue={settings.heading} />
              <s-color-field
                label="Star colour"
                name="starColor"
                defaultValue={settings.starColor}
                error={errors.starColor}
              />
              <s-switch
                label="Show the “Write a review” form"
                name="showForm"
                defaultChecked={settings.showForm}
              />
            </>
          )}
        </SettingsForm>
      </s-section>

      <s-section slot="aside" heading="Add a review">
        <AddReviewForm products={data.products} />
      </s-section>

      <s-section slot="aside" heading="Import reviews">
        <s-stack gap="base">
          {data.looxAvailable > 0 && (
            <s-stack gap="small">
              <s-paragraph>
                Found {plural(data.looxAvailable, "review")} from Loox that you can bring over.
              </s-paragraph>
              <s-button
                onClick={() => actions.run("import-loox")}
                {...(actions.busy("import-loox") ? { loading: true } : {})}
              >
                Import from Loox
              </s-button>
            </s-stack>
          )}
          <CsvImport />
        </s-stack>
      </s-section>
    </s-page>
  );
}

function AddReviewForm({ products }: { products: { id: string; title: string }[] }) {
  const fetcher = useFetcher<ActionResult>();
  const formRef = useRef<HTMLFormElement>(null);
  const result = fetcher.data?.intent === "add" ? fetcher.data : undefined;
  const errors = result?.errors ?? {};
  const busy = fetcher.state !== "idle";
  useEffect(() => {
    if (fetcher.state === "idle" && result?.ok) formRef.current?.reset();
  }, [fetcher.state, result]);
  return (
    <fetcher.Form method="post" ref={formRef}>
      <input type="hidden" name="intent" value="add" />
      <s-stack gap="base">
        {result?.ok && <s-banner tone="success">Review added and published.</s-banner>}
        {result && !result.ok && result.error && <s-banner tone="critical">{result.error}</s-banner>}
        <s-select label="Product" name="productId" placeholder="Choose a product" error={errors.productId}>
          {products.map((p) => (
            <s-option key={p.id} value={p.id}>
              {p.title}
            </s-option>
          ))}
        </s-select>
        <s-select label="Rating" name="rating" value="5" error={errors.rating}>
          {[5, 4, 3, 2, 1].map((n) => (
            <s-option key={n} value={String(n)}>
              {"★".repeat(n)} ({n})
            </s-option>
          ))}
        </s-select>
        <s-text-field label="Name" name="author" error={errors.author} />
        <s-text-field label="Title (optional)" name="title" />
        <s-text-area label="Review" name="body" rows={3} error={errors.body} />
        <s-button type="submit" {...(busy ? { loading: true } : {})}>
          Add review
        </s-button>
      </s-stack>
    </fetcher.Form>
  );
}

function CsvImport() {
  const fetcher = useFetcher<ActionResult>();
  const result = fetcher.data?.intent === "import-csv" ? fetcher.data : undefined;
  return (
    <fetcher.Form method="post">
      <input type="hidden" name="intent" value="import-csv" />
      <s-stack gap="small">
        {result?.ok && <s-banner tone="success">{result.message}</s-banner>}
        {result && !result.ok && <s-banner tone="critical">{result.error}</s-banner>}
        <s-text-area
          label="Paste from a spreadsheet or CSV"
          name="csv"
          rows={4}
          placeholder={"product_handle,rating,author,title,body,date\nporsche-911-turbo,5,Anna,Love it,Great gift!,2026-09-01"}
          details="Columns: product_handle (or product URL), rating, author, title, body, date. Imported reviews are published."
        />
        <s-button type="submit" {...(fetcher.state !== "idle" ? { loading: true } : {})}>
          Import
        </s-button>
      </s-stack>
    </fetcher.Form>
  );
}

function sourceLabel(source: string) {
  return source === "loox" ? "Imported from Loox" : source === "import" ? "Imported" : "Added by you";
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

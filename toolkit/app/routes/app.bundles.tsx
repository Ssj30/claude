import { useEffect, useRef } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import {
  assertNoUserErrors,
  getSettings,
  getShopInfo,
  getThemeStatus,
  gql,
  saveSettingsFromForm,
  setAppMetafield,
  type Admin,
} from "../lib/admin.server";
import { isLiveInTheme } from "../lib/modules";
import {
  APP_INSTALLATION_QUERY,
  AUTOMATIC_DISCOUNTS_QUERY,
  COLLECTIONS_QUERY,
  DISCOUNT_AUTOMATIC_ACTIVATE,
  DISCOUNT_AUTOMATIC_BASIC_CREATE,
  DISCOUNT_AUTOMATIC_DEACTIVATE,
  DISCOUNT_AUTOMATIC_DELETE,
} from "../lib/queries";
import { storefrontTiers, type Tier, tiersFromDiscountNodes, tierTitle } from "../lib/bundles";
import { recentOrders } from "../lib/salesKit.server";
import { money, num, pct } from "../lib/format";
import { ConfirmDelete, ModuleIntro, StatGrid, useFormValues } from "../components/ui";
import {
  type ActionResult,
  errorResult,
  SettingsForm,
  useActionFetcher,
} from "../components/SettingsForm";

async function loadTiers(admin: Admin) {
  const data = await gql(admin, AUTOMATIC_DISCOUNTS_QUERY);
  return tiersFromDiscountNodes(data.discountNodes.nodes);
}

/** Keeps the storefront table in step with the discounts, even if edited in Shopify. */
async function syncStorefrontTiers(admin: Admin, tiers?: Tier[]) {
  const list = tiers ?? (await loadTiers(admin));
  const value = storefrontTiers(list);
  const current = await gql(admin, APP_INSTALLATION_QUERY);
  const stored = current.currentAppInstallation.metafields.nodes.find(
    (m: { key: string }) => m.key === "bundle_tiers",
  )?.jsonValue;
  if (JSON.stringify(stored) !== JSON.stringify(value)) {
    await setAppMetafield(admin, "bundle_tiers", value);
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const [settings, shop, themeStatus, tiers, collections, orders] = await Promise.all([
    getSettings(session.shop, "bundles"),
    getShopInfo(admin),
    getThemeStatus(admin),
    loadTiers(admin),
    gql(admin, COLLECTIONS_QUERY),
    recentOrders(admin, `created_at:>='${since}' AND test:false`),
  ]);
  await syncStorefrontTiers(admin, tiers);

  const titles = new Set(tiers.map((t) => t.title));
  const bundleOrders = orders.filter((o) =>
    o.discountApplications.nodes.some((d) => d.title && titles.has(d.title)),
  );
  const bundleRevenue = bundleOrders.reduce(
    (sum, o) => sum + Number(o.totalPriceSet.shopMoney.amount),
    0,
  );

  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    shop: session.shop,
    settings,
    currency: shop.currency,
    themeStatus,
    tiers,
    collections: collections.collections.nodes as { id: string; title: string; handle: string }[],
    stats: {
      orders: orders.length,
      bundleOrders: bundleOrders.length,
      bundleRevenue,
    },
  };
};

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionResult> => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  try {
    switch (intent) {
      case "save":
        return saveSettingsFromForm(admin, session.shop, "bundles", form);

      case "create": {
        const minQty = Math.round(Number(form.get("minQty")));
        const percent = Number(String(form.get("percent")).replace(",", "."));
        const collectionId = String(form.get("collectionId") ?? "");
        const errors: Record<string, string> = {};
        if (!(minQty >= 2)) errors.minQty = "Use 2 or more";
        if (!(percent > 0 && percent < 100)) errors.percent = "Use 1 to 99";
        if (Object.keys(errors).length) return { ok: false, intent, errors };
        const result = await gql(admin, DISCOUNT_AUTOMATIC_BASIC_CREATE, {
          discount: {
            title: tierTitle(minQty, percent),
            startsAt: new Date().toISOString(),
            minimumRequirement: { quantity: { greaterThanOrEqualToQuantity: String(minQty) } },
            customerGets: {
              value: { percentage: percent / 100 },
              items: collectionId ? { collections: { add: [collectionId] } } : { all: true },
            },
            combinesWith: { orderDiscounts: false, productDiscounts: false, shippingDiscounts: true },
          },
        });
        assertNoUserErrors(result.discountAutomaticBasicCreate);
        await syncStorefrontTiers(admin);
        return { ok: true, intent, message: "Offer created" };
      }

      case "activate":
      case "deactivate":
      case "delete": {
        const id = String(form.get("id"));
        const mutation = {
          activate: DISCOUNT_AUTOMATIC_ACTIVATE,
          deactivate: DISCOUNT_AUTOMATIC_DEACTIVATE,
          delete: DISCOUNT_AUTOMATIC_DELETE,
        }[intent];
        const result = await gql(admin, mutation, { id });
        assertNoUserErrors(
          result.discountAutomaticActivate ??
            result.discountAutomaticDeactivate ??
            result.discountAutomaticDelete,
        );
        await syncStorefrontTiers(admin);
        const done = { activate: "Offer switched on", deactivate: "Offer paused", delete: "Offer deleted" };
        return { ok: true, intent, message: done[intent] };
      }
    }
  } catch (error) {
    return errorResult(error, intent);
  }
  return { ok: false, intent, error: "Unknown action" };
};

export default function BundleDeals() {
  const { apiKey, shop, settings, currency, themeStatus, tiers, collections, stats } =
    useLoaderData<typeof loader>();
  const actions = useActionFetcher();
  const formRef = useRef<HTMLFormElement>(null);
  const live = useFormValues(formRef, settings);
  const active = tiers.filter((t) => t.status === "ACTIVE");

  return (
    <s-page heading="Bundle Deals">
      <ModuleIntro
        module="bundles"
        apiKey={apiKey}
        shop={shop}
        themeStatus={themeStatus}
        status={
          active.length === 0
            ? { label: "No active offers", tone: "neutral" }
            : isLiveInTheme("bundles", themeStatus) === false
              ? { label: `${active.length} active · table not on product page`, tone: "warning" }
              : { label: `${active.length} active`, tone: "success" }
        }
      />

      <s-section heading="Last 30 days">
        <StatGrid
          items={[
            {
              label: "Orders with a bundle discount",
              value: num(stats.bundleOrders),
              hint: stats.orders ? `${pct((stats.bundleOrders / stats.orders) * 100)} of ${num(stats.orders)} orders` : undefined,
            },
            { label: "Revenue from those orders", value: money(stats.bundleRevenue, currency) },
            { label: "Active offers", value: num(active.length) },
          ]}
        />
      </s-section>

      <s-section heading="Your offers" padding="none">
        {tiers.length === 0 ? (
          <s-box padding="base">
            <s-text color="subdued">No volume offers yet. Create your first one below.</s-text>
          </s-box>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Offer</s-table-header>
              <s-table-header listSlot="secondary">Applies to</s-table-header>
              <s-table-header format="numeric">Times used</s-table-header>
              <s-table-header listSlot="inline">Status</s-table-header>
              <s-table-header>Actions</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {tiers.map((t) => (
                <s-table-row key={t.id}>
                  <s-table-cell>
                    <s-stack gap="none">
                      <s-text type="strong">
                        Buy {t.minQty}+ → {t.percent}% off
                      </s-text>
                      <s-text color="subdued">{t.title}</s-text>
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>
                    {t.collections.length ? t.collections.map((c) => c.title).join(", ") : "All products"}
                  </s-table-cell>
                  <s-table-cell>{num(t.usage)}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={t.status === "ACTIVE" ? "success" : t.status === "EXPIRED" ? "neutral" : "warning"}>
                      {t.status === "ACTIVE" ? "Active" : t.status === "EXPIRED" ? "Expired" : "Paused"}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    <s-button-group>
                      {t.status === "ACTIVE" ? (
                        <s-button slot="secondary-actions" onClick={() => actions.run("deactivate", { id: t.id })}>
                          Pause
                        </s-button>
                      ) : (
                        <s-button slot="secondary-actions" onClick={() => actions.run("activate", { id: t.id })}>
                          Switch on
                        </s-button>
                      )}
                      <s-button
                        slot="secondary-actions"
                        href={`shopify://admin/discounts/${t.id.split("/").pop()}`}
                      >
                        Edit
                      </s-button>
                      <ConfirmDelete
                        id={t.id}
                        label="Delete offer"
                        heading={`Delete “${t.title}”?`}
                        message="Shoppers lose this discount right away. Use Pause if you only want to stop it for now."
                        onConfirm={() => actions.run("delete", { id: t.id })}
                      />
                    </s-button-group>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section heading="Add an offer">
        <NewTierForm collections={collections} />
      </s-section>

      <s-section heading="Offer table on product pages">
        <SettingsForm formRef={formRef}>
          {(errors) => (
            <>
              <s-grid gridTemplateColumns="2fr 1fr" gap="base">
                <s-text-field label="Heading" name="heading" defaultValue={settings.heading} />
                <s-color-field
                  label="Highlight colour"
                  name="highlightColor"
                  defaultValue={settings.highlightColor}
                  error={errors.highlightColor}
                />
              </s-grid>
              <s-text-area label="Note under the heading" name="note" rows={2} defaultValue={settings.note} />
              <TierTablePreview
                heading={String(live.heading)}
                note={String(live.note)}
                color={String(live.highlightColor)}
                tiers={active}
              />
            </>
          )}
        </SettingsForm>
      </s-section>
    </s-page>
  );
}

function NewTierForm({ collections }: { collections: { id: string; title: string }[] }) {
  const fetcher = useFetcher<ActionResult>();
  const formRef = useRef<HTMLFormElement>(null);
  const result = fetcher.data?.intent === "create" ? fetcher.data : undefined;
  const errors = result?.errors ?? {};
  useEffect(() => {
    if (fetcher.state === "idle" && result?.ok) formRef.current?.reset();
  }, [fetcher.state, result]);
  return (
    <fetcher.Form method="post" ref={formRef}>
      <input type="hidden" name="intent" value="create" />
      <s-stack gap="base">
        {result?.ok && <s-banner tone="success">Offer created. It applies at checkout right away.</s-banner>}
        {result && !result.ok && result.error && <s-banner tone="critical">{result.error}</s-banner>}
        <s-grid gridTemplateColumns="1fr 1fr 2fr" gap="base" alignItems="end">
          <s-number-field label="When buying at least" name="minQty" min={2} suffix="items" defaultValue="2" error={errors.minQty} />
          <s-number-field label="Discount" name="percent" min={1} max={99} suffix="%" defaultValue="10" error={errors.percent} />
          <s-select label="On" name="collectionId">
            <s-option value="">All products</s-option>
            {collections.map((c) => (
              <s-option key={c.id} value={c.id}>
                Collection: {c.title}
              </s-option>
            ))}
          </s-select>
        </s-grid>
        <s-text color="subdued">
          {"Creates an automatic discount in Shopify. Shoppers don't need a code. It won't stack with other product or order discounts."}
        </s-text>
        <s-stack direction="inline">
          <s-button type="submit" variant="primary" {...(fetcher.state !== "idle" ? { loading: true } : {})}>
            Create offer
          </s-button>
        </s-stack>
      </s-stack>
    </fetcher.Form>
  );
}

function TierTablePreview({
  heading,
  note,
  color,
  tiers,
}: {
  heading: string;
  note: string;
  color: string;
  tiers: { minQty: number; percent: number }[];
}) {
  const rows = tiers.length ? tiers : [{ minQty: 2, percent: 10 }, { minQty: 3, percent: 15 }];
  return (
    <s-box padding="base" background="subdued" borderRadius="base">
      <s-stack gap="small">
        <s-text color="subdued">Preview{tiers.length ? "" : " (example offers)"}</s-text>
        <div style={{ background: "#fff", borderRadius: 8, padding: 16, maxWidth: 380 }}>
          <div style={{ fontWeight: 600, textAlign: "center" }}>{heading}</div>
          {note && <div style={{ fontSize: 13, color: "#616161", textAlign: "center", margin: "4px 0 8px" }}>{note}</div>}
          {rows.map((t, i) => (
            <div
              key={t.minQty}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "8px 12px",
                marginTop: 6,
                borderRadius: 8,
                border: `1.5px solid ${i === 0 ? color : "#e3e3e3"}`,
                fontSize: 14,
              }}
            >
              <span>Buy {t.minQty}</span>
              <strong style={{ color }}>Save {t.percent}%</strong>
            </div>
          ))}
        </div>
      </s-stack>
    </s-box>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

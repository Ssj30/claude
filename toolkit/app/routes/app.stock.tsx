import { useRef } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import {
  getSettings,
  getThemeStatus,
  gql,
  saveSettingsFromForm,
} from "../lib/admin.server";
import { isLiveInTheme } from "../lib/modules";
import { LOW_STOCK_QUERY, STOCK_COUNTS_QUERY } from "../lib/queries";
import { num } from "../lib/format";
import { ModuleIntro, StatGrid, useFormValues } from "../components/ui";
import { SettingsForm } from "../components/SettingsForm";

interface VariantNode {
  id: string;
  title: string;
  sku: string | null;
  inventoryQuantity: number | null;
  inventoryItem: { tracked: boolean };
  product: {
    id: string;
    title: string;
    status: string;
    featuredMedia: { preview: { image: { url: string } | null } | null } | null;
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const settings = await getSettings(session.shop, "stock");
  const lowQuery = `inventory_quantity:<=${settings.adminLowStock} AND product_status:active`;
  const [counts, low, themeStatus] = await Promise.all([
    gql(admin, STOCK_COUNTS_QUERY, { low: lowQuery }),
    gql<{ productVariants: { nodes: VariantNode[] } }>(admin, LOW_STOCK_QUERY, {
      query: lowQuery,
    }),
    getThemeStatus(admin),
  ]);
  const variants = low.productVariants.nodes
    .filter((v) => v.inventoryItem.tracked)
    .map((v) => ({
      id: v.id,
      productId: v.product.id,
      product: v.product.title,
      variant: v.title === "Default Title" ? "" : v.title,
      sku: v.sku ?? "",
      quantity: v.inventoryQuantity ?? 0,
      image: v.product.featuredMedia?.preview?.image?.url ?? "",
    }));
  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    shop: session.shop,
    settings,
    themeStatus,
    activeProducts: counts.active.count as number,
    outOfStock: counts.outOfStock.count as number,
    lowCount: counts.low.count as number,
    variants,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  return saveSettingsFromForm(admin, session.shop, "stock", form);
};

export default function StockCounter() {
  const { apiKey, shop, settings, themeStatus, activeProducts, outOfStock, lowCount, variants } =
    useLoaderData<typeof loader>();
  const formRef = useRef<HTMLFormElement>(null);
  const live = useFormValues(formRef, settings);
  const inTheme = isLiveInTheme("stock", themeStatus);

  return (
    <s-page heading="Stock Counter">
      <ModuleIntro
        module="stock"
        apiKey={apiKey}
        shop={shop}
        themeStatus={themeStatus}
        status={
          !settings.enabled
            ? { label: "Off", tone: "neutral" }
            : inTheme === false
              ? { label: "Not on product pages yet", tone: "warning" }
              : { label: "Active", tone: "success" }
        }
      />

      <s-section heading="Inventory health">
        <StatGrid
          items={[
            { label: "Active products", value: num(activeProducts) },
            {
              label: "Variants sold out",
              value: num(outOfStock),
              tone: outOfStock ? "critical" : undefined,
              hint: outOfStock ? "Customers can't buy these" : "Nothing sold out",
            },
            {
              label: `Variants with ${settings.adminLowStock} or fewer`,
              value: num(lowCount),
              tone: lowCount ? "warning" : undefined,
              hint: lowCount ? "Reorder soon" : "Stock looks fine",
            },
          ]}
        />
      </s-section>

      <s-section heading="Running low" padding="none">
        {variants.length === 0 ? (
          <s-box padding="base">
            <s-text color="subdued">
              No tracked variants at {settings.adminLowStock} or fewer. 🎉
            </s-text>
          </s-box>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Product</s-table-header>
              <s-table-header>SKU</s-table-header>
              <s-table-header format="numeric" listSlot="inline">
                In stock
              </s-table-header>
            </s-table-header-row>
            <s-table-body>
              {variants.map((v) => (
                <s-table-row key={v.id}>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small" alignItems="center">
                      <s-thumbnail size="small" src={v.image || undefined} alt={v.product} />
                      <s-stack gap="none">
                        <s-link
                          href={`shopify://admin/products/${v.productId.split("/").pop()}`}
                        >
                          {v.product}
                        </s-link>
                        {v.variant && <s-text color="subdued">{v.variant}</s-text>}
                      </s-stack>
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>{v.sku || "—"}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={v.quantity <= 0 ? "critical" : "warning"}>
                      {v.quantity <= 0 ? "Sold out" : `${num(v.quantity)} left`}
                    </s-badge>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section heading="What shoppers see">
        <SettingsForm formRef={formRef}>
          {(errors) => (
            <>
              <s-switch
                label="Show the stock counter on product pages"
                name="enabled"
                defaultChecked={settings.enabled}
              />
              <s-grid gridTemplateColumns="1fr 1fr" gap="base">
                <s-number-field
                  label="Show when stock is at or below"
                  name="showBelow"
                  min={1}
                  defaultValue={String(settings.showBelow)}
                  details="Above this number nothing is shown."
                  error={errors.showBelow}
                />
                <s-color-field
                  label="Colour"
                  name="color"
                  defaultValue={settings.color}
                  error={errors.color}
                />
              </s-grid>
              <s-text-field
                label="Message"
                name="message"
                defaultValue={settings.message}
                details="{count} becomes the number in stock."
                error={errors.message}
              />
              <s-text-field
                label="Message when sold out (optional)"
                name="soldOutMessage"
                defaultValue={settings.soldOutMessage}
                placeholder="Leave empty to show nothing"
              />
              <s-grid gridTemplateColumns="1fr 1fr" gap="base">
                <s-switch
                  label="Show a stock bar"
                  name="showBar"
                  defaultChecked={settings.showBar}
                />
                <s-number-field
                  label="Bar is full at"
                  name="barMax"
                  min={1}
                  defaultValue={String(settings.barMax)}
                />
              </s-grid>
              <s-number-field
                label="Warn me in this list at or below"
                name="adminLowStock"
                min={0}
                defaultValue={String(settings.adminLowStock)}
                details="Only affects the “Running low” list above."
              />
              <StockPreview values={live} />
            </>
          )}
        </SettingsForm>
      </s-section>
    </s-page>
  );
}

function StockPreview({ values }: { values: Record<string, string | boolean> }) {
  const count = Math.max(1, Math.min(3, Number(values.showBelow) || 3));
  const max = Math.max(1, Number(values.barMax) || 20);
  const color = String(values.color || "#d72c0d");
  return (
    <s-box padding="base" background="subdued" borderRadius="base">
      <s-stack gap="small">
        <s-text color="subdued">Preview with {count} in stock</s-text>
        <div style={{ background: "#fff", borderRadius: 8, padding: 16, opacity: values.enabled ? 1 : 0.5 }}>
          <p style={{ margin: 0, color, fontWeight: 600, fontSize: 14 }}>
            {String(values.message || "").replace("{count}", String(count))}
          </p>
          {values.showBar && (
            <div style={{ marginTop: 8, height: 6, borderRadius: 3, background: "#eee" }}>
              <div
                style={{
                  width: `${Math.min(100, (count / max) * 100)}%`,
                  height: "100%",
                  borderRadius: 3,
                  background: color,
                }}
              />
            </div>
          )}
        </div>
      </s-stack>
    </s-box>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

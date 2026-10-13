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
  getShopInfo,
  getThemeStatus,
  saveSettingsFromForm,
} from "../lib/admin.server";
import { isLiveInTheme } from "../lib/modules";
import {
  recentOrders,
  refreshRecentSales,
  toRecentSale,
  type RecentSale,
} from "../lib/salesKit.server";
import { money, num, pct, relative } from "../lib/format";
import { ModuleIntro, StatGrid, useFormValues } from "../components/ui";
import {
  type ActionResult,
  errorResult,
  SettingsForm,
  useActionFetcher,
} from "../components/SettingsForm";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const [settings, shop, themeStatus, orders] = await Promise.all([
    getSettings(session.shop, "salesKit"),
    getShopInfo(admin),
    getThemeStatus(admin),
    recentOrders(admin, `created_at:>='${since}' AND test:false`),
  ]);

  const totals = orders.map((o) => Number(o.totalPriceSet.shopMoney.amount));
  const subtotals = orders.map((o) => Number(o.subtotalPriceSet.shopMoney.amount));
  const revenue = totals.reduce((a, b) => a + b, 0);
  const aboveThreshold = subtotals.filter((s) => s >= settings.freeShippingThreshold).length;
  // How far below the threshold the near-misses were: tells you if it's set well.
  const nearMisses = subtotals.filter(
    (s) => s < settings.freeShippingThreshold && s >= settings.freeShippingThreshold * 0.7,
  ).length;

  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    shop: session.shop,
    settings,
    currency: shop.currency,
    themeStatus,
    stats: {
      orders: orders.length,
      capped: orders.length >= 50,
      averageOrder: orders.length ? revenue / orders.length : 0,
      aboveThreshold,
      nearMisses,
    },
    feed: orders
      .map(toRecentSale)
      .filter((s): s is RecentSale => s !== null)
      .slice(0, 5),
  };
};

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionResult> => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  try {
    if (intent === "save") {
      const result = await saveSettingsFromForm(admin, session.shop, "salesKit", form);
      if (result.ok) await refreshRecentSales(admin);
      return result;
    }
    if (intent === "refresh") {
      const sales = await refreshRecentSales(admin);
      return { ok: true, intent, message: `Pop-ups now use your last ${sales.length} orders` };
    }
  } catch (error) {
    return errorResult(error, intent);
  }
  return { ok: false, intent, error: "Unknown action" };
};

export default function SalesKit() {
  const { apiKey, shop, settings, currency, themeStatus, stats, feed } = useLoaderData<typeof loader>();
  const formRef = useRef<HTMLFormElement>(null);
  const live = useFormValues(formRef, settings);
  const actions = useActionFetcher();
  const anyOn = settings.popupsEnabled || settings.freeShippingEnabled;

  return (
    <s-page heading="Sales Kit">
      <ModuleIntro
        module="salesKit"
        apiKey={apiKey}
        shop={shop}
        themeStatus={themeStatus}
        status={
          !anyOn
            ? { label: "Off", tone: "neutral" }
            : isLiveInTheme("salesKit", themeStatus) === false
              ? { label: "Not switched on in theme", tone: "warning" }
              : { label: "Active", tone: "success" }
        }
      />

      <s-section heading="Last 30 days">
        <StatGrid
          items={[
            {
              label: "Orders",
              value: stats.capped ? "50+" : num(stats.orders),
            },
            { label: "Average order", value: money(stats.averageOrder, currency) },
            {
              label: `Orders reaching free shipping (${money(settings.freeShippingThreshold, currency)})`,
              value: stats.orders ? pct((stats.aboveThreshold / stats.orders) * 100) : "—",
              hint: stats.nearMisses
                ? `${plural(stats.nearMisses)} just below: the bar can nudge these`
                : undefined,
            },
          ]}
        />
      </s-section>

      <SettingsForm formRef={formRef}>
        {(errors) => (
          <>
            <s-section heading="Recent-sale pop-ups">
              <s-stack gap="base">
                <s-paragraph color="subdued">
                  Small notifications like “Anna from Ghent bought Porsche 911 Turbo”, using your real
                  orders. Only a first name and city are shown.
                </s-paragraph>
                <s-switch label="Show pop-ups" name="popupsEnabled" defaultChecked={settings.popupsEnabled} />
                <s-grid gridTemplateColumns="1fr 1fr 1fr" gap="base">
                  <s-select label="Position" name="popupPosition" value={settings.popupPosition}>
                    <s-option value="bottom-left">Bottom left</s-option>
                    <s-option value="bottom-right">Bottom right</s-option>
                  </s-select>
                  <s-number-field
                    label="First pop-up after"
                    name="popupFirstDelay"
                    suffix="sec"
                    min={0}
                    defaultValue={String(settings.popupFirstDelay)}
                  />
                  <s-number-field
                    label="Then every"
                    name="popupInterval"
                    suffix="sec"
                    min={5}
                    defaultValue={String(settings.popupInterval)}
                    error={errors.popupInterval}
                  />
                </s-grid>
                <s-switch label="Show the buyer's city" name="popupShowCity" defaultChecked={settings.popupShowCity} />
                <PopupPreview sale={feed[0]} showCity={!!live.popupShowCity} enabled={!!live.popupsEnabled} />
                <s-stack direction="inline" gap="small" alignItems="center">
                  <s-text color="subdued">
                    {feed.length
                      ? `Using your ${feed.length > 4 ? "latest" : ""} orders; updates automatically with each new order.`
                      : "No orders yet, so no pop-ups will show."}
                  </s-text>
                  <s-button
                    variant="tertiary"
                    onClick={() => actions.run("refresh")}
                    {...(actions.busy("refresh") ? { loading: true } : {})}
                  >
                    Refresh now
                  </s-button>
                </s-stack>
              </s-stack>
            </s-section>

            <s-section heading="Free-shipping bar">
              <s-stack gap="base">
                <s-paragraph color="subdued">
                  Shows how much more a shopper needs to spend for free shipping. Make sure the amount
                  matches your shipping rates in Settings → Shipping.
                </s-paragraph>
                <s-switch
                  label="Show the free-shipping bar"
                  name="freeShippingEnabled"
                  defaultChecked={settings.freeShippingEnabled}
                />
                <s-money-field
                  label="Free shipping from"
                  name="freeShippingThreshold"
                  currencyCode="EUR"
                  defaultValue={String(settings.freeShippingThreshold)}
                  error={errors.freeShippingThreshold}
                />
                <s-text-field
                  label="Message"
                  name="freeShippingMessage"
                  defaultValue={settings.freeShippingMessage}
                  details="{amount} becomes the amount still needed."
                />
                <s-text-field
                  label="Message once reached"
                  name="freeShippingSuccess"
                  defaultValue={settings.freeShippingSuccess}
                />
                <ShippingPreview values={live} currency={currency} />
              </s-stack>
            </s-section>

            <s-section heading="Trust badges">
              <s-paragraph color="subdued">
                Badges like “Free shipping” and “Secure checkout” plus your payment logos, shown under
                the Add to cart button. Pick the icons and texts in the theme editor, right where they
                appear. Your payment logos are filled in automatically from your payment settings.
              </s-paragraph>
            </s-section>
          </>
        )}
      </SettingsForm>
    </s-page>
  );
}

function plural(n: number) {
  return `${num(n)} order${n === 1 ? "" : "s"}`;
}

function PopupPreview({
  sale,
  showCity,
  enabled,
}: {
  sale?: RecentSale;
  showCity: boolean;
  enabled: boolean;
}) {
  const example: RecentSale = sale ?? {
    name: "Anna",
    city: "Ghent",
    country: "BE",
    product: "Porsche 911 Turbo",
    handle: "",
    image: "",
    at: "",
  };
  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        alignItems: "center",
        maxWidth: 340,
        padding: 10,
        borderRadius: 12,
        background: "#fff",
        boxShadow: "0 4px 16px rgba(0,0,0,.12)",
        opacity: enabled ? 1 : 0.5,
        fontSize: 13,
      }}
    >
      {example.image ? (
        <img src={example.image} alt="" width={48} height={48} style={{ borderRadius: 8, objectFit: "cover" }} />
      ) : (
        <div style={{ width: 48, height: 48, borderRadius: 8, background: "#f1f1f1" }} />
      )}
      <div>
        <div>
          <strong>{example.name}</strong>
          {showCity && example.city ? ` from ${example.city}` : ""} bought
        </div>
        <div style={{ fontWeight: 600 }}>{example.product}</div>
        <div style={{ color: "#616161", fontSize: 12 }}>{example.at ? relative(example.at) : "2 h ago"}</div>
      </div>
    </div>
  );
}

function ShippingPreview({
  values,
  currency,
}: {
  values: Record<string, string | boolean>;
  currency: string;
}) {
  const threshold = Number(values.freeShippingThreshold) || 0;
  const cart = Math.round(threshold * 0.6 * 100) / 100;
  const left = Math.max(0, threshold - cart);
  return (
    <s-box padding="base" background="subdued" borderRadius="base">
      <s-stack gap="small">
        <s-text color="subdued">Preview with {money(cart, currency)} in the cart</s-text>
        <div style={{ background: "#fff", borderRadius: 8, padding: 12, opacity: values.freeShippingEnabled ? 1 : 0.5 }}>
          <div style={{ fontSize: 14, textAlign: "center", marginBottom: 8 }}>
            {String(values.freeShippingMessage).replace("{amount}", money(left, currency))}
          </div>
          <div style={{ height: 6, borderRadius: 3, background: "#eee" }}>
            <div style={{ width: "60%", height: "100%", borderRadius: 3, background: "#008060" }} />
          </div>
        </div>
      </s-stack>
    </s-box>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

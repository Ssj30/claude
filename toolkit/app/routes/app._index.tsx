import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  getAllSettings,
  getShopInfo,
  getThemeStatus,
  gql,
} from "../lib/admin.server";
import { loadMonthReport } from "../lib/bookkeeping.server";
import { ensureStorefrontData } from "../lib/storefront.server";
import { currentMonth } from "../lib/bookkeeping";
import { tiersFromDiscountNodes } from "../lib/bundles";
import { AUTOMATIC_DISCOUNTS_QUERY, STOCK_COUNTS_QUERY } from "../lib/queries";
import { isLiveInTheme, MODULES, type ModuleKey } from "../lib/modules";
import { money, monthLabel, num, plural } from "../lib/format";
import type { ModuleStatus } from "../components/ui";

interface Card {
  status: ModuleStatus;
  metric: string;
  metricLabel: string;
}

/** Runs a loader step but keeps the page working if that one call fails. */
async function safe<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch (error) {
    console.error(error);
    return null;
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const month = currentMonth();
  const settings = await getAllSettings(shop);
  await safe(ensureStorefrontData(admin, shop));

  const [info, themeStatus, report, stock, discounts, pendingReviews, published, lastSync, codesIssued] =
    await Promise.all([
      getShopInfo(admin),
      getThemeStatus(admin),
      safe(loadMonthReport(admin, month, settings.bookkeeping.excludeTestOrders)),
      safe(gql(admin, STOCK_COUNTS_QUERY, {
        low: `inventory_quantity:<=${settings.stock.adminLowStock} AND product_status:active`,
      })),
      safe(gql(admin, AUTOMATIC_DISCOUNTS_QUERY)),
      db.review.count({ where: { shop, status: "pending" } }),
      db.review.aggregate({
        where: { shop, status: "published" },
        _avg: { rating: true },
        _count: true,
      }),
      db.syncLog.findFirst({ where: { shop }, orderBy: { createdAt: "desc" } }),
      db.rewardCode.count({ where: { shop } }),
    ]);

  const live = (key: ModuleKey) => isLiveInTheme(key, themeStatus);
  const notInTheme: ModuleStatus = { label: "Not in theme yet", tone: "warning" };
  const off: ModuleStatus = { label: "Off", tone: "neutral" };
  const active: ModuleStatus = { label: "Active", tone: "success" };
  const tiers = discounts ? tiersFromDiscountNodes(discounts.discountNodes.nodes) : [];
  const activeTiers = tiers.filter((t) => t.status === "ACTIVE").length;
  const lowCount: number | null = stock?.low.count ?? null;

  const cards: Record<ModuleKey, Card> = {
    bookkeeping: {
      status: !settings.bookkeeping.n8nWebhookUrl
        ? { label: "n8n not connected", tone: "warning" }
        : lastSync && !lastSync.ok
          ? { label: "Last sync failed", tone: "critical" }
          : { label: "Syncing", tone: "success" },
      metric: report ? money(report.revenue, info.currency) : "—",
      metricLabel: report ? `revenue in ${monthLabel(month)} · ${plural(report.orderCount, "order")}` : "couldn't load orders",
    },
    stock: {
      status: !settings.stock.enabled ? off : live("stock") === false ? notInTheme : active,
      metric: lowCount === null ? "—" : num(lowCount),
      metricLabel: `variants with ${settings.stock.adminLowStock} or fewer left`,
    },
    countdown: {
      status: !settings.countdown.enabled ? off : live("countdown") === false ? notInTheme : active,
      metric: settings.countdown.mode === "daily" ? settings.countdown.endTime : settings.countdown.endDate || "—",
      metricLabel: settings.countdown.mode === "daily" ? "daily cut-off" : "sale ends",
    },
    reviews: {
      status: pendingReviews
        ? { label: `${num(pendingReviews)} to approve`, tone: "warning" }
        : live("reviews") === false
          ? notInTheme
          : active,
      metric: published._count ? `${(published._avg.rating ?? 0).toFixed(1)} ★` : "—",
      metricLabel: published._count ? `average of ${plural(published._count, "review")}` : "no reviews yet",
    },
    salesKit: {
      status:
        !(settings.salesKit.popupsEnabled || settings.salesKit.freeShippingEnabled)
          ? off
          : live("salesKit") === false
            ? notInTheme
            : active,
      metric: money(settings.salesKit.freeShippingThreshold, info.currency),
      metricLabel: "free-shipping goal",
    },
    bundles: {
      status: activeTiers === 0 ? off : live("bundles") === false ? { label: "Table not on product page", tone: "warning" } : active,
      metric: num(activeTiers),
      metricLabel: activeTiers === 1 ? "active offer" : "active offers",
    },
    checkout: {
      status: !settings.checkout.enabled ? off : codesIssued ? active : { label: "Needs setup", tone: "info" },
      metric: `${settings.checkout.percent}%`,
      metricLabel: `next-order reward · ${plural(codesIssued, "code")} given`,
    },
  };

  const attention = MODULES.filter((m) =>
    ["warning", "critical"].includes(cards[m.key].status.tone),
  ).map((m) => ({ title: m.title, path: m.path, label: cards[m.key].status.label }));

  return { shopName: info.name, cards, attention };
};

export default function Index() {
  const { shopName, cards, attention } = useLoaderData<typeof loader>();

  return (
    <s-page heading="911 Toolkit">
      <s-section>
        <s-stack gap="small">
          <s-heading>Welcome back{shopName ? `, ${shopName}` : ""}</s-heading>
          <s-paragraph color="subdued">
            All seven of your store tools in one place. Each card shows whether the tool is
            working and the one number that matters most.
          </s-paragraph>
        </s-stack>
      </s-section>

      {attention.length > 0 && (
        <s-banner tone="warning" heading={`${plural(attention.length, "tool")} need${attention.length === 1 ? "s" : ""} a look`}>
          <s-stack gap="small-200">
            {attention.map((a) => (
              <s-text key={a.path}>
                <s-link href={a.path}>{a.title}</s-link>: {a.label}
              </s-text>
            ))}
          </s-stack>
        </s-banner>
      )}

      <s-section heading="Your tools">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(240px, 1fr))" gap="base">
          {MODULES.map((m) => {
            const card = cards[m.key];
            return (
              <s-clickable key={m.key} href={m.path} border="base" borderRadius="base" padding="base">
                <s-stack gap="small">
                  <s-stack direction="inline" justifyContent="space-between" alignItems="center">
                    <s-heading>{m.title}</s-heading>
                    <s-badge tone={card.status.tone}>{card.status.label}</s-badge>
                  </s-stack>
                  <s-stack gap="none">
                    <span style={{ fontSize: "1.5rem", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                      {card.metric}
                    </span>
                    <s-text color="subdued">{card.metricLabel}</s-text>
                  </s-stack>
                  <s-paragraph color="subdued" lineClamp={2}>
                    {m.summary}
                  </s-paragraph>
                </s-stack>
              </s-clickable>
            );
          })}
        </s-grid>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

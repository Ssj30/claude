// Renders every admin page on the server with realistic sample data, so a
// crash in page code (a missing field, a bad map) fails the tests.
import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from "react-router";
import { DEFAULT_SETTINGS } from "../../lib/settings";
import { buildMonthReport, type RawOrder } from "../../lib/bookkeeping";

vi.mock("../../shopify.server", () => ({ authenticate: {}, unauthenticated: {} }));
vi.mock("../../db.server", () => ({ default: {} }));

import * as Home from "../app._index";
import * as Bookkeeping from "../app.bookkeeping";
import * as Stock from "../app.stock";
import * as Countdown from "../app.countdown";
import * as Reviews from "../app.reviews";
import * as SalesKit from "../app.sales-kit";
import * as Bundles from "../app.bundles";
import * as Checkout from "../app.checkout";

const m = (n: number) => ({ shopMoney: { amount: String(n) } });
const order = (i: number, total: number, extra: Partial<RawOrder> = {}): RawOrder => ({
  id: `gid://shopify/Order/${i}`,
  name: `#${1000 + i}`,
  createdAt: `2026-10-0${(i % 9) + 1}T10:00:00Z`,
  cancelledAt: null,
  test: false,
  displayFinancialStatus: "PAID",
  customer: { displayName: "Sample Buyer" },
  billingAddress: { countryCodeV2: i % 2 ? "BE" : "DE", company: null },
  subtotalPriceSet: m(total),
  totalDiscountsSet: m(0),
  totalShippingPriceSet: m(0),
  totalTaxSet: m(0),
  totalPriceSet: m(total),
  totalRefundedSet: m(0),
  taxLines: [],
  ...extra,
});

const themeStatus = { "countdown-bar": true, "stock-counter": false, reviews: true, "rating-badge": false, "reviews-carousel": false, "sales-kit": false, "trust-badges": true, "bundle-tiers": false };
const sale = { name: "Anna", city: "Ghent", country: "BE", product: "Porsche 911 Turbo", handle: "porsche-911-turbo", image: "", at: "2026-10-10T10:00:00Z" };

const pages = {
  "/app": {
    mod: Home,
    data: {
      shopName: "911nights",
      attention: [{ title: "Reviews", path: "/app/reviews", label: "2 to approve" }],
      cards: Object.fromEntries(
        ["bookkeeping", "stock", "countdown", "reviews", "salesKit", "bundles", "checkout"].map((k) => [
          k,
          { status: { label: "Active", tone: "success" }, metric: "€ 1.234,00", metricLabel: "sample" },
        ]),
      ),
    },
  },
  "/app/bookkeeping": {
    mod: Bookkeeping,
    data: {
      month: "2026-10",
      thisMonth: "2026-10",
      shop: { currency: "EUR" },
      report: buildMonthReport("2026-10", [
        order(1, 129.97),
        order(2, 0),
        order(3, 267.06, { totalRefundedSet: m(129.97), displayFinancialStatus: "PARTIALLY_REFUNDED" }),
        order(4, 99, { cancelledAt: "2026-10-04T00:00:00Z" }),
      ]),
      settings: { ...DEFAULT_SETTINGS.bookkeeping, n8nWebhookUrl: "https://n8n.example/webhook/x" },
      logs: [
        { id: "1", label: "#1112 paid", ok: true, detail: "", createdAt: "2026-10-12T10:00:00Z" },
        { id: "2", label: "Refund", ok: false, detail: "n8n answered 500", createdAt: "2026-10-11T10:00:00Z" },
      ],
      olderThan60Days: false,
    },
  },
  "/app/stock": {
    mod: Stock,
    data: {
      apiKey: "key",
      shop: "example.myshopify.com",
      settings: DEFAULT_SETTINGS.stock,
      themeStatus,
      activeProducts: 7,
      outOfStock: 1,
      lowCount: 2,
      variants: [
        { id: "v1", productId: "gid://shopify/Product/1", product: "Porsche 911 Turbo", variant: "", sku: "PT-1", quantity: 0, image: "" },
        { id: "v2", productId: "gid://shopify/Product/2", product: "Porsche 911 RS", variant: "Red", sku: "", quantity: 3, image: "https://cdn.example/x.jpg" },
      ],
    },
  },
  "/app/countdown": {
    mod: Countdown,
    data: { apiKey: "key",
      shop: "example.myshopify.com", settings: { ...DEFAULT_SETTINGS.countdown, enabled: true, endDate: "2026-12-24" }, themeStatus, timeZone: "Europe/Brussels" },
  },
  "/app/reviews": {
    mod: Reviews,
    data: {
      apiKey: "key",
      shop: "example.myshopify.com",
      settings: DEFAULT_SETTINGS.reviews,
      themeStatus: null,
      filter: "pending",
      pendingCount: 2,
      last30: 3,
      summary: { count: 4, average: 4.5, histogram: [0, 0, 0, 2, 2] },
      reviews: [
        { id: "r1", productTitle: "Porsche 911 Turbo", rating: 5, title: "Great", body: "Lovely gift", author: "Anna", status: "pending", source: "form", verified: true, createdAt: "2026-10-10T10:00:00Z" },
        { id: "r2", productTitle: "Porsche 911", rating: 3, title: "", body: "OK", author: "Ben", status: "hidden", source: "loox", verified: false, createdAt: "2026-10-09T10:00:00Z" },
      ],
      products: [{ id: "gid://shopify/Product/1", title: "Porsche 911 Turbo", handle: "porsche-911-turbo" }],
      looxAvailable: 1,
    },
  },
  "/app/sales-kit": {
    mod: SalesKit,
    data: {
      apiKey: "key",
      shop: "example.myshopify.com",
      settings: DEFAULT_SETTINGS.salesKit,
      currency: "EUR",
      themeStatus,
      stats: { orders: 12, capped: false, averageOrder: 133.2, aboveThreshold: 11, nearMisses: 1 },
      feed: [sale],
    },
  },
  "/app/bundles": {
    mod: Bundles,
    data: {
      apiKey: "key",
      shop: "example.myshopify.com",
      settings: DEFAULT_SETTINGS.bundles,
      currency: "EUR",
      themeStatus,
      tiers: [
        { id: "gid://shopify/DiscountAutomaticNode/1", title: "Ordered together 10% · 2+", status: "ACTIVE", minQty: 2, percent: 10, usage: 0, collections: [{ id: "c", title: "Porsche Advent Calendars", handle: "frontpage" }] },
        { id: "gid://shopify/DiscountAutomaticNode/2", title: "Buy 3+ save 15%", status: "EXPIRED", minQty: 3, percent: 15, usage: 4, collections: [] },
      ],
      collections: [{ id: "c", title: "Porsche Advent Calendars", handle: "frontpage" }],
      stats: { orders: 12, bundleOrders: 2, bundleRevenue: 520.12 },
    },
  },
  "/app/checkout": {
    mod: Checkout,
    data: {
      settings: DEFAULT_SETTINGS.checkout,
      currency: "EUR",
      codes: [{ id: "gid://shopify/DiscountCodeNode/1", code: "THANKS-ZQVPEQ", status: "ACTIVE", createdAt: "2026-10-01T10:00:00Z", endsAt: null, used: false }],
      lastIssued: null,
      stats: { issued: 1, redeemed: 0, repeatOrders: 0, repeatRevenue: 0 },
    },
  },
};

async function render(path: keyof typeof pages) {
  const { mod, data } = pages[path];
  const routes = [{ path, Component: mod.default, loader: () => data }];
  const handler = createStaticHandler(routes);
  const context = await handler.query(new Request(`http://localhost${path}`));
  if (context instanceof Response) throw new Error("unexpected response");
  const router = createStaticRouter(handler.dataRoutes, context);
  return renderToString(<StaticRouterProvider router={router} context={context} hydrate={false} />);
}

describe("admin pages render", () => {
  for (const path of Object.keys(pages) as (keyof typeof pages)[]) {
    it(path, async () => {
      const html = await render(path);
      expect(html).toContain("<s-page");
      expect(html).not.toContain("undefined");
      expect(html).not.toContain("NaN");
      if ("apiKey" in pages[path].data) {
        // Theme checklist links straight into the theme editor.
        expect(html).toContain("https://example.myshopify.com/admin/themes/current/editor?");
      }
    });
  }
});

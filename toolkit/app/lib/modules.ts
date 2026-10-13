// The seven tools in the app. Used by the nav, the home page and each
// module page header. Safe to import on the client.

export type ModuleKey =
  | "bookkeeping"
  | "stock"
  | "countdown"
  | "reviews"
  | "salesKit"
  | "bundles"
  | "checkout";

export type ThemeHook =
  // An app embed: one switch in Theme settings → App embeds.
  | { kind: "embed"; handle: string }
  // An app block that the merchant places on a template.
  | { kind: "block"; handle: string; template: string };

export interface ModuleInfo {
  key: ModuleKey;
  title: string;
  /** What the old standalone app was called, so it is easy to recognise. */
  formerly: string;
  path: string;
  summary: string;
  theme: ThemeHook[];
}

export const MODULES: ModuleInfo[] = [
  {
    key: "bookkeeping",
    title: "Bookkeeping",
    formerly: "n8n Boekhouding",
    path: "/app/bookkeeping",
    summary:
      "Monthly revenue, VAT and refunds at a glance, a CSV export for your accountant, and automatic sync of orders to n8n.",
    theme: [],
  },
  {
    key: "stock",
    title: "Stock Counter",
    formerly: "Stock Counter",
    path: "/app/stock",
    summary:
      "Shows “Only 3 left” on product pages and lists which variants are about to sell out.",
    theme: [{ kind: "block", handle: "stock-counter", template: "product" }],
  },
  {
    key: "countdown",
    title: "Countdown Bar",
    formerly: "Countdown Bar",
    path: "/app/countdown",
    summary:
      "A bar at the top of every page that counts down to the end of a sale or to today's shipping cut-off.",
    theme: [{ kind: "embed", handle: "countdown-bar" }],
  },
  {
    key: "reviews",
    title: "Reviews",
    formerly: "Stellar Reviews",
    path: "/app/reviews",
    summary:
      "Collect product reviews, approve or hide them, and show stars and reviews on product pages.",
    theme: [
      { kind: "block", handle: "reviews", template: "product" },
      { kind: "block", handle: "rating-badge", template: "product" },
      { kind: "block", handle: "reviews-carousel", template: "index" },
    ],
  },
  {
    key: "salesKit",
    title: "Sales Kit",
    formerly: "Sales Kit",
    path: "/app/sales-kit",
    summary:
      "Recent-sale pop-ups, a free-shipping progress bar and trust badges to lift conversion.",
    theme: [
      { kind: "embed", handle: "sales-kit" },
      { kind: "block", handle: "trust-badges", template: "product" },
    ],
  },
  {
    key: "bundles",
    title: "Bundle Deals",
    formerly: "Bundle Deals",
    path: "/app/bundles",
    summary:
      "“Buy 2, save 10%” volume discounts that apply automatically at checkout, with an offer table on product pages.",
    theme: [{ kind: "block", handle: "bundle-tiers", template: "product" }],
  },
  {
    key: "checkout",
    title: "Checkout Kit",
    formerly: "Checkout Kit",
    path: "/app/checkout",
    summary:
      "Gives every buyer a personal discount code for their next order on the thank-you page.",
    theme: [],
  },
];

export function moduleInfo(key: ModuleKey): ModuleInfo {
  const info = MODULES.find((m) => m.key === key);
  if (!info) throw new Error(`Unknown module ${key}`);
  return info;
}

/**
 * Deep link that opens the theme editor with the embed switched on or the
 * block added (https://shopify.dev/docs/apps/build/online-store/theme-app-extensions/configuration#deep-linking).
 */
export function themeEditorUrl(shopDomain: string, apiKey: string, hook: ThemeHook): string {
  const base = `https://${shopDomain}/admin/themes/current/editor`;
  if (hook.kind === "embed") {
    return `${base}?context=apps&activateAppId=${apiKey}/${hook.handle}`;
  }
  return `${base}?template=${hook.template}&addAppBlockId=${apiKey}/${hook.handle}&target=mainSection`;
}

/** Which embeds/blocks are in the live theme, keyed by block handle. */
export type ThemeStatus = Record<string, boolean>;

/** Is a module's storefront part live? `null` = not applicable or unknown. */
export function isLiveInTheme(
  key: ModuleKey,
  status: ThemeStatus | null,
): boolean | null {
  const hooks = MODULES.find((m) => m.key === key)?.theme ?? [];
  if (!hooks.length || !status) return null;
  return hooks.some((h) => status[h.handle]);
}

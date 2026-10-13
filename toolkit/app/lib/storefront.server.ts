import { getSettings, gql, saveSettings, setAppMetafield, type Admin } from "./admin.server";
import { APP_INSTALLATION_QUERY, AUTOMATIC_DISCOUNTS_QUERY } from "./queries";
import { refreshRecentSales } from "./salesKit.server";
import { syncFeaturedReviews } from "./reviews.server";
import { storefrontTiers, tiersFromDiscountNodes } from "./bundles";
import type { SettingsKey } from "./settings";

const STOREFRONT_SETTINGS: SettingsKey[] = ["stock", "countdown", "reviews", "salesKit", "bundles"];

/**
 * The theme blocks read app metafields. Right after install none exist, so
 * write the defaults (and the data feeds) once, the first time the app opens.
 */
export async function ensureStorefrontData(admin: Admin, shop: string) {
  const data = await gql(admin, APP_INSTALLATION_QUERY);
  const present = new Set<string>(
    data.currentAppInstallation.metafields.nodes.map((m: { key: string }) => m.key),
  );
  for (const key of STOREFRONT_SETTINGS) {
    if (!present.has(key)) await saveSettings(admin, shop, key, await getSettings(shop, key));
  }
  if (!present.has("recent_sales")) await refreshRecentSales(admin);
  if (!present.has("featured_reviews")) await syncFeaturedReviews(admin, shop);
  if (!present.has("bundle_tiers")) {
    const discounts = await gql(admin, AUTOMATIC_DISCOUNTS_QUERY);
    await setAppMetafield(
      admin,
      "bundle_tiers",
      storefrontTiers(tiersFromDiscountNodes(discounts.discountNodes.nodes)),
    );
  }
}

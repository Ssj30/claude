import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import {
  APP_INSTALLATION_QUERY,
  MAIN_THEME_FILES_QUERY,
  METAFIELDS_SET_MUTATION,
} from "./queries";
import {
  type SettingsKey,
  type SettingsMap,
  settingsFromForm,
  validateSettings,
  SHOP_TIME_ZONE,
  withDefaults,
  zonedToUtc,
} from "./settings";
import { MODULES, type ThemeStatus } from "./modules";

export type Admin = AdminApiContext;

export class ShopifyError extends Error {}

/** Runs an Admin GraphQL operation and throws on top-level errors. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function gql<T = any>(
  admin: Admin,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const response = await admin.graphql(query, { variables });
  const json = (await response.json()) as {
    data?: T;
    errors?: { message: string }[];
  };
  if (json.errors?.length) {
    throw new ShopifyError(json.errors.map((e) => e.message).join("; "));
  }
  return json.data as T;
}

/** Throws a readable error when a mutation returns userErrors. */
export function assertNoUserErrors(
  result: { userErrors?: { message: string }[] } | null | undefined,
) {
  const errors = result?.userErrors ?? [];
  if (errors.length) {
    throw new ShopifyError(errors.map((e) => e.message).join("; "));
  }
}

export interface ShopInfo {
  name: string;
  domain: string;
  currency: string;
  timezone: string;
  taxesIncluded: boolean;
  appInstallationId: string;
}

export async function getShopInfo(admin: Admin): Promise<ShopInfo> {
  const data = await gql(admin, APP_INSTALLATION_QUERY);
  return {
    name: data.shop.name,
    domain: data.shop.myshopifyDomain,
    currency: data.shop.currencyCode,
    timezone: data.shop.ianaTimezone,
    taxesIncluded: data.shop.taxesIncluded,
    appInstallationId: data.currentAppInstallation.id,
  };
}

export async function getSettings<K extends SettingsKey>(
  shop: string,
  key: K,
): Promise<SettingsMap[K]> {
  const row = await db.setting.findUnique({
    where: { shop_module: { shop, module: key } },
  });
  return withDefaults(key, row ? JSON.parse(row.json) : null);
}

export async function getAllSettings(shop: string): Promise<SettingsMap> {
  const rows = await db.setting.findMany({ where: { shop } });
  const byKey = new Map(rows.map((r) => [r.module, JSON.parse(r.json)]));
  return {
    bookkeeping: withDefaults("bookkeeping", byKey.get("bookkeeping")),
    stock: withDefaults("stock", byKey.get("stock")),
    countdown: withDefaults("countdown", byKey.get("countdown")),
    reviews: withDefaults("reviews", byKey.get("reviews")),
    salesKit: withDefaults("salesKit", byKey.get("salesKit")),
    bundles: withDefaults("bundles", byKey.get("bundles")),
    checkout: withDefaults("checkout", byKey.get("checkout")),
  };
}

/**
 * Saves settings to the database and mirrors the storefront-safe part to an
 * app metafield, which the theme blocks read as `app.metafields.toolkit.<key>`.
 */
export async function saveSettings<K extends SettingsKey>(
  admin: Admin,
  shop: string,
  key: K,
  settings: SettingsMap[K],
) {
  const json = JSON.stringify(settings);
  await db.setting.upsert({
    where: { shop_module: { shop, module: key } },
    create: { shop, module: key, json },
    update: { json },
  });
  const publicValue = storefrontView(key, settings);
  if (publicValue) await setAppMetafield(admin, key, publicValue);
}

/** Never send secrets to the storefront. */
function storefrontView<K extends SettingsKey>(
  key: K,
  settings: SettingsMap[K],
): unknown | null {
  if (key === "bookkeeping" || key === "checkout") return null;
  if (key === "countdown") {
    const c = settings as SettingsMap["countdown"];
    return {
      ...c,
      timeZone: SHOP_TIME_ZONE,
      endsAtUtc: c.mode === "fixed" ? zonedToUtc(c.endDate, c.endTime, SHOP_TIME_ZONE) : null,
    };
  }
  return settings;
}

export async function setAppMetafield(
  admin: Admin,
  key: string,
  value: unknown,
) {
  const data = await gql(admin, APP_INSTALLATION_QUERY);
  const result = await gql(admin, METAFIELDS_SET_MUTATION, {
    metafields: [
      {
        ownerId: data.currentAppInstallation.id,
        namespace: "toolkit",
        key,
        type: "json",
        value: JSON.stringify(value),
      },
    ],
  });
  assertNoUserErrors(result.metafieldsSet);
}

export async function setProductMetafields(
  admin: Admin,
  metafields: {
    ownerId: string;
    namespace: string;
    key: string;
    type: string;
    value: string;
  }[],
) {
  // metafieldsSet takes at most 25 at a time.
  for (let i = 0; i < metafields.length; i += 25) {
    const result = await gql(admin, METAFIELDS_SET_MUTATION, {
      metafields: metafields.slice(i, i + 25),
    });
    assertNoUserErrors(result.metafieldsSet);
  }
}

// Theme status --------------------------------------------------------------


/**
 * Looks at the live theme to see which of the app's embeds are switched on
 * and which blocks are placed on the product template. Keys are block handles.
 * Returns null when the theme can't be read (e.g. the theme uses JSON files
 * the app can't see), so the UI can say "unknown" instead of guessing.
 */
export async function getThemeStatus(admin: Admin): Promise<ThemeStatus | null> {
  try {
    const data = await gql(admin, MAIN_THEME_FILES_QUERY);
    const files: { filename: string; body?: { content?: string } }[] =
      data.themes.nodes[0]?.files?.nodes ?? [];
    const content = (name: string) =>
      files.find((f) => f.filename === name)?.body?.content ?? "";
    return themeStatusFromFiles(content("config/settings_data.json"), {
      product: content("templates/product.json"),
      index: content("templates/index.json"),
    });
  } catch {
    return null;
  }
}

export function themeStatusFromFiles(
  settingsData: string,
  templates: Record<string, string>,
): ThemeStatus {
  const status: ThemeStatus = {};
  const embeds = Object.values(
    (parseThemeJson(settingsData)?.current?.blocks ?? {}) as Record<string, ThemeBlock>,
  );
  // Block types look like "shopify://apps/<app>/blocks/<handle>/<uuid>".
  const isOurs = (block: ThemeBlock, handle: string) =>
    !block.disabled &&
    !!block.type &&
    new RegExp(`^shopify://apps/[^/]*toolkit[^/]*/blocks/${handle}/`).test(block.type);

  for (const hook of MODULES.flatMap((m) => m.theme)) {
    if (hook.kind === "embed") {
      status[hook.handle] = embeds.some((b) => isOurs(b, hook.handle));
    } else {
      const blocks = templateBlocks(parseThemeJson(templates[hook.template] ?? ""));
      status[hook.handle] = blocks.some((b) => isOurs(b, hook.handle));
    }
  }
  return status;
}

interface ThemeBlock {
  type?: string;
  disabled?: boolean;
  blocks?: Record<string, ThemeBlock>;
}

/** All blocks in enabled sections of a JSON template, including nested blocks. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function templateBlocks(template: any): ThemeBlock[] {
  const out: ThemeBlock[] = [];
  const visit = (blocks: Record<string, ThemeBlock> | undefined) => {
    for (const block of Object.values(blocks ?? {})) {
      out.push(block);
      visit(block.blocks);
    }
  };
  for (const section of Object.values(template?.sections ?? {}) as ThemeBlock[]) {
    if (!section.disabled) visit(section.blocks);
  }
  return out;
}

/** Theme JSON files may start with a comment block; strip it before parsing. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseThemeJson(text: string): any {
  if (!text) return null;
  try {
    return JSON.parse(text.replace(/^\s*\/\*[\s\S]*?\*\//, ""));
  } catch {
    return null;
  }
}



/** Shared "save settings" action used by every module page. */
export async function saveSettingsFromForm<K extends SettingsKey>(
  admin: Admin,
  shop: string,
  key: K,
  form: FormData,
) {
  const previous = await getSettings(shop, key);
  const next = settingsFromForm(key, form, previous);
  const errors = validateSettings(key, next);
  if (Object.keys(errors).length) {
    return { ok: false, intent: "save", errors };
  }
  try {
    await saveSettings(admin, shop, key, next);
    return { ok: true, intent: "save", message: "Settings saved" };
  } catch (error) {
    return {
      ok: false,
      intent: "save",
      error: error instanceof Error ? error.message : "Saving failed",
    };
  }
}

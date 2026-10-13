// Settings for each module: defaults, and turning a submitted form back into
// typed settings. Settings are flat objects so a form field name is the key.

/** The shop is in Belgium; countdown times are entered in this zone. */
export const SHOP_TIME_ZONE = "Europe/Brussels";

export const DEFAULT_SETTINGS = {
  bookkeeping: {
    n8nWebhookUrl: "",
    n8nSecret: "",
    autoForward: true,
    excludeTestOrders: true,
  },
  stock: {
    enabled: true,
    showBelow: 10,
    message: "Only {count} left of this model",
    soldOutMessage: "",
    showBar: true,
    barMax: 20,
    color: "#111111",
    adminLowStock: 5,
  },
  countdown: {
    enabled: false,
    message: "Free shipping on all orders ends in",
    endedMessage: "",
    // fixed: counts down to endDate + endTime; daily: to endTime every day.
    mode: "fixed" as "fixed" | "daily",
    endDate: "",
    endTime: "23:59",
    linkUrl: "",
    background: "#111111",
    textColor: "#ffffff",
    accent: "#e11d48",
    position: "top" as "top" | "bottom",
    closable: true,
  },
  reviews: {
    acceptSubmissions: true,
    autoPublishMin: 4,
    starColor: "#f5a623",
    heading: "Customer reviews",
    showForm: true,
  },
  salesKit: {
    popupsEnabled: true,
    popupPosition: "bottom-left" as "bottom-left" | "bottom-right",
    popupFirstDelay: 8,
    popupInterval: 20,
    popupShowCity: true,
    freeShippingEnabled: true,
    freeShippingThreshold: 50,
    freeShippingMessage: "You're {amount} away from free shipping",
    freeShippingSuccess: "You've unlocked free shipping!",
  },
  bundles: {
    heading: "Ordering more than one?",
    note: "Ordered together, they travel in one parcel. That saving is yours, taken off at checkout.",
    highlightColor: "#111111",
  },
  checkout: {
    enabled: true,
    percent: 10,
    expiryDays: 30,
    heading: "Thank you! Here's {percent}% off your next order",
    body: "Use this personal code at checkout. It's valid for {days} days.",
    onlyForBuyer: true,
  },
};

export type SettingsMap = typeof DEFAULT_SETTINGS;
export type SettingsKey = keyof SettingsMap;

/**
 * Builds typed settings from form data. Booleans come from switches and
 * checkboxes, which are left out of the form data when off.
 */
export function settingsFromForm<K extends SettingsKey>(
  key: K,
  form: FormData,
  previous: SettingsMap[K],
): SettingsMap[K] {
  const defaults = DEFAULT_SETTINGS[key] as Record<string, unknown>;
  const next: Record<string, unknown> = { ...previous };
  for (const [field, def] of Object.entries(defaults)) {
    if (typeof def === "boolean") {
      next[field] = form.has(field);
      continue;
    }
    if (!form.has(field)) continue;
    // Multi-select fields (e.g. payment badges) submit one entry per choice.
    const raw = form
      .getAll(field)
      .map((v) => String(v).trim())
      .filter(Boolean)
      .join(",");
    if (typeof def === "number") {
      const n = Number(raw.replace(",", "."));
      next[field] = Number.isFinite(n) ? n : def;
    } else {
      next[field] = raw;
    }
  }
  return next as SettingsMap[K];
}

/** Fills in defaults for keys missing from stored settings (e.g. after an upgrade). */
export function withDefaults<K extends SettingsKey>(
  key: K,
  stored: unknown,
): SettingsMap[K] {
  const base = DEFAULT_SETTINGS[key];
  if (!stored || typeof stored !== "object") return { ...base };
  const out: Record<string, unknown> = { ...base };
  for (const [field, def] of Object.entries(base)) {
    const value = (stored as Record<string, unknown>)[field];
    if (value !== undefined && typeof value === typeof def) out[field] = value;
  }
  return out as SettingsMap[K];
}

export type FieldErrors = Record<string, string>;

const HEX = /^#[0-9a-f]{6}$/i;

/** Server-side checks. Returns a message per field that needs fixing. */
export function validateSettings<K extends SettingsKey>(
  key: K,
  s: SettingsMap[K],
): FieldErrors {
  const errors: FieldErrors = {};
  const v = s as Record<string, unknown>;
  for (const [field, value] of Object.entries(v)) {
    if (
      typeof value === "string" &&
      /color|background|accent/i.test(field) &&
      value &&
      !HEX.test(value)
    ) {
      errors[field] = "Use a colour like #111111";
    }
  }
  switch (key) {
    case "bookkeeping": {
      const url = v.n8nWebhookUrl as string;
      if (url && !/^https:\/\/\S+$/.test(url)) {
        errors.n8nWebhookUrl = "Paste the full https:// webhook URL from n8n";
      }
      break;
    }
    case "stock": {
      if ((v.showBelow as number) < 1) errors.showBelow = "Use 1 or more";
      if (!String(v.message).includes("{count}")) {
        errors.message = "Include {count} where the number should go";
      }
      break;
    }
    case "countdown": {
      if (v.mode === "fixed" && v.enabled && !v.endDate) {
        errors.endDate = "Pick the day the countdown ends";
      }
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v.endTime))) {
        errors.endTime = "Use a time like 23:59";
      }
      if (!String(v.message).trim()) errors.message = "Write a short message";
      break;
    }
    case "reviews": {
      const min = v.autoPublishMin as number;
      if (min < 0 || min > 5) errors.autoPublishMin = "Pick 0 to 5";
      break;
    }
    case "salesKit": {
      if ((v.freeShippingThreshold as number) < 0) {
        errors.freeShippingThreshold = "Use 0 or more";
      }
      if ((v.popupInterval as number) < 5) {
        errors.popupInterval = "Use 5 seconds or more";
      }
      break;
    }
    case "checkout": {
      const pct = v.percent as number;
      if (pct < 1 || pct > 90) errors.percent = "Use 1 to 90";
      if ((v.expiryDays as number) < 1) errors.expiryDays = "Use 1 day or more";
      break;
    }
  }
  return errors;
}

/**
 * Converts a wall-clock date and time in a time zone to a UTC ISO string,
 * e.g. ("2026-11-30", "23:59", "Europe/Brussels") → "2026-11-30T22:59:00.000Z".
 */
export function zonedToUtc(day: string, time: string, timeZone: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!m || !t) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +t[1], +t[2]);
  const offset = (at: number) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(new Date(at));
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    return (
      Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute")) - at
    );
  };
  // Two passes handle the hour around a daylight-saving switch.
  let utc = guess - offset(guess);
  utc = guess - offset(utc);
  return new Date(utc).toISOString();
}

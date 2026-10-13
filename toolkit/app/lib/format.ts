// Formatting helpers shared by pages. The app UI is in English; numbers and
// money use Belgian/Dutch conventions because that is where the shop is.

const LOCALE = "nl-BE";

export function money(amount: number, currency = "EUR"): string {
  return new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency,
  }).format(amount || 0);
}

export function num(value: number, digits = 0): string {
  return new Intl.NumberFormat(LOCALE, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value || 0);
}

export function pct(value: number, digits = 0): string {
  return `${num(value, digits)}%`;
}

export function date(iso: string | Date, withTime = false): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    timeZone: "Europe/Brussels",
  }).format(d);
}

export function relative(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const seconds = Math.round((Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return date(d);
}

/** "2026-10" → "October 2026" */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, 1)));
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${num(n)} ${n === 1 ? one : many}`;
}

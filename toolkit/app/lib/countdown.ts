import { zonedToUtc } from "./settings";

/** "YYYY-MM-DD" for a moment in a time zone. */
export function dayInZone(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/**
 * When the bar should count down to. Same rules as the storefront script
 * (extensions/toolkit-theme/assets/countdown-bar.js).
 */
export function countdownTarget(
  mode: string,
  endDate: string,
  endTime: string,
  timeZone: string,
  now = new Date(),
): Date | null {
  if (mode === "daily") {
    const today = zonedToUtc(dayInZone(now, timeZone), endTime, timeZone);
    if (!today) return null;
    const t = new Date(today);
    if (t > now) return t;
    const tomorrow = new Date(now.getTime() + 24 * 3600 * 1000);
    const next = zonedToUtc(dayInZone(tomorrow, timeZone), endTime, timeZone);
    return next ? new Date(next) : null;
  }
  const fixed = zonedToUtc(endDate, endTime, timeZone);
  return fixed ? new Date(fixed) : null;
}

/** Remaining time as "2d 04:05:06" or "04:05:06". */
export function formatRemaining(ms: number): string {
  if (ms <= 0) return "00:00:00";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const pad = (n: number) => String(n).padStart(2, "0");
  const hms = `${pad(Math.floor((s % 86400) / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  return d ? `${d}d ${hms}` : hms;
}

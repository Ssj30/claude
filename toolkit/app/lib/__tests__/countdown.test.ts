import { describe, expect, it } from "vitest";
import { countdownTarget, formatRemaining } from "../countdown";
import { zonedToUtc } from "../settings";

describe("zonedToUtc", () => {
  it("handles summer and winter time in Brussels", () => {
    expect(zonedToUtc("2026-07-01", "12:00", "Europe/Brussels")).toBe("2026-07-01T10:00:00.000Z");
    expect(zonedToUtc("2026-12-01", "12:00", "Europe/Brussels")).toBe("2026-12-01T11:00:00.000Z");
  });

  it("rejects bad input", () => {
    expect(zonedToUtc("", "12:00", "Europe/Brussels")).toBeNull();
    expect(zonedToUtc("2026-12-01", "noon", "Europe/Brussels")).toBeNull();
  });
});

describe("countdownTarget", () => {
  it("rolls a daily cut-off over to tomorrow once passed", () => {
    const now = new Date("2026-12-01T15:00:00Z"); // 16:00 Brussels
    expect(countdownTarget("daily", "", "15:00", "Europe/Brussels", now)?.toISOString()).toBe(
      "2026-12-02T14:00:00.000Z",
    );
    expect(countdownTarget("daily", "", "17:00", "Europe/Brussels", now)?.toISOString()).toBe(
      "2026-12-01T16:00:00.000Z",
    );
  });

  it("uses the fixed date", () => {
    expect(countdownTarget("fixed", "2026-12-24", "23:59", "Europe/Brussels")?.toISOString()).toBe(
      "2026-12-24T22:59:00.000Z",
    );
  });

  it("formats the remaining time", () => {
    expect(formatRemaining(3_723_000)).toBe("01:02:03");
    expect(formatRemaining(90_000_000)).toBe("1d 01:00:00");
    expect(formatRemaining(-5)).toBe("00:00:00");
  });
});

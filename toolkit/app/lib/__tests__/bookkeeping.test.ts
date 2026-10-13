import { describe, expect, it } from "vitest";
import {
  buildMonthReport,
  currentMonth,
  monthBounds,
  ordersSearchQuery,
  reportCsv,
  shiftMonth,
  type RawOrder,
} from "../bookkeeping";

const m = (amount: number) => ({ shopMoney: { amount: amount.toFixed(2) } });

function order(partial: Partial<RawOrder> & { total: number; vat?: number }): RawOrder {
  const vat = partial.vat ?? Math.round((partial.total - partial.total / 1.21) * 100) / 100;
  return {
    id: partial.id ?? "gid://shopify/Order/1",
    name: partial.name ?? "#1001",
    createdAt: partial.createdAt ?? "2026-10-05T10:00:00Z",
    cancelledAt: partial.cancelledAt ?? null,
    test: false,
    displayFinancialStatus: partial.displayFinancialStatus ?? "PAID",
    customer: { displayName: "Anna Peeters" },
    billingAddress: { countryCodeV2: partial.billingAddress?.countryCodeV2 ?? "BE", company: null },
    subtotalPriceSet: m(partial.total),
    totalDiscountsSet: m(0),
    totalShippingPriceSet: m(0),
    totalTaxSet: m(vat),
    totalPriceSet: m(partial.total),
    totalRefundedSet: partial.totalRefundedSet ?? m(0),
    taxLines: partial.taxLines ?? [{ title: "BE BTW", rate: 0.21, priceSet: m(vat) }],
  };
}

describe("month helpers", () => {
  it("computes bounds across a year end", () => {
    expect(monthBounds("2026-12")).toEqual(["2026-12-01", "2027-01-01"]);
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });

  it("builds an orders search query", () => {
    // October starts in summer time (UTC+2) and ends in winter time (UTC+1).
    expect(ordersSearchQuery("2026-10", true)).toBe(
      "created_at:>='2026-09-30T22:00:00Z' AND created_at:<'2026-10-31T23:00:00Z' AND test:false",
    );
  });

  it("uses Brussels time for the current month", () => {
    // 23:30 UTC on 31 Oct is already 1 Nov in Brussels (UTC+1 in winter).
    expect(currentMonth(new Date("2026-10-31T23:30:00Z"))).toBe("2026-11");
  });
});

describe("buildMonthReport", () => {
  const report = buildMonthReport("2026-10", [
    order({ id: "a", total: 121, createdAt: "2026-10-01T08:00:00Z" }),
    order({ id: "b", total: 60.5, createdAt: "2026-10-01T09:00:00Z", totalRefundedSet: m(60.5), billingAddress: { countryCodeV2: "NL", company: null } }),
    order({ id: "c", total: 999, cancelledAt: "2026-10-02T00:00:00Z" }),
  ]);

  it("leaves cancelled orders out of the totals", () => {
    expect(report.orderCount).toBe(2);
    expect(report.cancelledCount).toBe(1);
    expect(report.revenue).toBe(181.5);
  });

  it("splits VAT and refunds", () => {
    expect(report.vat).toBe(31.5);
    expect(report.revenueExVat).toBe(150);
    expect(report.refunds).toBe(60.5);
    expect(report.netRevenue).toBe(121);
  });

  it("groups VAT by rate with the taxable base", () => {
    expect(report.vatLines).toEqual([{ label: "BE BTW 21%", rate: 0.21, vat: 31.5, base: 150 }]);
  });

  it("puts revenue on the right day and country", () => {
    expect(report.daily[0]).toBe(181.5);
    expect(report.daily).toHaveLength(31);
    expect(report.countries.map((c) => c.country)).toEqual(["BE", "NL"]);
  });

  it("writes an Excel-friendly CSV", () => {
    const csv = reportCsv(report);
    expect(csv.startsWith("﻿Order;Date;")).toBe(true);
    expect(csv).toContain(";121,00;");
    expect(csv.split("\r\n")).toHaveLength(5); // header + 3 orders + trailing newline
  });
});

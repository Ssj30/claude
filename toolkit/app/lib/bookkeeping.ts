// Turns Shopify orders into the monthly numbers an accountant needs.
// Pure functions, so they are unit tested and safe to use on the client.
import { zonedToUtc } from "./settings";

export interface RawOrder {
  id: string;
  name: string;
  createdAt: string;
  cancelledAt: string | null;
  test: boolean;
  displayFinancialStatus: string | null;
  customer: { displayName: string } | null;
  billingAddress: { countryCodeV2: string | null; company: string | null } | null;
  subtotalPriceSet: MoneyBag;
  totalDiscountsSet: MoneyBag;
  totalShippingPriceSet: MoneyBag;
  totalTaxSet: MoneyBag;
  totalPriceSet: MoneyBag;
  totalRefundedSet: MoneyBag;
  taxLines: { title: string; rate: number | null; priceSet: MoneyBag }[];
}

interface MoneyBag {
  shopMoney: { amount: string };
}

export interface LedgerOrder {
  id: string;
  name: string;
  createdAt: string;
  customer: string;
  company: string;
  country: string;
  status: string;
  subtotal: number;
  discounts: number;
  shipping: number;
  vat: number;
  total: number;
  refunded: number;
  net: number;
  taxLines: { title: string; rate: number; amount: number }[];
}

export interface VatLine {
  label: string;
  rate: number;
  vat: number;
  /** The amount the VAT was charged on (VAT / rate). */
  base: number;
}

export interface MonthReport {
  month: string;
  orderCount: number;
  cancelledCount: number;
  revenue: number;
  refunds: number;
  netRevenue: number;
  vat: number;
  revenueExVat: number;
  shipping: number;
  discounts: number;
  averageOrder: number;
  vatLines: VatLine[];
  countries: { country: string; orders: number; revenue: number }[];
  /** Revenue per day of the month, index 0 = day 1. */
  daily: number[];
  orders: LedgerOrder[];
}

const amount = (bag: MoneyBag | null | undefined) =>
  Number(bag?.shopMoney?.amount ?? 0) || 0;

const round2 = (n: number) => Math.round(n * 100) / 100;

export function toLedgerOrder(o: RawOrder): LedgerOrder {
  const total = amount(o.totalPriceSet);
  const refunded = amount(o.totalRefundedSet);
  return {
    id: o.id,
    name: o.name,
    createdAt: o.createdAt,
    customer: o.customer?.displayName ?? "",
    company: o.billingAddress?.company ?? "",
    country: o.billingAddress?.countryCodeV2 ?? "",
    status: o.cancelledAt ? "CANCELLED" : (o.displayFinancialStatus ?? ""),
    subtotal: amount(o.subtotalPriceSet),
    discounts: amount(o.totalDiscountsSet),
    shipping: amount(o.totalShippingPriceSet),
    vat: amount(o.totalTaxSet),
    total,
    refunded,
    net: round2(total - refunded),
    taxLines: o.taxLines.map((t) => ({
      title: t.title,
      rate: t.rate ?? 0,
      amount: amount(t.priceSet),
    })),
  };
}

/** "2026-10" → ["2026-10-01", "2026-11-01"] */
export function monthBounds(month: string): [string, string] {
  const [y, m] = month.split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  const next = m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`;
  return [`${y}-${pad(m)}-01`, `${next}-01`];
}

/**
 * Search query for one month in Belgian time. Uses exact UTC timestamps:
 * a bare date like created_at:<'2026-10-01' also matches orders on 1 October.
 */
export function ordersSearchQuery(month: string, excludeTest: boolean): string {
  const [from, to] = monthBounds(month).map((day) =>
    zonedToUtc(day, "00:00", "Europe/Brussels")!.replace(".000Z", "Z"),
  );
  const parts = [`created_at:>='${from}'`, `created_at:<'${to}'`];
  if (excludeTest) parts.push("test:false");
  return parts.join(" AND ");
}

export function isMonth(value: string | null | undefined): value is string {
  return !!value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function currentMonth(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Brussels",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value;
  return `${get("year")}-${get("month")}`;
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Day of the month in Brussels time, 1-based. */
function brusselsDay(iso: string): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Brussels",
      day: "numeric",
    }).format(new Date(iso)),
  );
}

export function buildMonthReport(month: string, raw: RawOrder[]): MonthReport {
  const all = raw.map(toLedgerOrder);
  const counted = all.filter((o) => o.status !== "CANCELLED");
  const sum = (f: (o: LedgerOrder) => number) =>
    round2(counted.reduce((acc, o) => acc + f(o), 0));

  const revenue = sum((o) => o.total);
  const refunds = sum((o) => o.refunded);
  const vat = sum((o) => o.vat);

  const vatMap = new Map<string, VatLine>();
  for (const o of counted) {
    for (const t of o.taxLines) {
      const label = `${t.title} ${round2(t.rate * 100)}%`;
      const line = vatMap.get(label) ?? { label, rate: t.rate, vat: 0, base: 0 };
      line.vat = round2(line.vat + t.amount);
      line.base = t.rate ? round2(line.vat / t.rate) : 0;
      vatMap.set(label, line);
    }
  }

  const countryMap = new Map<string, { country: string; orders: number; revenue: number }>();
  for (const o of counted) {
    const key = o.country || "—";
    const c = countryMap.get(key) ?? { country: key, orders: 0, revenue: 0 };
    c.orders += 1;
    c.revenue = round2(c.revenue + o.total);
    countryMap.set(key, c);
  }

  const daily = new Array(daysInMonth(month)).fill(0);
  for (const o of counted) {
    const day = brusselsDay(o.createdAt);
    if (day >= 1 && day <= daily.length) {
      daily[day - 1] = round2(daily[day - 1] + o.total);
    }
  }

  return {
    month,
    orderCount: counted.length,
    cancelledCount: all.length - counted.length,
    revenue,
    refunds,
    netRevenue: round2(revenue - refunds),
    vat,
    revenueExVat: round2(revenue - vat),
    shipping: sum((o) => o.shipping),
    discounts: sum((o) => o.discounts),
    averageOrder: counted.length ? round2(revenue / counted.length) : 0,
    vatLines: [...vatMap.values()].sort((a, b) => b.rate - a.rate),
    countries: [...countryMap.values()].sort((a, b) => b.revenue - a.revenue),
    daily,
    orders: all,
  };
}

/**
 * CSV for the accountant. Semicolons and decimal commas so it opens
 * correctly in Excel with Belgian/Dutch settings; UTF-8 BOM for accents.
 */
export function reportCsv(report: MonthReport): string {
  const dec = (n: number) => n.toFixed(2).replace(".", ",");
  const cell = (v: string) =>
    /[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  const header = [
    "Order",
    "Date",
    "Customer",
    "Company",
    "Country",
    "Status",
    "Subtotal",
    "Discounts",
    "Shipping",
    "VAT",
    "Total",
    "Refunded",
    "Net",
  ];
  const rows = report.orders.map((o) =>
    [
      cell(o.name),
      o.createdAt.slice(0, 10),
      cell(o.customer),
      cell(o.company),
      o.country,
      o.status,
      dec(o.subtotal),
      dec(o.discounts),
      dec(o.shipping),
      dec(o.vat),
      dec(o.total),
      dec(o.refunded),
      dec(o.net),
    ].join(";"),
  );
  return "﻿" + [header.join(";"), ...rows].join("\r\n") + "\r\n";
}

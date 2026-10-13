import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getSettings } from "../lib/admin.server";
import { loadMonthReport } from "../lib/bookkeeping.server";
import { isMonth, reportCsv } from "../lib/bookkeeping";

// GET /app/bookkeeping/export?month=2026-10 → CSV of that month's orders.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const month = new URL(request.url).searchParams.get("month");
  if (!isMonth(month)) {
    return new Response("Unknown month", { status: 400 });
  }
  const settings = await getSettings(session.shop, "bookkeeping");
  const report = await loadMonthReport(admin, month, settings.excludeTestOrders);
  return new Response(reportCsv(report), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="911nights-orders-${month}.csv"`,
    },
  });
};

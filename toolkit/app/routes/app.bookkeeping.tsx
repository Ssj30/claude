import { useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  getSettings,
  getShopInfo,
  saveSettingsFromForm,
} from "../lib/admin.server";
import { loadMonthReport } from "../lib/bookkeeping.server";
import {
  currentMonth,
  isMonth,
  monthBounds,
  shiftMonth,
} from "../lib/bookkeeping";
import { postToN8n } from "../lib/n8n.server";
import { date, money, monthLabel, num, pct, relative } from "../lib/format";
import { DailyBars, ModuleIntro, StatGrid } from "../components/ui";
import {
  errorResult,
  SettingsForm,
  useActionFetcher,
} from "../components/SettingsForm";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const thisMonth = currentMonth();
  const requested = url.searchParams.get("month");
  const month = isMonth(requested) && requested <= thisMonth ? requested : thisMonth;

  const settings = await getSettings(session.shop, "bookkeeping");
  const [shop, report, logs] = await Promise.all([
    getShopInfo(admin),
    loadMonthReport(admin, month, settings.excludeTestOrders),
    db.syncLog.findMany({
      where: { shop: session.shop },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
  ]);

  // Without the read_all_orders permission Shopify only returns the last 60 days.
  const [monthStart] = monthBounds(month);
  const olderThan60Days =
    Date.now() - new Date(monthStart).getTime() > 60 * 24 * 3600 * 1000;

  return {
    month,
    thisMonth,
    shop,
    report,
    settings,
    logs: logs.map((l) => ({ ...l, createdAt: l.createdAt.toISOString() })),
    olderThan60Days,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent"));

  if (intent === "save") {
    return saveSettingsFromForm(admin, session.shop, "bookkeeping", form);
  }

  const settings = await getSettings(session.shop, "bookkeeping");
  if (!settings.n8nWebhookUrl) {
    return { ok: false, intent, error: "Add your n8n webhook URL first." };
  }

  try {
    if (intent === "test") {
      const result = await postToN8n(session.shop, settings, "test", "Test message", {
        message: "Hello from 911 Toolkit",
      });
      return result.ok
        ? { ok: true, intent, message: "n8n received the test message" }
        : { ok: false, intent, error: result.detail };
    }
    if (intent === "send-month") {
      const month = String(form.get("month"));
      if (!isMonth(month)) return { ok: false, intent, error: "Unknown month" };
      const report = await loadMonthReport(admin, month, settings.excludeTestOrders);
      const result = await postToN8n(
        session.shop,
        settings,
        "month.report",
        `${monthLabel(month)}: ${report.orderCount} orders`,
        report,
      );
      return result.ok
        ? { ok: true, intent, message: `${monthLabel(month)} sent to n8n` }
        : { ok: false, intent, error: result.detail };
    }
  } catch (error) {
    return errorResult(error, intent);
  }
  return { ok: false, intent, error: "Unknown action" };
};

export default function Bookkeeping() {
  const { month, thisMonth, shop, report, settings, logs, olderThan60Days } =
    useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const actions = useActionFetcher();
  const [exporting, setExporting] = useState(false);
  const currency = shop.currency;
  const label = monthLabel(month);
  const connected = !!settings.n8nWebhookUrl;
  const lastLog = logs[0];

  const exportCsv = async () => {
    setExporting(true);
    try {
      // App Bridge adds the session token to same-origin fetches.
      const response = await fetch(`/app/bookkeeping/export?month=${month}`);
      if (!response.ok) throw new Error(await response.text());
      const blob = await response.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `911nights-orders-${month}.csv`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch {
      shopify.toast.show("Export failed, try again", { isError: true });
    } finally {
      setExporting(false);
    }
  };

  return (
    <s-page heading="Bookkeeping" inlineSize="large">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={exportCsv}
        {...(exporting ? { loading: true } : {})}
      >
        Export {label} (CSV)
      </s-button>
      <s-button
        slot="secondary-actions"
        disabled={!connected}
        onClick={() => actions.run("send-month", { month })}
        {...(actions.busy("send-month") ? { loading: true } : {})}
      >
        Send {label} to n8n
      </s-button>

      <ModuleIntro
        module="bookkeeping"
        status={
          !connected
            ? { label: "n8n not connected", tone: "warning" }
            : lastLog && !lastLog.ok
              ? { label: "Last sync failed", tone: "critical" }
              : { label: "Syncing to n8n", tone: "success" }
        }
      />

      {/* Month switcher */}
      <s-section>
        <s-stack direction="inline" justifyContent="space-between" alignItems="center">
          <s-button
            variant="tertiary"
            icon="chevron-left"
            href={`/app/bookkeeping?month=${shiftMonth(month, -1)}`}
          >
            {monthLabel(shiftMonth(month, -1))}
          </s-button>
          <s-heading>{label}</s-heading>
          <s-button
            variant="tertiary"
            icon="chevron-right"
            disabled={month >= thisMonth}
            href={`/app/bookkeeping?month=${shiftMonth(month, 1)}`}
          >
            {monthLabel(shiftMonth(month, 1))}
          </s-button>
        </s-stack>
      </s-section>

      {olderThan60Days && report.orderCount === 0 && (
        <s-banner tone="info" heading="Older months need one extra permission">
          Shopify only shares the last 60 days of orders with apps by default.
          To see older months, request “Read all orders” for this app in your
          Shopify Partner Dashboard (API access).
        </s-banner>
      )}

      <s-section heading={`${label} at a glance`}>
        <s-stack gap="base">
          <StatGrid
            items={[
              {
                label: "Revenue (incl. VAT)",
                value: money(report.revenue, currency),
                hint: `${num(report.orderCount)} orders`,
              },
              { label: "VAT collected", value: money(report.vat, currency) },
              {
                label: "Revenue excl. VAT",
                value: money(report.revenueExVat, currency),
              },
              {
                label: "Refunds",
                value: money(report.refunds, currency),
                hint: report.revenue
                  ? `${pct((report.refunds / report.revenue) * 100, 1)} of revenue`
                  : undefined,
                tone: report.refunds > 0 ? "warning" : undefined,
              },
              {
                label: "Net after refunds",
                value: money(report.netRevenue, currency),
              },
              {
                label: "Average order",
                value: money(report.averageOrder, currency),
                hint: `Shipping ${money(report.shipping, currency)} · Discounts ${money(report.discounts, currency)}`,
              },
            ]}
          />
          {report.orderCount > 0 && (
            <s-box padding="base" border="base" borderRadius="base">
              <s-stack gap="small">
                <s-text type="strong">Revenue per day</s-text>
                <DailyBars values={report.daily} currency={currency} monthLabel={label} />
              </s-stack>
            </s-box>
          )}
        </s-stack>
      </s-section>

      <s-section heading="VAT breakdown" padding="none">
        {report.vatLines.length === 0 ? (
          <s-box padding="base">
            <s-paragraph color="subdued">
              No VAT was charged on any order in {label}.
              {report.orderCount > 0 &&
                " If you are VAT-registered, check your tax setup in Shopify under Settings → Taxes and duties."}
            </s-paragraph>
          </s-box>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Rate</s-table-header>
              <s-table-header format="currency">Taxable amount</s-table-header>
              <s-table-header format="currency">VAT</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {report.vatLines.map((line) => (
                <s-table-row key={line.label}>
                  <s-table-cell>{line.label}</s-table-cell>
                  <s-table-cell>{money(line.base, currency)}</s-table-cell>
                  <s-table-cell>{money(line.vat, currency)}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section heading={`Orders in ${label}`} padding="none">
        {report.orders.length === 0 ? (
          <s-box padding="base">
            <s-text color="subdued">No orders in {label}.</s-text>
          </s-box>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Order</s-table-header>
              <s-table-header>Date</s-table-header>
              <s-table-header listSlot="secondary">Customer</s-table-header>
              <s-table-header>Country</s-table-header>
              <s-table-header listSlot="inline">Status</s-table-header>
              <s-table-header format="currency">VAT</s-table-header>
              <s-table-header format="currency">Total</s-table-header>
              <s-table-header format="currency">Refunded</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {report.orders.map((o) => (
                <s-table-row key={o.id}>
                  <s-table-cell>
                    <s-link
                      href={`shopify://admin/orders/${o.id.split("/").pop()}`}
                    >
                      {o.name}
                    </s-link>
                  </s-table-cell>
                  <s-table-cell>{date(o.createdAt)}</s-table-cell>
                  <s-table-cell>{o.company || o.customer || "—"}</s-table-cell>
                  <s-table-cell>{o.country || "—"}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={statusTone(o.status)}>{statusLabel(o.status)}</s-badge>
                  </s-table-cell>
                  <s-table-cell>{money(o.vat, currency)}</s-table-cell>
                  <s-table-cell>{money(o.total, currency)}</s-table-cell>
                  <s-table-cell>{o.refunded ? money(o.refunded, currency) : "—"}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section slot="aside" heading="n8n connection">
        <SettingsForm>
          {(errors) => (
            <>
              <s-url-field
                label="n8n webhook URL"
                name="n8nWebhookUrl"
                defaultValue={settings.n8nWebhookUrl}
                placeholder="https://your-n8n/webhook/…"
                details="From the Webhook node in your n8n workflow (production URL)."
                error={errors.n8nWebhookUrl}
              />
              <s-password-field
                label="Shared secret (optional)"
                name="n8nSecret"
                defaultValue={settings.n8nSecret}
                details="Sent as the X-Toolkit-Secret header so n8n can check the call is really from your shop."
              />
              <s-switch
                label="Send every new order, payment and refund automatically"
                name="autoForward"
                defaultChecked={settings.autoForward}
              />
              <s-switch
                label="Leave out test orders"
                name="excludeTestOrders"
                defaultChecked={settings.excludeTestOrders}
              />
            </>
          )}
        </SettingsForm>
        <s-box paddingBlockStart="base">
          <s-button
            disabled={!connected}
            onClick={() => actions.run("test")}
            {...(actions.busy("test") ? { loading: true } : {})}
          >
            Send test message
          </s-button>
        </s-box>
      </s-section>

      <s-section slot="aside" heading="Recent syncs">
        {logs.length === 0 ? (
          <s-text color="subdued">
            Nothing sent yet. New orders appear here once n8n is connected.
          </s-text>
        ) : (
          <s-stack gap="small">
            {logs.map((log) => (
              <s-stack key={log.id} direction="inline" gap="small" alignItems="center">
                <s-icon
                  type={log.ok ? "check-circle" : "alert-circle"}
                  tone={log.ok ? "success" : "critical"}
                />
                <s-stack gap="none">
                  <s-text>{log.label}</s-text>
                  <s-text color="subdued">
                    {relative(log.createdAt)}
                    {log.ok ? "" : ` · ${log.detail}`}
                  </s-text>
                </s-stack>
              </s-stack>
            ))}
          </s-stack>
        )}
      </s-section>

      {report.countries.length > 1 && (
        <s-section slot="aside" heading="Sales by country">
          <s-stack gap="small">
            {report.countries.slice(0, 8).map((c) => (
              <s-stack key={c.country} direction="inline" justifyContent="space-between">
                <s-text>
                  {c.country} · {num(c.orders)}
                </s-text>
                <s-text>{money(c.revenue, currency)}</s-text>
              </s-stack>
            ))}
          </s-stack>
        </s-section>
      )}
    </s-page>
  );
}

function statusLabel(status: string): string {
  if (!status) return "Unknown";
  return status
    .toLowerCase()
    .split("_")
    .map((w, i) => (i === 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function statusTone(status: string) {
  switch (status) {
    case "PAID":
      return "success" as const;
    case "REFUNDED":
    case "PARTIALLY_REFUNDED":
      return "warning" as const;
    case "CANCELLED":
    case "VOIDED":
      return "critical" as const;
    case "PENDING":
    case "AUTHORIZED":
      return "info" as const;
    default:
      return "neutral" as const;
  }
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

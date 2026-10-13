import { useRef } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  getSettings,
  getShopInfo,
  gql,
  saveSettingsFromForm,
} from "../lib/admin.server";
import { REWARD_CODES_QUERY } from "../lib/queries";
import { recentOrders } from "../lib/salesKit.server";
import { date, money, num, pct } from "../lib/format";
import { ModuleIntro, StatGrid, useFormValues } from "../components/ui";
import { SettingsForm } from "../components/SettingsForm";

interface CodeNode {
  id: string;
  discount: {
    __typename: string;
    title?: string;
    status?: string;
    createdAt?: string;
    endsAt?: string | null;
    asyncUsageCount?: number;
    codes?: { nodes: { code: string }[] };
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const [settings, shop, codesData, orders, lastIssued] = await Promise.all([
    getSettings(session.shop, "checkout"),
    getShopInfo(admin),
    gql<{ discountNodes: { nodes: CodeNode[] } }>(admin, REWARD_CODES_QUERY),
    recentOrders(admin, `created_at:>='${since}' AND test:false`),
    db.rewardCode.findFirst({
      where: { shop: session.shop },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const codes = codesData.discountNodes.nodes
    .filter((n) => n.discount.__typename === "DiscountCodeBasic")
    .map((n) => ({
      id: n.id,
      code: n.discount.codes?.nodes[0]?.code ?? "",
      status: n.discount.status ?? "",
      createdAt: n.discount.createdAt ?? "",
      endsAt: n.discount.endsAt ?? null,
      used: (n.discount.asyncUsageCount ?? 0) > 0,
    }));

  const repeatOrders = orders.filter((o) =>
    o.discountApplications.nodes.some((d) => d.code?.toUpperCase().startsWith("THANKS-")),
  );

  return {
    settings,
    currency: shop.currency,
    codes,
    lastIssued: lastIssued?.createdAt.toISOString() ?? null,
    stats: {
      issued: codes.length,
      redeemed: codes.filter((c) => c.used).length,
      repeatOrders: repeatOrders.length,
      repeatRevenue: repeatOrders.reduce((s, o) => s + Number(o.totalPriceSet.shopMoney.amount), 0),
    },
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  return saveSettingsFromForm(admin, session.shop, "checkout", form);
};

export default function CheckoutKit() {
  const { settings, currency, codes, stats, lastIssued } = useLoaderData<typeof loader>();
  const formRef = useRef<HTMLFormElement>(null);
  const live = useFormValues(formRef, settings);

  return (
    <s-page heading="Checkout Kit">
      <s-button slot="secondary-actions" href="shopify://admin/settings/checkout">
        Open checkout editor
      </s-button>

      <ModuleIntro
        module="checkout"
        status={
          !settings.enabled
            ? { label: "Off", tone: "neutral" }
            : lastIssued
              ? { label: "Giving out codes", tone: "success" }
              : { label: "Waiting for the first order", tone: "info" }
        }
      >
        {!lastIssued && (
          <s-box padding="base" background="subdued" borderRadius="base">
            <s-stack gap="small">
              <s-text type="strong">One-time setup</s-text>
              <s-ordered-list>
                <s-list-item>Click “Open checkout editor” (top right), then “Customize”.</s-list-item>
                <s-list-item>Switch the page selector at the top to “Thank you”.</s-list-item>
                <s-list-item>Add the app block “Thank-you reward” and save.</s-list-item>
              </s-ordered-list>
              <s-text color="subdued">
                After that, every buyer sees a personal code on the thank-you page.
              </s-text>
            </s-stack>
          </s-box>
        )}
      </ModuleIntro>

      <s-section heading="Results">
        <StatGrid
          items={[
            { label: "Codes given out", value: num(stats.issued), hint: "Most recent 100" },
            {
              label: "Codes used",
              value: num(stats.redeemed),
              hint: stats.issued ? `${pct((stats.redeemed / stats.issued) * 100)} came back` : undefined,
            },
            {
              label: "Repeat orders, last 30 days",
              value: num(stats.repeatOrders),
              hint: stats.repeatOrders ? `${money(stats.repeatRevenue, currency)} revenue` : undefined,
            },
          ]}
        />
      </s-section>

      <s-section heading="Thank-you page reward">
        <SettingsForm formRef={formRef}>
          {(errors) => (
            <>
              <s-switch
                label="Give every buyer a code for their next order"
                name="enabled"
                defaultChecked={settings.enabled}
              />
              <s-grid gridTemplateColumns="1fr 1fr" gap="base">
                <s-number-field
                  label="Discount"
                  name="percent"
                  suffix="%"
                  min={1}
                  max={90}
                  defaultValue={String(settings.percent)}
                  error={errors.percent}
                />
                <s-number-field
                  label="Valid for"
                  name="expiryDays"
                  suffix="days"
                  min={1}
                  defaultValue={String(settings.expiryDays)}
                  error={errors.expiryDays}
                />
              </s-grid>
              <s-text-field
                label="Heading"
                name="heading"
                defaultValue={settings.heading}
                details="{percent} and {days} are filled in for you."
              />
              <s-text-area label="Text" name="body" rows={2} defaultValue={settings.body} />
              <s-switch
                label="Only the buyer can use their code (when they have a customer account)"
                name="onlyForBuyer"
                defaultChecked={settings.onlyForBuyer}
              />
              <RewardPreview values={live} />
            </>
          )}
        </SettingsForm>
      </s-section>

      <s-section heading="Recent codes" padding="none">
        {codes.length === 0 ? (
          <s-box padding="base">
            <s-text color="subdued">No codes yet. They appear here after the next order.</s-text>
          </s-box>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Code</s-table-header>
              <s-table-header>Given out</s-table-header>
              <s-table-header>Expires</s-table-header>
              <s-table-header listSlot="inline">Status</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {codes.slice(0, 25).map((c) => (
                <s-table-row key={c.id}>
                  <s-table-cell>
                    <s-link href={`shopify://admin/discounts/${c.id.split("/").pop()}`}>
                      {c.code}
                    </s-link>
                  </s-table-cell>
                  <s-table-cell>{c.createdAt ? date(c.createdAt) : "—"}</s-table-cell>
                  <s-table-cell>{c.endsAt ? date(c.endsAt) : "Never"}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={c.used ? "success" : c.status === "EXPIRED" ? "neutral" : "info"}>
                      {c.used ? "Used" : c.status === "EXPIRED" ? "Expired" : "Not used yet"}
                    </s-badge>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

function RewardPreview({ values }: { values: Record<string, string | boolean> }) {
  const fill = (t: string) =>
    t.replaceAll("{percent}", String(values.percent)).replaceAll("{days}", String(values.expiryDays));
  return (
    <s-box padding="base" background="subdued" borderRadius="base">
      <s-stack gap="small">
        <s-text color="subdued">Preview on the thank-you page</s-text>
        <div
          style={{
            background: "#fff",
            border: "1px solid #e3e3e3",
            borderRadius: 10,
            padding: 16,
            maxWidth: 420,
            opacity: values.enabled ? 1 : 0.5,
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 15 }}>{fill(String(values.heading))}</div>
          <div style={{ color: "#616161", fontSize: 13, margin: "4px 0 12px" }}>{fill(String(values.body))}</div>
          <div style={{ display: "flex", gap: 8 }}>
            <div
              style={{
                flex: 1,
                border: "1.5px dashed #8a8a8a",
                borderRadius: 8,
                padding: "8px 12px",
                fontFamily: "monospace",
                fontSize: 15,
                letterSpacing: 1,
              }}
            >
              THANKS-7KQ4MZ
            </div>
            <div style={{ border: "1px solid #c9c9c9", borderRadius: 8, padding: "8px 12px", fontSize: 13 }}>
              Copy
            </div>
          </div>
        </div>
      </s-stack>
    </s-box>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

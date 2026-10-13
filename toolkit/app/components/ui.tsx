// Shared building blocks so all seven module pages look and behave the same.
import { useEffect, useState, type ReactNode, type RefObject } from "react";
import {
  type ModuleKey,
  moduleInfo,
  themeEditorUrl,
  type ThemeHook,
} from "../lib/modules";
import { money } from "../lib/format";

export type Tone = "success" | "critical" | "warning" | "info" | "neutral";

export interface ModuleStatus {
  /** e.g. "Active", "Off", "Needs setup" */
  label: string;
  tone: Tone;
}

const HOOK_LABEL: Record<string, string> = {
  "countdown-bar": "Countdown bar (app embed)",
  "stock-counter": "Stock counter (product page block)",
  reviews: "Reviews (product page block)",
  "rating-badge": "Star rating (product page block)",
  "reviews-carousel": "Reviews carousel (homepage block, optional)",
  "sales-kit": "Pop-ups & free-shipping bar (app embed)",
  "trust-badges": "Trust badges (product page block)",
  "bundle-tiers": "Bundle offer table (product page block)",
};

/**
 * Top section on every module page: what the tool does, whether it's on,
 * and whether its storefront part is in the live theme (with a one-click fix).
 */
export function ModuleIntro({
  module,
  status,
  themeStatus,
  apiKey,
  shop,
  children,
}: {
  module: ModuleKey;
  status: ModuleStatus;
  themeStatus?: Record<string, boolean> | null;
  apiKey?: string;
  /** myshopify domain, for theme editor links */
  shop?: string;
  children?: ReactNode;
}) {
  const info = moduleInfo(module);
  return (
    <s-section>
      <s-stack gap="base">
        <s-stack direction="inline" gap="small" alignItems="center">
          <s-badge tone={status.tone}>{status.label}</s-badge>
          {info.formerly !== info.title && (
            <s-text color="subdued">Formerly “{info.formerly}”</s-text>
          )}
        </s-stack>
        <s-paragraph>{info.summary}</s-paragraph>
        {info.theme.length > 0 && apiKey && shop && (
          <ThemeChecklist
            hooks={info.theme}
            themeStatus={themeStatus ?? null}
            apiKey={apiKey}
            shop={shop}
          />
        )}
        {children}
      </s-stack>
    </s-section>
  );
}

function ThemeChecklist({
  hooks,
  themeStatus,
  apiKey,
  shop,
}: {
  hooks: ThemeHook[];
  themeStatus: Record<string, boolean> | null;
  apiKey: string;
  shop: string;
}) {
  return (
    <s-box padding="base" background="subdued" borderRadius="base">
      <s-stack gap="small">
        <s-text type="strong">On your store</s-text>
        {hooks.map((hook) => {
          const live = themeStatus?.[hook.handle];
          return (
            <s-stack
              key={hook.handle}
              direction="inline"
              gap="small"
              alignItems="center"
              justifyContent="space-between"
            >
              <s-stack direction="inline" gap="small" alignItems="center">
                <s-icon
                  type={live ? "check-circle" : "alert-circle"}
                  tone={live ? "success" : live === false ? "caution" : "neutral"}
                />
                <s-text>{HOOK_LABEL[hook.handle] ?? hook.handle}</s-text>
                <s-text color="subdued">
                  {live
                    ? "in your live theme"
                    : themeStatus
                      ? "not in your live theme yet"
                      : "status unknown"}
                </s-text>
              </s-stack>
              <s-button
                variant={live ? "tertiary" : "secondary"}
                href={themeEditorUrl(shop, apiKey, hook)}
                target="_top"
              >
                {live ? "Open in theme editor" : hook.kind === "embed" ? "Turn on in theme" : "Add to product page"}
              </s-button>
            </s-stack>
          );
        })}
      </s-stack>
    </s-box>
  );
}

export interface StatItem {
  label: string;
  value: string;
  hint?: string;
  tone?: Tone;
}

/** Row of headline numbers. Wraps to fewer columns on narrow screens. */
export function StatGrid({ items }: { items: StatItem[] }) {
  return (
    <s-grid
      gridTemplateColumns="repeat(auto-fit, minmax(150px, 1fr))"
      gap="base"
    >
      {items.map((item) => (
        <s-box
          key={item.label}
          padding="base"
          background="base"
          border="base"
          borderRadius="base"
        >
          <s-stack gap="small-200">
            <s-text color="subdued">{item.label}</s-text>
            <s-heading>
              <span style={{ fontSize: "1.5rem", fontVariantNumeric: "tabular-nums" }}>
                {item.value}
              </span>
            </s-heading>
            {item.hint && (
              <s-text color="subdued" tone={item.tone}>
                {item.hint}
              </s-text>
            )}
          </s-stack>
        </s-box>
      ))}
    </s-grid>
  );
}

/** Shows a server error from an action above the form it belongs to. */
export function ErrorBanner({ error }: { error?: string | null }) {
  if (!error) return null;
  return (
    <s-banner tone="critical" heading="That didn't work">
      {error}
    </s-banner>
  );
}

/**
 * Live values of a form, for previews. Polaris fields are form-associated,
 * so FormData sees them; we re-read on every input or change event.
 */
export function useFormValues(
  formRef: RefObject<HTMLFormElement | null>,
  initial: Record<string, unknown>,
): Record<string, string | boolean> {
  const toValues = (form: HTMLFormElement | null) => {
    const out: Record<string, string | boolean> = {};
    for (const [k, v] of Object.entries(initial)) {
      out[k] = typeof v === "boolean" ? v : String(v ?? "");
    }
    if (!form) return out;
    const data = new FormData(form);
    for (const k of Object.keys(initial)) {
      if (typeof initial[k] === "boolean") out[k] = data.has(k);
      else if (data.has(k)) out[k] = String(data.get(k));
    }
    return out;
  };
  const [values, setValues] = useState(() => toValues(null));
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    // Fields upgrade asynchronously; read once they're ready.
    const read = () => setValues(toValues(form));
    const t = setTimeout(read, 0);
    form.addEventListener("input", read);
    form.addEventListener("change", read);
    form.addEventListener("reset", () => setTimeout(read, 0));
    return () => {
      clearTimeout(t);
      form.removeEventListener("input", read);
      form.removeEventListener("change", read);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formRef]);
  return values;
}

/**
 * Daily revenue as columns. Single series, so no legend; each column has a
 * hover tooltip, and the numbers are also in the table below the chart.
 */
export function DailyBars({
  values,
  currency,
  monthLabel,
}: {
  values: number[];
  currency: string;
  monthLabel: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...values, 1);
  const width = 640;
  const height = 140;
  const band = width / values.length;
  const bar = Math.min(16, band - 2);
  const peak = values.indexOf(Math.max(...values));
  return (
    <div style={{ position: "relative" }}>
      <svg
        viewBox={`0 0 ${width} ${height + 18}`}
        width="100%"
        role="img"
        aria-label={`Revenue per day in ${monthLabel}`}
        style={{ display: "block" }}
      >
        <line
          x1={0}
          x2={width}
          y1={height}
          y2={height}
          stroke="rgba(0,0,0,0.15)"
          strokeWidth={1}
        />
        {values.map((v, i) => {
          const h = v > 0 ? Math.max(3, (v / max) * (height - 8)) : 0;
          const x = i * band + (band - bar) / 2;
          const y = height - h;
          const r = Math.min(4, h);
          // Rounded top, square at the baseline.
          const d =
            h > 0
              ? `M${x},${height} V${y + r} Q${x},${y} ${x + r},${y} H${x + bar - r} Q${x + bar},${y} ${x + bar},${y + r} V${height} Z`
              : "";
          return (
            <g
              key={i}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              {/* Hit target wider and taller than the mark. */}
              <rect x={i * band} y={0} width={band} height={height} fill="transparent" />
              {d && (
                <path
                  d={d}
                  fill="#3f6fd8"
                  opacity={hover === null || hover === i ? 1 : 0.45}
                />
              )}
              {(i === 0 || (i + 1) % 5 === 0) && (
                <text
                  x={i * band + band / 2}
                  y={height + 14}
                  textAnchor="middle"
                  fontSize={10}
                  fill="#616161"
                >
                  {i + 1}
                </text>
              )}
            </g>
          );
        })}
        {values[peak] > 0 && hover === null && (
          <text
            x={peak * band + band / 2}
            y={height - (values[peak] / max) * (height - 8) - 4}
            textAnchor="middle"
            fontSize={10}
            fill="#303030"
          >
            {money(values[peak], currency)}
          </text>
        )}
      </svg>
      {hover !== null && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: `${((hover + 0.5) / values.length) * 100}%`,
            transform: "translateX(-50%)",
            background: "#fff",
            border: "1px solid #e3e3e3",
            borderRadius: 8,
            padding: "4px 8px",
            fontSize: 12,
            boxShadow: "0 2px 6px rgba(0,0,0,.08)",
            pointerEvents: "none",
            whiteSpace: "nowrap",
          }}
        >
          Day {hover + 1}: <strong>{money(values[hover], currency)}</strong>
        </div>
      )}
    </div>
  );
}

/**
 * A delete button that asks first, using a Polaris modal (browser confirm()
 * dialogs can be blocked inside the admin).
 */
export function ConfirmDelete({
  id,
  label,
  heading,
  message,
  onConfirm,
}: {
  id: string;
  label: string;
  heading: string;
  message: string;
  onConfirm: () => void;
}) {
  const modalId = `confirm-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  return (
    <>
      <s-button
        tone="critical"
        icon="delete"
        accessibilityLabel={label}
        commandFor={modalId}
        command="--show"
      />
      <s-modal id={modalId} heading={heading}>
        <s-paragraph>{message}</s-paragraph>
        <s-button
          slot="primary-action"
          variant="primary"
          tone="critical"
          commandFor={modalId}
          command="--hide"
          onClick={onConfirm}
        >
          Delete
        </s-button>
        <s-button slot="secondary-actions" commandFor={modalId} command="--hide">
          Cancel
        </s-button>
      </s-modal>
    </>
  );
}

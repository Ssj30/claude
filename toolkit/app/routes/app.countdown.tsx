import { useEffect, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import {
  getSettings,
  getThemeStatus,
  saveSettingsFromForm,
} from "../lib/admin.server";
import { isLiveInTheme } from "../lib/modules";
import { countdownTarget, formatRemaining } from "../lib/countdown";
import { SHOP_TIME_ZONE } from "../lib/settings";
import { date } from "../lib/format";
import { ModuleIntro, useFormValues } from "../components/ui";
import { SettingsForm } from "../components/SettingsForm";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const [settings, themeStatus] = await Promise.all([
    getSettings(session.shop, "countdown"),
    getThemeStatus(admin),
  ]);
  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    shop: session.shop,
    settings,
    themeStatus,
    timeZone: SHOP_TIME_ZONE,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  return saveSettingsFromForm(admin, session.shop, "countdown", form);
};

export default function CountdownBar() {
  const { apiKey, shop, settings, themeStatus, timeZone } = useLoaderData<typeof loader>();
  const formRef = useRef<HTMLFormElement>(null);
  const live = useFormValues(formRef, settings);
  const inTheme = isLiveInTheme("countdown", themeStatus);

  const savedTarget = countdownTarget(
    settings.mode,
    settings.endDate,
    settings.endTime,
    timeZone,
  );
  const ended = settings.mode === "fixed" && savedTarget !== null && savedTarget < new Date();

  return (
    <s-page heading="Countdown Bar">
      <ModuleIntro
        module="countdown"
        apiKey={apiKey}
        shop={shop}
        themeStatus={themeStatus}
        status={
          !settings.enabled
            ? { label: "Off", tone: "neutral" }
            : ended
              ? { label: "Countdown ended", tone: "warning" }
              : inTheme === false
                ? { label: "Not switched on in theme", tone: "warning" }
                : { label: "Live", tone: "success" }
        }
      >
        {settings.enabled && savedTarget && (
          <s-text color="subdued">
            {settings.mode === "daily"
              ? `Resets every day at ${settings.endTime} (Belgian time).`
              : ended
                ? `Ended on ${date(savedTarget, true)}. Pick a new end date or switch to “every day”.`
                : `Ends ${date(savedTarget, true)} (Belgian time).`}
          </s-text>
        )}
      </ModuleIntro>

      <s-section heading="Live preview">
        <BarPreview values={live} timeZone={timeZone} />
      </s-section>

      <s-section heading="Settings">
        <SettingsForm formRef={formRef}>
          {(errors) => (
            <>
              <s-switch
                label="Show the countdown bar on my store"
                name="enabled"
                defaultChecked={settings.enabled}
              />
              <s-text-field
                label="Message"
                name="message"
                defaultValue={settings.message}
                details="The timer appears right after this text."
                error={errors.message}
              />
              <s-select label="Count down to" name="mode" value={settings.mode}>
                <s-option value="fixed">A fixed date (end of a sale)</s-option>
                <s-option value="daily">
                  The same time every day (e.g. order before 15:00, ships today)
                </s-option>
              </s-select>
              <s-grid gridTemplateColumns="1fr 1fr" gap="base">
                <s-date-field
                  label="End date"
                  name="endDate"
                  defaultValue={settings.endDate}
                  disabled={live.mode === "daily"}
                  details={live.mode === "daily" ? "Not used for a daily countdown" : undefined}
                  error={errors.endDate}
                />
                <s-text-field
                  label="End time (Belgian time)"
                  name="endTime"
                  defaultValue={settings.endTime}
                  placeholder="23:59"
                  error={errors.endTime}
                />
              </s-grid>
              <s-text-field
                label="Message after it ends (optional)"
                name="endedMessage"
                defaultValue={settings.endedMessage}
                placeholder="Leave empty to hide the bar when the time is up"
              />
              <s-url-field
                label="Link when clicked (optional)"
                name="linkUrl"
                defaultValue={settings.linkUrl}
                placeholder="/collections/all"
              />
              <s-grid gridTemplateColumns="1fr 1fr 1fr" gap="base">
                <s-color-field
                  label="Background"
                  name="background"
                  defaultValue={settings.background}
                  error={errors.background}
                />
                <s-color-field
                  label="Text"
                  name="textColor"
                  defaultValue={settings.textColor}
                  error={errors.textColor}
                />
                <s-color-field
                  label="Timer"
                  name="accent"
                  defaultValue={settings.accent}
                  error={errors.accent}
                />
              </s-grid>
              <s-grid gridTemplateColumns="1fr 1fr" gap="base">
                <s-select label="Position" name="position" value={settings.position}>
                  <s-option value="top">Top of the page</s-option>
                  <s-option value="bottom">Bottom of the screen</s-option>
                </s-select>
                <s-switch
                  label="Shoppers can close it"
                  name="closable"
                  defaultChecked={settings.closable}
                />
              </s-grid>
            </>
          )}
        </SettingsForm>
      </s-section>
    </s-page>
  );
}

function BarPreview({
  values,
  timeZone,
}: {
  values: Record<string, string | boolean>;
  timeZone: string;
}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const target = countdownTarget(
    String(values.mode),
    String(values.endDate),
    String(values.endTime),
    timeZone,
    now,
  );
  const remaining = target ? target.getTime() - now.getTime() : 0;
  const done = !target || remaining <= 0;
  const text = done ? String(values.endedMessage || "") : String(values.message || "");

  return (
    <s-stack gap="small">
      <div
        style={{
          background: String(values.background),
          color: String(values.textColor),
          padding: "10px 16px",
          borderRadius: 8,
          textAlign: "center",
          fontSize: 14,
          fontWeight: 500,
          opacity: values.enabled ? 1 : 0.5,
          position: "relative",
        }}
      >
        {done && !text ? (
          <span style={{ opacity: 0.7 }}>Hidden: the countdown has ended</span>
        ) : (
          <>
            {text}{" "}
            {!done && (
              <strong
                style={{
                  color: String(values.accent),
                  fontVariantNumeric: "tabular-nums",
                  marginLeft: 4,
                }}
              >
                {formatRemaining(remaining)}
              </strong>
            )}
          </>
        )}
        {values.closable && (
          <span style={{ position: "absolute", right: 12, top: 8, opacity: 0.7 }}>×</span>
        )}
      </div>
      {!values.enabled && (
        <s-text color="subdued">The bar is off. Switch it on below and save.</s-text>
      )}
    </s-stack>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

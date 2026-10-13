// Thank-you page: a personal discount code for the buyer's next order.
// The code is created by the app (POST /api/checkout/reward) so it is unique,
// tied to this order, and shows the same value if the page is reloaded.
import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { APP_URL } from "./config.js";

export default function extension() {
  render(<Reward />, document.body);
}

function Reward() {
  /** @type {[{status: string, code?: string, heading?: string, body?: string}, Function]} */
  const [state, setState] = useState({ status: "loading" });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load(attempt) {
      const orderId = shopify.orderConfirmation.value?.order?.id;
      if (!orderId || !APP_URL) {
        setState({ status: "off" });
        return;
      }
      try {
        const token = await shopify.sessionToken.get();
        const response = await fetch(`${APP_URL}/api/checkout/reward`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ orderId }),
        });
        // 202: the order is still being created right after payment. Try again.
        if (response.status === 202 && attempt < 6) {
          setTimeout(() => !cancelled && load(attempt + 1), 2000);
          return;
        }
        const data = await response.json();
        if (cancelled) return;
        setState(data.enabled && data.code ? { status: "ready", ...data } : { status: "off" });
      } catch {
        if (!cancelled) setState({ status: "off" });
      }
    }
    load(0);
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "off") return null;
  if (state.status === "loading") {
    return (
      <s-section>
        <s-skeleton-paragraph />
      </s-section>
    );
  }

  return (
    <s-section heading={state.heading}>
      <s-stack gap="base">
        <s-paragraph>{state.body}</s-paragraph>
        <s-stack direction="inline" gap="base" alignItems="center">
          <s-box padding="small-100 base" border="base" borderStyle="dashed" borderRadius="base">
            <s-text type="strong">{state.code}</s-text>
          </s-box>
          <s-clipboard-item id="reward-code" text={state.code} onCopy={() => setCopied(true)} />
          <s-button commandFor="reward-code" command="--copy" variant="secondary">
            {copied ? "Copied" : "Copy code"}
          </s-button>
        </s-stack>
      </s-stack>
    </s-section>
  );
}

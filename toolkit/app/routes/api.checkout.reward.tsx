import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";
import { getSettings } from "../lib/admin.server";
import { fillTemplate, rewardCodeForOrder } from "../lib/checkout.server";

// Called by the thank-you page extension (extensions/thank-you-reward) with
// the checkout session token. Returns the buyer's personal code.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Answers the CORS preflight.
  const { cors } = await authenticate.public.checkout(request);
  return cors(new Response(null, { status: 204 }));
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { sessionToken, cors } = await authenticate.public.checkout(request);
  const shop = sessionToken.dest.replace(/^https?:\/\//, "");
  const settings = await getSettings(shop, "checkout");
  if (!settings.enabled) {
    return cors(Response.json({ enabled: false }));
  }

  const body = (await request.json().catch(() => ({}))) as { orderId?: string };
  // The extension sends gid://shopify/OrderIdentity/123; the Admin API wants Order/123.
  const numeric = body.orderId?.split("/").pop();
  if (!numeric || !/^\d+$/.test(numeric)) {
    return cors(Response.json({ error: "Missing order" }, { status: 400 }));
  }

  try {
    const { admin } = await unauthenticated.admin(shop);
    const code = await rewardCodeForOrder(admin, shop, `gid://shopify/Order/${numeric}`, settings);
    return cors(
      Response.json({
        enabled: true,
        code,
        heading: fillTemplate(settings.heading, settings),
        body: fillTemplate(settings.body, settings),
      }),
    );
  } catch (error) {
    // Right after payment the order can take a few seconds to exist; the
    // extension retries on 202.
    const message = error instanceof Error ? error.message : "";
    const status = message === "Order not found" ? 202 : 500;
    return cors(Response.json({ error: message || "Failed" }, { status }));
  }
};

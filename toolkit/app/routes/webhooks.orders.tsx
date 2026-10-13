import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getSettings } from "../lib/admin.server";
import { postToN8n } from "../lib/n8n.server";
import { refreshRecentSales } from "../lib/salesKit.server";

// orders/create, orders/paid and refunds/create.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload, admin } = await authenticate.webhook(request);
  const order = payload as {
    name?: string;
    order_id?: number;
    test?: boolean;
  };

  const bookkeeping = await getSettings(shop, "bookkeeping");
  const isTest = !!order.test;
  if (
    bookkeeping.autoForward &&
    bookkeeping.n8nWebhookUrl &&
    !(isTest && bookkeeping.excludeTestOrders)
  ) {
    const kind = topic.toLowerCase().replace("_", "."); // ORDERS_PAID → orders.paid
    const label =
      topic === "REFUNDS_CREATE"
        ? `Refund on order ${order.order_id ?? ""}`.trim()
        : `${order.name ?? "Order"} ${topic === "ORDERS_PAID" ? "paid" : "created"}`;
    await postToN8n(shop, bookkeeping, kind, label, payload);
  }

  if (topic === "ORDERS_CREATE" && admin && !isTest) {
    try {
      await refreshRecentSales(admin);
    } catch (error) {
      console.error("Couldn't refresh recent sales", error);
    }
  }

  return new Response();
};

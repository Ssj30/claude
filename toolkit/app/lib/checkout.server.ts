import { randomInt } from "node:crypto";
import db from "../db.server";
import { assertNoUserErrors, gql, type Admin } from "./admin.server";
import { DISCOUNT_CODE_BASIC_CREATE, ORDER_CUSTOMER_QUERY } from "./queries";
import type { SettingsMap } from "./settings";

// No 0/O or 1/I so codes are easy to type.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function newCode(): string {
  let out = "";
  for (let i = 0; i < 6; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return `THANKS-${out}`;
}

/** Same title format the old Checkout Kit used, so old and new codes list together. */
export function rewardTitle(percent: number, code: string) {
  return `Checkout Kit · ${percent}% · personal ${code}`;
}

export function fillTemplate(text: string, settings: SettingsMap["checkout"]) {
  return text
    .replaceAll("{percent}", String(settings.percent))
    .replaceAll("{days}", String(settings.expiryDays));
}

/**
 * Returns the personal code for an order, creating the Shopify discount the
 * first time. Reloading the thank-you page shows the same code.
 */
export async function rewardCodeForOrder(
  admin: Admin,
  shop: string,
  orderId: string,
  settings: SettingsMap["checkout"],
): Promise<string> {
  const existing = await db.rewardCode.findUnique({
    where: { shop_orderId: { shop, orderId } },
  });
  if (existing) return existing.code;

  const order = await gql(admin, ORDER_CUSTOMER_QUERY, { id: orderId });
  if (!order.order) throw new Error("Order not found");
  const customerId: string | undefined = order.order.customer?.id;

  const code = newCode();
  const endsAt = new Date(Date.now() + settings.expiryDays * 24 * 3600 * 1000);
  const result = await gql(admin, DISCOUNT_CODE_BASIC_CREATE, {
    discount: {
      title: rewardTitle(settings.percent, code),
      code,
      startsAt: new Date().toISOString(),
      endsAt: endsAt.toISOString(),
      usageLimit: 1,
      appliesOncePerCustomer: true,
      context:
        settings.onlyForBuyer && customerId
          ? { customers: { add: [customerId] } }
          : { all: "ALL" },
      customerGets: {
        value: { percentage: settings.percent / 100 },
        items: { all: true },
      },
      combinesWith: { orderDiscounts: false, productDiscounts: false, shippingDiscounts: true },
    },
  });
  assertNoUserErrors(result.discountCodeBasicCreate);

  try {
    await db.rewardCode.create({
      data: { shop, orderId, orderName: order.order.name ?? "", code },
    });
  } catch {
    // Two requests raced; keep the first code.
    const winner = await db.rewardCode.findUnique({
      where: { shop_orderId: { shop, orderId } },
    });
    if (winner) return winner.code;
  }
  return code;
}

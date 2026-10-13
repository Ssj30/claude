import { gql, setAppMetafield, type Admin } from "./admin.server";
import { RECENT_ORDERS_QUERY } from "./queries";

export interface RecentSale {
  name: string;
  city: string;
  country: string;
  product: string;
  handle: string;
  image: string;
  at: string;
}

export interface RecentOrderNode {
  id: string;
  createdAt: string;
  test: boolean;
  totalPriceSet: { shopMoney: { amount: string } };
  subtotalPriceSet: { shopMoney: { amount: string } };
  customer: { firstName: string | null } | null;
  shippingAddress: { city: string | null; countryCodeV2: string | null } | null;
  lineItems: {
    nodes: {
      title: string;
      product: {
        handle: string;
        featuredMedia: { preview: { image: { url: string } | null } | null } | null;
      } | null;
    }[];
  };
  discountApplications: { nodes: { title?: string; code?: string }[] };
}

export async function recentOrders(admin: Admin, query: string): Promise<RecentOrderNode[]> {
  const data = await gql(admin, RECENT_ORDERS_QUERY, { query });
  return data.orders.nodes;
}

/** Only a first name and a city, never a full name or address. */
export function toRecentSale(o: RecentOrderNode): RecentSale | null {
  // Skip add-ons like "Shipping Protection by Route".
  const item = o.lineItems.nodes.find(
    (li) => li.product && !/shipping-protection/i.test(li.product.handle),
  );
  if (!item?.product) return null;
  return {
    name: o.customer?.firstName?.split(" ")[0] || "Someone",
    city: o.shippingAddress?.city ?? "",
    country: o.shippingAddress?.countryCodeV2 ?? "",
    product: item.title,
    handle: item.product.handle,
    image: item.product.featuredMedia?.preview?.image?.url ?? "",
    at: o.createdAt,
  };
}

/** Rebuilds the feed the storefront pop-ups read from (last 20 real orders). */
export async function refreshRecentSales(admin: Admin): Promise<RecentSale[]> {
  const orders = await recentOrders(admin, "test:false");
  const sales = orders
    .map(toRecentSale)
    .filter((s): s is RecentSale => s !== null)
    .slice(0, 20);
  await setAppMetafield(admin, "recent_sales", sales);
  return sales;
}

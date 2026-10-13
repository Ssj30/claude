import { gql, type Admin } from "./admin.server";
import { buildMonthReport, ordersSearchQuery, type RawOrder } from "./bookkeeping";
import { ORDERS_FOR_PERIOD_QUERY } from "./queries";

/** All orders created in a month (up to 3000), as a report. */
export async function loadMonthReport(
  admin: Admin,
  month: string,
  excludeTest: boolean,
) {
  const query = ordersSearchQuery(month, excludeTest);
  const orders: RawOrder[] = [];
  let after: string | null = null;
  for (let page = 0; page < 30; page++) {
    const data: {
      orders: {
        nodes: RawOrder[];
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    } = await gql(admin, ORDERS_FOR_PERIOD_QUERY, { query, after });
    orders.push(...data.orders.nodes);
    if (!data.orders.pageInfo.hasNextPage) break;
    after = data.orders.pageInfo.endCursor;
  }
  return buildMonthReport(month, orders);
}

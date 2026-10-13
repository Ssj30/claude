// Bundle tiers are ordinary Shopify automatic discounts with a minimum
// quantity ("Buy 2+, get 10% off"), so they keep working at checkout even
// without this app. These helpers read them back from the Admin API.

export interface Tier {
  id: string;
  title: string;
  status: string;
  minQty: number;
  percent: number;
  usage: number;
  /** Empty = all products. */
  collections: { id: string; title: string; handle: string }[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function tiersFromDiscountNodes(nodes: any[]): Tier[] {
  const tiers: Tier[] = [];
  for (const node of nodes) {
    const d = node.discount;
    if (d?.__typename !== "DiscountAutomaticBasic") continue;
    if (d.minimumRequirement?.__typename !== "DiscountMinimumQuantity") continue;
    if (d.customerGets?.value?.__typename !== "DiscountPercentage") continue;
    const items = d.customerGets.items;
    // Tiers on specific products aren't managed here; show only "all" or collections.
    if (items?.__typename !== "AllDiscountItems" && items?.__typename !== "DiscountCollections") {
      continue;
    }
    tiers.push({
      id: node.id,
      title: d.title,
      status: d.status,
      minQty: Number(d.minimumRequirement.greaterThanOrEqualToQuantity),
      percent: Math.round(d.customerGets.value.percentage * 1000) / 10,
      usage: d.asyncUsageCount ?? 0,
      collections: items.collections?.nodes ?? [],
    });
  }
  return tiers.sort((a, b) => a.minQty - b.minQty);
}

/** What the storefront offer table needs: active tiers only. */
export function storefrontTiers(tiers: Tier[]) {
  return tiers
    .filter((t) => t.status === "ACTIVE")
    .map((t) => ({
      minQty: t.minQty,
      percent: t.percent,
      collections: t.collections.map((c) => c.handle),
    }));
}

export function tierTitle(minQty: number, percent: number): string {
  return `Buy ${minQty}+ save ${percent}%`;
}

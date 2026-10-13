import { describe, expect, it } from "vitest";
import { storefrontTiers, tiersFromDiscountNodes } from "../bundles";

// Shape of the store's real "Ordered together" discounts.
const nodes = [
  {
    id: "gid://shopify/DiscountAutomaticNode/1",
    discount: {
      __typename: "DiscountAutomaticBasic",
      title: "Ordered together 15% · 3+",
      status: "ACTIVE",
      asyncUsageCount: 2,
      minimumRequirement: { __typename: "DiscountMinimumQuantity", greaterThanOrEqualToQuantity: "3" },
      customerGets: {
        value: { __typename: "DiscountPercentage", percentage: 0.15 },
        items: { __typename: "DiscountCollections", collections: { nodes: [{ id: "c", title: "Advent", handle: "frontpage" }] } },
      },
    },
  },
  {
    id: "gid://shopify/DiscountAutomaticNode/2",
    discount: {
      __typename: "DiscountAutomaticBasic",
      title: "Limited-Time 33% OFF",
      status: "EXPIRED",
      minimumRequirement: null,
      customerGets: { value: { __typename: "DiscountPercentage", percentage: 0.33 }, items: { __typename: "AllDiscountItems" } },
    },
  },
  {
    id: "gid://shopify/DiscountAutomaticNode/3",
    discount: {
      __typename: "DiscountAutomaticBasic",
      title: "Ordered together 10% · 2+",
      status: "SCHEDULED",
      asyncUsageCount: 0,
      minimumRequirement: { __typename: "DiscountMinimumQuantity", greaterThanOrEqualToQuantity: "2" },
      customerGets: { value: { __typename: "DiscountPercentage", percentage: 0.1 }, items: { __typename: "AllDiscountItems" } },
    },
  },
];

describe("tiersFromDiscountNodes", () => {
  it("keeps quantity-based percentage discounts, sorted by quantity", () => {
    const tiers = tiersFromDiscountNodes(nodes);
    expect(tiers.map((t) => [t.minQty, t.percent])).toEqual([
      [2, 10],
      [3, 15],
    ]);
    expect(tiers[1].collections[0].handle).toBe("frontpage");
  });

  it("only sends active tiers to the storefront", () => {
    expect(storefrontTiers(tiersFromDiscountNodes(nodes))).toEqual([
      { minQty: 3, percent: 15, collections: ["frontpage"] },
    ]);
  });
});

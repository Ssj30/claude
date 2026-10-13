// Every Admin GraphQL operation the app sends lives here, so they can be
// validated against the schema in one place.

export const APP_INSTALLATION_QUERY = `#graphql
  query ToolkitAppInstallation {
    currentAppInstallation {
      id
      metafields(first: 20, namespace: "toolkit") {
        nodes {
          key
          jsonValue
        }
      }
    }
    shop {
      name
      myshopifyDomain
      currencyCode
      ianaTimezone
      taxesIncluded
    }
  }
`;

export const METAFIELDS_SET_MUTATION = `#graphql
  mutation ToolkitMetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        key
        namespace
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const MAIN_THEME_FILES_QUERY = `#graphql
  query ToolkitMainThemeFiles {
    themes(roles: [MAIN], first: 1) {
      nodes {
        id
        name
        files(filenames: ["config/settings_data.json", "templates/product.json", "templates/index.json"], first: 3) {
          nodes {
            filename
            body {
              ... on OnlineStoreThemeFileBodyText {
                content
              }
            }
          }
        }
      }
    }
  }
`;

// Bookkeeping ---------------------------------------------------------------

export const ORDERS_FOR_PERIOD_QUERY = `#graphql
  query ToolkitOrdersForPeriod($query: String!, $after: String) {
    orders(first: 100, after: $after, query: $query, sortKey: CREATED_AT) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        name
        createdAt
        cancelledAt
        test
        displayFinancialStatus
        currencyCode
        customer {
          displayName
        }
        billingAddress {
          countryCodeV2
          company
        }
        subtotalPriceSet {
          shopMoney {
            amount
          }
        }
        totalDiscountsSet {
          shopMoney {
            amount
          }
        }
        totalShippingPriceSet {
          shopMoney {
            amount
          }
        }
        totalTaxSet {
          shopMoney {
            amount
          }
        }
        totalPriceSet {
          shopMoney {
            amount
          }
        }
        totalRefundedSet {
          shopMoney {
            amount
          }
        }
        taxLines {
          title
          rate
          priceSet {
            shopMoney {
              amount
            }
          }
        }
      }
    }
  }
`;

// Stock counter -------------------------------------------------------------

export const LOW_STOCK_QUERY = `#graphql
  query ToolkitLowStock($query: String!) {
    productVariants(first: 100, query: $query, sortKey: INVENTORY_QUANTITY) {
      nodes {
        id
        title
        sku
        inventoryQuantity
        inventoryItem {
          tracked
        }
        product {
          id
          title
          status
          featuredMedia {
            preview {
              image {
                url(transform: { maxWidth: 80, maxHeight: 80 })
              }
            }
          }
        }
      }
    }
  }
`;

export const STOCK_COUNTS_QUERY = `#graphql
  query ToolkitStockCounts($low: String!) {
    active: productsCount(query: "status:active") {
      count
    }
    outOfStock: productVariantsCount(query: "inventory_quantity:<=0 AND product_status:active") {
      count
    }
    low: productVariantsCount(query: $low) {
      count
    }
  }
`;

// Reviews -------------------------------------------------------------------

export const PRODUCTS_BY_ID_QUERY = `#graphql
  query ToolkitProductsById($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        title
        handle
      }
    }
  }
`;

export const PRODUCT_SEARCH_QUERY = `#graphql
  query ToolkitProductSearch($query: String!) {
    products(first: 100, query: $query, sortKey: TITLE) {
      nodes {
        id
        title
        handle
      }
    }
  }
`;

export const LOOX_FEED_QUERY = `#graphql
  query ToolkitLooxFeed {
    shop {
      metafield(namespace: "loox", key: "review_feed_agg") {
        jsonValue
      }
    }
  }
`;

// Sales kit -----------------------------------------------------------------

export const RECENT_ORDERS_QUERY = `#graphql
  query ToolkitRecentOrders($query: String!) {
    orders(first: 50, query: $query, sortKey: CREATED_AT, reverse: true) {
      nodes {
        id
        createdAt
        test
        totalPriceSet {
          shopMoney {
            amount
          }
        }
        subtotalPriceSet {
          shopMoney {
            amount
          }
        }
        customer {
          firstName
        }
        shippingAddress {
          city
          countryCodeV2
        }
        lineItems(first: 3) {
          nodes {
            title
            product {
              handle
              featuredMedia {
                preview {
                  image {
                    url(transform: { maxWidth: 120, maxHeight: 120 })
                  }
                }
              }
            }
          }
        }
        discountApplications(first: 5) {
          nodes {
            ... on AutomaticDiscountApplication {
              title
            }
            ... on DiscountCodeApplication {
              code
            }
          }
        }
      }
    }
  }
`;

// Bundle deals --------------------------------------------------------------

export const AUTOMATIC_DISCOUNTS_QUERY = `#graphql
  query ToolkitAutomaticDiscounts {
    discountNodes(first: 100, query: "method:automatic") {
      nodes {
        id
        discount {
          __typename
          ... on DiscountAutomaticBasic {
            title
            status
            startsAt
            endsAt
            asyncUsageCount
            minimumRequirement {
              __typename
              ... on DiscountMinimumQuantity {
                greaterThanOrEqualToQuantity
              }
            }
            customerGets {
              value {
                __typename
                ... on DiscountPercentage {
                  percentage
                }
              }
              items {
                __typename
                ... on DiscountCollections {
                  collections(first: 5) {
                    nodes {
                      id
                      title
                      handle
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

export const DISCOUNT_AUTOMATIC_BASIC_CREATE = `#graphql
  mutation ToolkitBundleTierCreate($discount: DiscountAutomaticBasicInput!) {
    discountAutomaticBasicCreate(automaticBasicDiscount: $discount) {
      automaticDiscountNode {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const DISCOUNT_AUTOMATIC_DELETE = `#graphql
  mutation ToolkitBundleTierDelete($id: ID!) {
    discountAutomaticDelete(id: $id) {
      deletedAutomaticDiscountId
      userErrors {
        field
        message
      }
    }
  }
`;

export const DISCOUNT_AUTOMATIC_ACTIVATE = `#graphql
  mutation ToolkitBundleTierActivate($id: ID!) {
    discountAutomaticActivate(id: $id) {
      userErrors {
        field
        message
      }
    }
  }
`;

export const DISCOUNT_AUTOMATIC_DEACTIVATE = `#graphql
  mutation ToolkitBundleTierDeactivate($id: ID!) {
    discountAutomaticDeactivate(id: $id) {
      userErrors {
        field
        message
      }
    }
  }
`;

export const COLLECTIONS_QUERY = `#graphql
  query ToolkitCollections {
    collections(first: 50, sortKey: TITLE) {
      nodes {
        id
        title
        handle
      }
    }
  }
`;

// Checkout kit --------------------------------------------------------------

export const REWARD_CODES_QUERY = `#graphql
  query ToolkitRewardCodes {
    discountNodes(first: 100, query: "title:Checkout*", sortKey: CREATED_AT, reverse: true) {
      nodes {
        id
        discount {
          __typename
          ... on DiscountCodeBasic {
            title
            status
            createdAt
            endsAt
            asyncUsageCount
            codes(first: 1) {
              nodes {
                code
              }
            }
          }
        }
      }
    }
  }
`;

export const ORDER_CUSTOMER_QUERY = `#graphql
  query ToolkitOrderCustomer($id: ID!) {
    order(id: $id) {
      id
      name
      customer {
        id
      }
    }
  }
`;

export const DISCOUNT_CODE_BASIC_CREATE = `#graphql
  mutation ToolkitRewardCodeCreate($discount: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $discount) {
      codeDiscountNode {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

import '@shopify/ui-extensions';

declare module './src/ThankYou.jsx' {
  const shopify: import('@shopify/ui-extensions/purchase.thank-you.block.render').Api;
  const globalThis: { shopify: typeof shopify };
}

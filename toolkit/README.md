# 911 Toolkit

One Shopify app that replaces the seven separate 911nights apps, with a clear
dashboard for each tool inside the Shopify admin (Apps → 911 Toolkit).

| Page in the app | Replaces | What it does |
|---|---|---|
| Overview | — | Status and the key number for every tool, plus what needs attention |
| Bookkeeping | n8n Boekhouding | Monthly revenue, VAT, refunds, revenue per day, VAT breakdown, orders table, CSV export for the accountant, automatic sync of new orders/payments/refunds to n8n, sync log |
| Stock Counter | Stock Counter | Inventory health, “running low” list, the “Only 3 left of this model” product-page block with live preview |
| Countdown Bar | Countdown Bar | Fixed-date or daily countdown bar with live preview |
| Reviews | Stellar Reviews | Approve/hide/delete reviews, rating overview, add reviews, import from Loox or a spreadsheet, review section + star rating + homepage carousel blocks |
| Sales Kit | Sales Kit | Recent-sale pop-ups from real orders, free-shipping progress bar, trust badges, 30-day stats |
| Bundle Deals | Bundle Deals | “Buy 2, save 10%” offers (real Shopify automatic discounts), usage stats, offer table on product pages |
| Checkout Kit | Checkout Kit | Personal next-order code on the thank-you page, codes given out and used |

Every page has the same layout: what the tool does, an on/off status, whether
its storefront part is in your live theme (with a one-click “Add to theme”
button), the numbers that matter, and settings with the standard Shopify save
bar.

## How it fits together

- **Admin pages**: `app/routes/app.*.tsx` (React Router + Polaris web components).
- **Settings**: stored in the app database and copied to app metafields
  (`toolkit.*`), which the theme blocks read. Nothing on the storefront calls
  the app, so pages stay fast.
- **Reviews**: stored in the app database; published reviews are written to the
  product (`toolkit_reviews.summary` / `toolkit_reviews.list`). The review form
  posts to `/apps/toolkit/reviews` (app proxy).
- **Bundle offers**: ordinary Shopify automatic discounts, so they keep working
  at checkout even if the app is down.
- **Theme blocks**: `extensions/toolkit-theme` (countdown bar, pop-ups & free
  shipping, stock counter, reviews, star rating, reviews carousel, trust
  badges, bundle offers).
- **Thank-you page**: `extensions/thank-you-reward` calls
  `/api/checkout/reward`, which creates one code per order.

## Going live

You need Node.js 22+, the [Shopify CLI](https://shopify.dev/docs/apps/tools/cli)
and access to the Shopify Partner/Dev Dashboard that owns the old apps.

1. **Install and link**
   ```sh
   cd toolkit
   npm install
   cp .env.example .env
   npx shopify app config link     # choose "create a new app", name it 911 Toolkit
   ```
2. **Host the app** on a service with a persistent disk (Fly.io, Railway or
   Render all work with the included `Dockerfile`). Mount a volume at `/data`
   and set:
   - `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`: from the Dev Dashboard
   - `SHOPIFY_APP_URL`: the public `https://` URL of the host
   - `SCOPES`: same as `access_scopes` in `shopify.app.toml`
3. **Point Shopify at it**: set `application_url` and `redirect_urls` in
   `shopify.app.toml` to that URL, then run
   ```sh
   npm run deploy     # also writes the app URL into the thank-you extension
   ```
4. **In the Dev Dashboard** (app → API access / Configuration):
   - *Protected customer data*: request access to name and address fields.
     Bookkeeping shows customer names and countries; pop-ups show first name and city.
   - *Allow network access in checkout UI extensions*: turn on (thank-you code).
   - Optional: request *read_all_orders* to see bookkeeping months older than 60 days.
5. **Install** the app on 911nights (custom distribution link) and open it once.
   The first open writes the default storefront settings.

## Switching over from the old apps

Do this in order, so nothing disappears from the shop in between:

1. Open each page in 911 Toolkit and check the settings (defaults already match
   what the old apps showed, e.g. “Only {count} left of this model” and
   “Ordering more than one?”).
2. **Reviews → Import reviews → Import from Loox.** For Stellar Reviews, export
   the reviews from the old app (CSV) and paste them into “Paste from a spreadsheet”.
3. On each page, use the **“Add to product page” / “Turn on in theme”** buttons.
   In the theme editor, remove the old app blocks next to the new ones.
4. **Checkout Kit**: Settings → Checkout → Customize → Thank you page → add
   “Thank-you reward”.
5. **Bookkeeping**: paste the n8n webhook URL and click “Send test message”.
6. Uninstall the seven old apps. Existing bundle discounts (“Ordered together…”)
   and old THANKS- codes stay, and show up in the new pages.

## Development

```sh
shopify app dev        # local dev tunnel against a dev store
npm test               # unit tests + render tests for every admin page
npm run typecheck
npm run lint
```

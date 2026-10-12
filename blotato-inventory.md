# Blotato inventory (Phase 1) — pulled 2026-10-12 via Blotato API

## Account
- [x] Plan: Starter, subscription active
- [x] Scheduled posts in queue: none
- [x] Facebook Pages connected: none (Instagram only)

## Connected social accounts
- [x] Instagram @911.nights (Blotato id 71369) — brand: 911 Nights (911nights.com)
- [x] Instagram @grillbuddy.shop (Blotato id 70854) — brand: GrillBuddy — NO automation

## Automation 6998 — "Comment "link" → auto-DM (911 Turbo)"
- [x] Account: @911.nights
- [x] Status: active (published version 10577); created 2026-09-15
- [x] Applies to: all posts (postId = null)
- [x] Trigger: comment received
- [x] Keywords: link, porsche, buy, price, cost
- [x] Keyword matching: any upper/lower case, keyword anywhere in the comment, even inside a longer word. Confirmed from the run logs: "LINK" and "Link" triggered, "Linkkk" triggered (2026-09-28), "…make it worth the price" triggered. The dashboard calls it "And the comment has"
- [x] Public comment reply: none. Successful runs (e.g. 311410) only contain the DM step, and the dashboard shows only "When someone…" and "Send this DM"
- [x] DM text: "Here it is 👇 the Porsche 911 Turbo advent calendar — build it in 24 days, 1:43 scale, real engine sound module. Tap below to shop it 🏁"
- [x] DM button: "Shop Now" (URL) → https://www.911nights.com/products/porsche-911-turbo
- [x] Delay before replying: none. The DM goes out about 0.5 s after the comment (run 311410: comment 19:29:35.36, DM 19:29:35.86 UTC)
- [x] Follow-up messages: none. Each run sends one DM and ends ("Execution complete")
- [x] Duplicate handling (same person comments twice): none, and the dashboard has no setting for it. Every matching comment starts a run (a contact triggered twice 2 min apart on 2026-10-03 and got two DMs)
- [x] Non-keyword comments: ignored. All 83 runs logged between 25 Sept and 12 Oct came from comments containing a keyword
- Note: "price" and "cost" also match complaints ("Why this price", "…make it worth the price"), which got the sales DM

## Health
- Lifetime: 194 triggered, 125 completed, 69 failed
- Last success: 2026-09-26 19:29 UTC
- Every run since 2026-09-27 02:25 UTC failed: error 5002 "Your Instagram connection is no longer valid. Reconnect the account."
- About 69 people commented a keyword and got no DM (still happening, last one 2026-10-12 00:24 UTC)

## Phase 2 status (2026-10-12)
- Replacement built on the Windows PC as the ig-autodm desktop app (Desktop\ig-autodm): a tray app with a local dashboard. It checks for new comments every 30 s (webhooks optional) and uses the same rule as automation 6998.
- Improvements over Blotato: one DM per person per post, the Instagram token renews itself, failed DMs are retried within Instagram's 7-day window, alerts when Instagram disconnects, and a scan for missed comments.
- Waiting on: an Instagram access token from a Meta app (Instagram API with Instagram login), possibly Meta App Review for messaging, then Go live in the app and switch automation 6998 off.

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
- [ ] Keyword matching (exact / contains / case): NOT visible in API — confirm in dashboard
- [ ] Public comment reply text: NOT in API output — confirm whether one is set
- [x] DM text: "Here it is 👇 the Porsche 911 Turbo advent calendar — build it in 24 days, 1:43 scale, real engine sound module. Tap below to shop it 🏁"
- [x] DM button: "Shop Now" (URL) → https://www.911nights.com/products/porsche-911-turbo
- [ ] Delay before replying: NOT visible — confirm
- [ ] Follow-up messages: none visible — confirm
- [ ] Duplicate handling (same person comments twice): NOT visible. Run log shows a contact triggering twice 2 min apart (2026-10-03) → Blotato fired twice
- [ ] Non-keyword comments: ignored (assumed) — confirm

## Health
- Lifetime: 194 triggered, 125 completed, 69 failed
- Last success: 2026-09-26 19:29 UTC
- Every run since 2026-09-27 02:25 UTC failed: error 5002 "Your Instagram connection is no longer valid. Reconnect the account."
- About 69 people commented a keyword and got no DM (still happening, last one 2026-10-12 00:24 UTC)

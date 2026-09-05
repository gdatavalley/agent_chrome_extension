# Store Submission Checklist (Milestone 9)

## Done in code

- [x] MV3 only; no remotely hosted code (all JS bundled; remote config is data)
- [x] Fonts bundled as WOFF2 (no CDN requests)
- [x] Empty `host_permissions`; per-site runtime grants via `optional_host_permissions`
- [x] No static content scripts — injection on demand only
- [x] CSP locked (`script-src 'self' 'wasm-unsafe-eval'; object-src 'self'`)
- [x] No `eval` / `new Function` / remote script loading
- [x] Permission justifications drafted (`docs/store/permission-justifications.md`)
- [x] Privacy policy drafted (`docs/store/privacy-policy.md`) — **must be hosted publicly before submission**
- [x] Data disclosure worksheet (`docs/store/data-disclosure.md`)

## Blocked on product decisions (§14)

- [ ] **Vertical** (Q1) — drives the single-purpose statement, description's
      first sentence, and the debugger justification's core noun
- [ ] **Product name + icon** (Q2) — title ≤45 chars, no superlatives, no
      Google/Chrome trademarks; icon must read at 16px monochrome
- [ ] **Category** — follows from the vertical

## Blocked on accounts/payments (deferred — with the user)

- [ ] Privacy policy hosted at a public URL
- [ ] Cloudflare Worker deployed (production `backend/`)
- [ ] Supabase project + schema applied (`backend/schema.sql`)
- [ ] Paddle/LemonSqueezy merchant account + webhook wiring
- [ ] DPA link for business buyers (§11)

## Before submission

- [ ] `wxt zip` builds and the zip passes a fresh-profile install smoke test
- [ ] Source maps included in the submission zip (CWS allows minified bundles
      but expects source maps for readability)
- [ ] Manifest `name`/`description` final (description ≤132 chars, first
      sentence states the single purpose)
- [ ] Screenshots (1280×800): tasks grid, running ledger, confirm gate,
      Your data screen — from the real build, not mockups
- [ ] Promotional tile (440×280) — optional but recommended
- [ ] Version `0.1.0` (monotonically increasing from here)
- [ ] `"key"` field REMOVED from any dev manifest (store assigns the ID; the
      backend allowlist migrates to it)
- [ ] Budget weeks for review (`debugger` + host patterns = manual review lane)

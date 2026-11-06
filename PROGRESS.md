# Progress

Status as of 6 November 2026, commit `b7fb951` (main) plus the E2E harness
timing fix in `scripts/run-e2e.mjs`.
Verification commands: `npm run compile` · `npm test` (31 unit tests, extension
and backend together) · `node scripts/run-e2e.mjs all` (8 scenarios) ·
`cd backend && npx vitest run` (the backend's 15 on their own).

✅ = everything in the milestone's §13 scope is built. 🟡 = the core is built
and verified; the items marked **Open** are §13 scope still missing.

## By milestone (spec §13)

| Milestone | Status | Evidence |
|---|---|---|
| **0 — Benchmark harness** | 🟡 Spike done | 3-step pipeline verified on real Chrome (SPIKE.md). **Open:** the 20-task suite on vertical sites (awaits §14 Q1); the model-side checks SPIKE.md still lists as unvalidated — `cached_tokens` shape, caching behaviour (§7.5), reasoning-effort pinning (§14 Q3/Q6). `creditsFor()` treats a missing `cached_tokens` as 0, so the failure mode is overcharging, not undercharging. |
| **1 — Skeleton** | ✅ Done | Spec-compliant manifest (empty `host_permissions`, optional per-site grants, side panel, options-in-tab, offscreen, alarms, kill-switch command, CSP), Dexie schema, checkpoint-every-step from day one, tokens.css + bundled IBM Plex. |
| **2 — Perceive & act** | 🟡 Done + E2E | AX-tree trim/index with depth walk, password-field exclusion, `getBoxModel` → trusted CDP input, mutation-probe verification with 800ms wait-retry, submit-control detection. All CDP proxied through the SW. Wait-retry also covers initial perception (`perceiveSettled()`, `106fd7c`), so a run can no longer finish on a page that hasn't loaded. **Open:** no deterministic dismiss-overlay routine — overlays close only when the model picks the dismiss control. |
| **3 — Tier 2 + Tier 5** | 🟡 Done + E2E | Agent loop in the offscreen document, zod-validated action protocol, cache-ordered prompts, side-panel ledger with all run states (gate, stuck, detached, credits, auth, complete, blocked), kill switch, badge sync. The panel opens from the Tasks click (it needs a user gesture; it silently never opened before `106fd7c`). **Open:** Show me resumes the run; the pick-an-element overlay (UI §9.4) is not built. |
| **4 — Tasks tab & guardrails** | 🟡 Done + E2E | Task library/compose/edit/schedule, multi-origin tasks ("Start on" + "Also allowed"), runtime permission grants + Blocked flow, read-only action-layer blocking, code-enforced confirm gates, redaction (card/IBAN/long-number, Luhn-checked), audit log, all 8 Options sections incl. Your data and per-run full ledger. **Open:** per-site network hardening (§5.1 secondary layer, `Fetch` non-GET abort). Only the `strictReadOnly` field in `src/shared/types.ts` exists — nothing enforces it and Settings → Sites doesn't surface it. |
| **5 — BYOK** | 🟡 Done + E2E | AES-GCM key storage (non-extractable CryptoKey in IndexedDB), one-token verification round trip against the configured model, direct-to-OpenAI calls, BYOK token/$ meter, Gemini free-tier warning with EEA/CH/UK fail-safe detection. Options → Keys adds/tests/deletes keys; model id and reasoning effort are editable. Before `106fd7c` a verified key was stored but never used — every run outside the harness fell back to the mock provider. Live run last passed 8 Sep (`106fd7c`). **Open:** Ollama provider + capability check (§10.6); Gemini verification path (keys:add is OpenAI-only). |
| **6 — Backend & credits** | 🟡 Done + E2E (local) | `backend/`: hono Worker — device-code auth, HS256 JWT + rotating refresh, OpenAI proxy with atomic conditional debit, windowed quotas, metadata-only ledger, remote model/price config, Supabase schema. Full hosted flow passes locally: sign-in → proxy → exact debit match → out-of-credits → top-up → resume. Account and Spending read the real plan. **Open:** deploy, Supabase adapter, payments — see "Needs accounts". |
| **7 — Scheduling & concurrency** | ✅ Done | `chrome.alarms` schedules, missed-run detection with reason, forced read-only for scheduled runs, 3-run cap + refusal on any origin overlap, 3-minute gate detach timer. |
| **8 — Tier 3, then Tier 1** | ✅ Done + E2E | Screenshot escalation after first miss; fingerprint replay cache with per-step live-menu verification — second run of a task completes with **0 model calls**. |
| **9 — Store submission** | 🟡 Prep done; blocked on accounts/decisions | `docs/store/` (permission justifications, privacy policy draft, data-disclosure worksheet, submission checklist). Production zip builds clean, no key inlined, no remote code, fonts bundled. |

## Since the last update (`3176530` → `b7fb951`)

- **`106fd7c` — the extension can now be driven with a real model.** BYOK key
  adopted on first verify (was silently mock); perception wait-retry at run
  start (a run could report "8 invoices downloaded" on a page it never saw);
  side panel opens; Options → Keys; billing-aware Account and Spending; per-run
  full ledger; task edit; multi-origin compose; max steps 25 → 50, editable.
  Harness: `gate` flake fixed, CDP wait 30s → 150s, children reaped on failure.
- **`b7fb951` — navigation and meter fixes.** ⚙ in the Tasks header and
  "← Tasks" in Options, so Settings is reachable with no active run; the action
  icon focuses an open Tasks tab instead of stacking new ones; the Tasks header
  shows the meter for the actual billing mode; the panel no longer resurrects a
  finished run as current. Verified by compile + unit tests only.
- **Harness timing fix (6 Nov, `scripts/run-e2e.mjs`).** Commands went out a
  fixed 4s after CDP came up, but the extension installs after CDP is
  reachable — `readonly` aborted with "no extension target". The hosted
  backend's health wait was ~10s against an 18s cold `npx tsx` start, so
  `hosted` failed on every cold run. Both now poll for readiness (60s / 90s),
  and the backend wait fails fast if the process exits.

## E2E suite (real Chrome, `node scripts/run-e2e.mjs all`)

Re-run 6 November 2026, each scenario from a cold start:

```
default   PASS  complete, 3 steps, 8 credits (mock)
escalate  PASS  complete with tier-3 screenshot steps
stuck     PASS  tier-5 handoff
gate      PASS  confirm gate → approve → complete
readonly  PASS  typing blocked in read-only → stuck
hosted    PASS  full M6 flow against the local Worker (server debit = 3 metered)
replay    —     not re-run: needs `default` first in the same session (last PASS 8 Sep, 106fd7c)
real      —     not re-run: spends on the live OpenAI key (last PASS 8 Sep, 106fd7c)
```

The suite drives the extension through `__devCommand`, not the UI, and `real`
forces `mode: 'byok'` in its command. Both bugs `106fd7c` fixed (unused key,
panel never opening) sat in UI paths the suite doesn't touch — a green suite
says nothing about UI wiring.

## Unit tests — 31 passing

`npm test` runs both sets. Extension (16): `creditsFor`, fingerprint
normalization/shape, redaction. Backend (15): token issue/verify/rotate +
replay rejection, atomic debit incl. 3-way concurrency, full app flow with a
stub upstream (device-code → token → entitled proxy → debit → 402).
Neither `106fd7c` nor `b7fb951` added tests.

## Still missing

**Needs accounts (joint session):**
- Cloudflare Workers deploy of `backend/` (+ `wrangler secret put`)
- Supabase project; apply `backend/schema.sql`; swap MemoryStore → Supabase
  adapter in `backend/src/index.ts` (TODO marker there)
- Paddle or LemonSqueezy merchant account; webhook handler → `top_up()`
- Privacy policy hosted at a public URL
- DPA link for business buyers (§11)

**Needs product decisions (§14):**
- Vertical (Q1) — gates single-purpose statement, `debugger` justification,
  M0 benchmark suite
- Product name + icon (Q2) — gates listing, action icon
- Panel attach per-tab or per-window (Q4)
- Billing policy (Q7) — credit expiry, refunds, stacking, downgrade, dunning
- Strict read-only rollout (Q9) — who decides a site is safe for it; gates
  the §5.1 network layer below

**Customer side (backend) — not built; see PROJECT.md:**
- Supabase `Store` adapter. `backend/src/index.ts` builds a `MemoryStore`
  per request, so the Worker entry is not deployable as-is
- Sign-in web app: nothing serves `verify_url` (`/verify`); magic-link
  confirmation not built
- Trial abuse floor (§8.1b): email verification before credits, per-IP
  signup limit
- Sentry + PostHog (§8.2); the Options telemetry toggle is stored but unread

**Known gaps against the spec (decide: fix, or record as a departure):**
- `mock` is the default `llm.mode` in production builds too — an install
  with no key and no sign-in runs the mock provider
- Entitlement tokens stored unencrypted in Dexie settings (§8.1b: access
  token memory-only, refresh token encrypted)
- `scripting` permission requested but unused; its store justification
  describes content-script verification that doesn't exist

**Not yet built / open engineering items:**
- Prompt-injection adversarial review (§14 Q8 — due before M4's gates ship
  to users; the structural defenses are in place, the review isn't done)
- Model-side M0 checks: `cached_tokens` shape, caching, effort pinning
  (§14 Q3/Q6; SPIKE.md)
- Per-site network hardening / "strict read-only" (§5.1 secondary layer)
- Deterministic dismiss-overlay routine (§13 M2)
- Ollama provider + capability check (§10.6) — UI scaffold exists, provider
  not wired
- Show-me element picker (UI §9.4) — currently resumes the run; the
  pick-an-element overlay is not implemented
- Cross-origin iframe targets / flattened mode (§6.4)
- Source maps in the submission zip (checklist item)
- `chrome.i18n` string externalization (UI §13 — strings are inline today)
- Gemini provider verification path (keys:add supports OpenAI only)

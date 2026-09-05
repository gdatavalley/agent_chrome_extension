# Progress

Status as of 5 September 2026, commit `3176530` (main).
Verification commands: `npm run compile` · `npm test` (31 unit tests) ·
`node scripts/run-e2e.mjs all` (8 scenarios) · `cd backend && npx vitest run`.

## By milestone (spec §13)

| Milestone | Status | Evidence |
|---|---|---|
| **0 — Benchmark harness** | ✅ Spike done; full benchmark deferred | 3-step pipeline verified on real Chrome (SPIKE.md). The 20-task suite on vertical sites awaits the vertical decision (§14 Q1). |
| **1 — Skeleton** | ✅ Done | Spec-compliant manifest (empty `host_permissions`, optional per-site grants, side panel, options-in-tab, offscreen, alarms, kill-switch command, CSP), Dexie schema, checkpoint-every-step from day one, tokens.css + bundled IBM Plex. |
| **2 — Perceive & act** | ✅ Done + E2E | AX-tree trim/index with depth walk, password-field exclusion, `getBoxModel` → trusted CDP input, mutation-probe verification with 800ms wait-retry, submit-control detection. All CDP proxied through the SW. |
| **3 — Tier 2 + Tier 5** | ✅ Done + E2E | Agent loop in the offscreen document, zod-validated action protocol, cache-ordered prompts, side-panel ledger with all run states (gate, stuck, detached, credits, auth, complete, blocked), kill switch, badge sync. |
| **4 — Tasks tab & guardrails** | ✅ Done + E2E | Task library/compose/schedule, runtime permission grants + Blocked flow, read-only action-layer blocking, code-enforced confirm gates, redaction (card/IBAN/long-number, Luhn-checked), audit log, all 8 Options sections incl. Your data. |
| **5 — BYOK** | ✅ Done + E2E | AES-GCM key storage (non-extractable CryptoKey in IndexedDB), one-token verification round trip, direct-to-OpenAI calls, BYOK token/$ meter, Gemini free-tier warning with EEA/CH/UK fail-safe detection. Live run passes with a real key (3 credits, 3 steps). |
| **6 — Backend & credits** | ✅ Done + E2E (local) | `backend/`: hono Worker — device-code auth, HS256 JWT + rotating refresh, OpenAI proxy with atomic conditional debit, windowed quotas, metadata-only ledger, remote model/price config, Supabase schema. Full hosted flow passes locally: sign-in → proxy → exact debit match → out-of-credits → top-up → resume. |
| **7 — Scheduling & concurrency** | ✅ Done | `chrome.alarms` schedules, missed-run detection with reason, forced read-only for scheduled runs, 3-run cap + same-origin refusal, 3-minute gate detach timer. |
| **8 — Tier 3, then Tier 1** | ✅ Done + E2E | Screenshot escalation after first miss; fingerprint replay cache with per-step live-menu verification — second run of a task completes with **0 model calls**. |
| **9 — Store submission** | 🟡 Prep done; blocked on accounts/decisions | `docs/store/` (permission justifications, privacy policy draft, data-disclosure worksheet, submission checklist). Production zip builds clean, no key inlined, no remote code, fonts bundled. |

## E2E suite (real Chrome, `node scripts/run-e2e.mjs all`)

```
default   PASS  complete, 3 steps, 8 credits (mock)
replay    PASS  complete, 3 steps, 0 credits (tier-1 replay)
escalate  PASS  complete with tier-3 screenshot steps
stuck     PASS  tier-5 handoff
gate      PASS  confirm gate → approve → complete
readonly  PASS  typing blocked in read-only → stuck
real      PASS  complete, 3 credits (live OpenAI, BYOK)
hosted    PASS  full M6 flow against the local Worker
```

## Unit tests — 31 passing

Extension (16): `creditsFor`, fingerprint normalization/shape, redaction.
Backend (15): token issue/verify/rotate + replay rejection, atomic debit
incl. 3-way concurrency, full app flow with a stub upstream (device-code →
token → entitled proxy → debit → 402).

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
- Billing policy (Q7) — credit expiry, refunds, stacking, downgrade, dunning

**Not yet built / open engineering items:**
- Prompt-injection adversarial review (§14 Q8 — due before M4's gates ship
  to users; the structural defenses are in place, the review isn't done)
- Ollama provider + capability check (§10.6) — UI scaffold exists, provider
  not wired
- Show-me element picker (UI §9.4) — currently resumes the run; the
  pick-an-element overlay is not implemented
- Cross-origin iframe targets / flattened mode (§6.4)
- Source maps in the submission zip (checklist item)
- `chrome.i18n` string externalization (UI §13 — strings are inline today)
- Gemini provider verification path (keys:add supports OpenAI only)

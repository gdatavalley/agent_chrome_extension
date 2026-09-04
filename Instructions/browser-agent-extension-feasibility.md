# Browser Agent Extension — Feasibility & Scoping Review

**Version:** 1.0
**Date:** 3 September 2026
**Audience:** Product management, for scoping and prioritisation
**Scope of review:** `browser-agent-extension-spec.md` v0.2 (full), `browser-agent-extension-ui-spec.md` v0.2 (full), `ui/mockups.html` (all 20 sections + deleted screens), `ui/tokens.css` (full), plus the WXT/React boilerplate in this repo (verified: `npm run build` and `tsc --noEmit` both pass, 211 KB production output). A v0.3/v0.3.1 re-review follows in the addendum at the end of this document.

**Companion documents:** this review comments on the two specs; it does not replace them. Section references (`§`) point into `browser-agent-extension-spec.md` unless noted.

---

## 1. Verdict

**Feasible. The architecture is sound. Build it.**

Nothing in the request is impossible under Manifest V3 as it stands, the billing model is implementable with standard proven plumbing, and the hard-to-retrofit decisions (offscreen agent loop, checkpoint-every-step, element indexing, network-layer read-only, token metering) are all correct and correctly front-loaded.

The two genuinely hard risks are not technical:

1. **Chrome Web Store review of the `debugger` permission** — a policy/review risk, mitigated but not eliminable.
2. **The undecided vertical** (spec §14 Q1) — which gates the store strategy, the Milestone 0 benchmark suite, and the `debugger` justification.

The documentation is ~90% build-ready. The missing 10% is concentrated in **auth, backend contracts, and the vertical decision** — none of which invalidate anything already specified.

---

## 2. What is validated as sound

These items were checked against Chrome platform behaviour and standard extension-payment architecture. Treat them as settled; reopening them costs time without buying safety.

| # | Decision | Why it is correct |
|---|---|---|
| 2.1 | Agent loop in an **offscreen document**, service worker as stateless router | The correct answer to MV3 worker lifecycle. One offscreen document orchestrating up to 3 loops is compatible with platform limits. |
| 2.2 | **Checkpoint every step to IndexedDB** | Converts worker/offscreen death from data loss into resume. Also enables the out-of-credits resume and paused-gate flows nearly for free. Must land in Milestone 1 — miserable to retrofit, as the spec says. |
| 2.3 | Reads via content scripts, writes via `chrome.debugger`/CDP (`Input.dispatchMouseEvent`) | Synthetic JS clicks produce `isTrusted:false` and are ignored or detected by many sites. CDP input is the only reliable write path. |
| 2.4 | **Element indexing** (numbered menu, never selectors/coordinates from the LLM) | What browser-use, Nanobrowser and Stagehand all converged on independently. LLMs are good at picking from lists, bad at inventing selectors. |
| 2.5 | **One model, one element index, verbosity ladder** (escalation = how much you send, not which model you call) | Avoids the two-framework trap where fallback context is lost. The failure taxonomy (§3.3: escalation fixes only 2 of 6 failure classes) is unusually honest and correctly prioritises verification, recovery routines and wait-retry. |
| 2.6 | **Token-metered credits**, `creditsFor()` from the real `usage` object, cost-weighted | Closes the per-task pricing hole. 1 credit = $0.001 provider cost, sold at ~30% margin. A 500-credit trial costs ~$0.50 of inference — a cheap, cardless trial is financially safe. |
| 2.7 | **Merchant of Record** (Paddle/LemonSqueezy), own checkout, webhook → entitlement → JWT | The standard pattern for paid extensions (CWS payments are discontinued). Matches the reference architecture: Extension → Backend API → Payment Provider, webhook → licence DB → extension checks entitlement via API. |
| 2.8 | **BYOK direct-to-OpenAI**, never proxied | Works because extensions with host permission bypass CORS. Proxying BYOK would destroy the exact privacy claim the tier exists to make. |
| 2.9 | Guardrails **enforced in code**, never in the prompt | Prompt-level gates can be argued past by hostile page content; code-level gates cannot. Correct for a product driving logged-in sessions. |
| 2.10 | Empty `host_permissions` + runtime per-site grants | Transforms the install prompt, review outcome, and gives the domain allowlist enforced by Chrome itself. The single most consequential manifest line, as the spec says. |

---

## 3. Risk register

| ID | Risk | Likelihood | Impact | Mitigation already in spec | Residual |
|---|---|---|---|---|---|
| **R1** | CWS rejects or slow-walks the `debugger` permission | Medium | Existential for distribution | Narrow vertical → single-purpose statement; empty host_permissions; written justification before building; weeks of review budgeted | Cannot be coded away. A policy shift on `debugger` is the one threat the architecture has no answer for. Keep the justification two sentences long and boring. |
| **R2** | Vertical still undecided (§14 Q1) | Certain (open) | Blocks store submission | Documented as the blocking open question | Also blocks Milestone 0 (benchmark suite needs target sites) and the single-purpose statement. **This is the first decision product must make.** |
| **R3** | Target sites resist automation (ToS, anti-bot) | Medium | Medium–High | Non-goals exclude social automation; vertical criteria include "no anti-automation stance" | The extension form factor has no stealth surface (no fingerprint patching, no IP rotation). The chosen vertical must tolerate or welcome automation. |
| **R4** | Reliability economics miss the model | Medium | Medium | §1.3 honesty about ~30% completion; checkpoint/resume; Milestone 0 benchmark harness before anything else | §9 consumption figures are modelled, not measured (the spec says so). Treat Milestone 0 output as capable of changing plan sizes and margins. |

---

## 4. Documentation gaps (scoping items)

Ranked by when they bite. "Blocks" = what cannot be completed until the gap is closed.

### G1 — Auth flow for the hosted tier is unspecified — **blocks Milestone 6 and hosted onboarding**
- Onboarding step 2 offers "We handle it" with 500 trial credits, but no document says how the user authenticates (email magic link? OAuth via `chrome.identity.launchWebAuthFlow`?).
- `chrome.identity` requires the **`identity` permission, which is not in the §6.1 manifest**.
- Mockup 03 covers only the BYOK key-entry path; the hosted path's account-creation screen has **no mockup**.
- JWT issuance, refresh and expiry behaviour are unstated (`background/entitlement.ts` says only "cached JWT, graceful offline").
- **Needed:** an auth + entitlement contract (flow choice, manifest permission, JWT shape/refresh, mockup for hosted onboarding step 3).

### G2 — `downloads` permission missing from the manifest — **blocks Milestone 4**
- The flagship example task is "Download last month's invoices and **rename them by vendor**", and the confirm-gate mockup is about **file overwrite**.
- Per-file renaming and overwrite detection map to `chrome.downloads` (`onDeterminingFilename`, `conflictAction`) — which requires a `downloads` permission absent from §6.1. CDP's `Browser.setDownloadBehavior` cannot do per-file renames.
- **Needed:** add `downloads` to the manifest section and the permission-justification list.

### G3 — Backend is under-specified relative to the extension — **blocks Milestone 6**
- §8 is one page. Missing: endpoint contracts, Supabase schema (users / entitlements / usage_ledger), Paddle/Stripe webhook handling, the remote-config endpoint §7.6 depends on.
- **Concurrency bug in the billing rule as written:** "balance checked before each request, decremented after" (§8.3) is a check-then-act race — with 3 concurrent runs, two runs can both pass the check against the same balance. Needs an atomic conditional debit (`UPDATE … WHERE balance >= cost`) or per-step reservation.
- Unspecified product policy: credit expiry, refunds, plan stacking (top-up + subscription), downgrade behaviour, dunning for failed renewals.
- **Needed:** a backend API contract doc + billing policy decisions (product-owned).

### G4 — Trial abuse prevention — **blocks Milestone 6 launch**
- 500 free credits with no card is a farming vector (throwaway accounts at $0.50 each). §8.3 identifies quota abuse as the real threat but doesn't cover trial farming.
- **Needed:** email verification at minimum; consider per-device/IP rate limits in the Worker.

### G5 — Read-only enforcement has two documented holes — **needs spec acknowledgement, not new code**
- **WebSockets:** the `Fetch` domain does not intercept WebSocket frames. Apps that mutate state over WS (collaborative editors, chat) are not covered by "abort any non-GET".
- **Legitimate POSTs break:** non-GET blocking is tab-wide. Search-as-you-type, infinite scroll and autosave often use POST; those pages partially break in read-only mode, and the user's own typing in that tab cannot POST while attached.
- **Needed:** document both as known trade-offs with a feedback channel; a future read-endpoint allowlist is possible but erodes the mechanical guarantee — a product decision, not an engineering one.

### G6 — `chrome.debugger.onDetach` handling is absent — **blocks Milestone 2/3 polish**
- The user can click "Cancel" on the debugger banner at any time, detaching the debugger mid-run. The docs cover kill switch, gates, stuck and out-of-credits — but not "user dismissed the banner".
- **Needed:** a first-class run state (paused, reason "debugging cancelled", resumable from checkpoint) plus a panel/ledger treatment.

### G7 — Only one of eight Options screens is mocked — **blocks Milestone 4 UI completeness**
- Mockup 20 covers "Your data" only. Runs, Guardrails, Sites, Keys, Models, Spending and Account have no mockups and will be designed ad hoc during build otherwise.
- The rolling-average estimate behind "about N more tasks like yours" (UI spec §5) has no storage/computation spec (presumably local IndexedDB — should be stated).
- **Needed:** mockups (or at least content inventories) for the remaining seven Options sections; one paragraph on the rolling-average mechanism.

---

## 5. Inconsistencies and errata in the specs

| ID | Item | Detail | Resolution |
|---|---|---|---|
| **E1** | Perception vs. banner tension | §2.3 says reads happen via content scripts with "no debugger banner", but §2.4's perception is `Accessibility.getFullAXTree` — a CDP call requiring the debugger attached. Both viable; docs should pick. Practically this resolves to attach-per-run (not per-step), with the banner present for the run's duration — which the UI already treats as "agent is working". | Spec-text decision; recommend DOM-based perception in the content script for tier 2, AX tree via debugger only where DOM traversal is insufficient. |
| **E2** | Prompt-caching description mixes providers | "Explicit cache breakpoints, 30-minute minimum cache life" (§7.1) is Anthropic semantics. OpenAI prompt caching is automatic prefix caching; the `cached_tokens` field in §9.2 is the correct OpenAI side. | State which mechanism applies per provider in `llm/router.ts` docs; structure prompts as stable prefix + variable suffix either way. |
| **E3** | Path mismatch | Both specs reference `ui/mockups.html` and `ui/tokens.css`; the files live flat in `Instructions/`. | **Resolved in v0.3.1** — files moved to `Instructions/ui/`. |
| **E4** | Boilerplate diverges from spec | Starter ships a popup (UI spec §4 forbids one) and a static content script on google.com (spec: inject on demand only). Missing deps per §2.6: `dexie`, `zod`, `@fontsource/ibm-plex-*`, `vitest`. | Expected — clean up in Milestone 1. Backend deps (hono, supabase, stripe) imply a separate backend package/repo, which the docs should state explicitly. |
| **E5** | "Replayable" audit log | Settings → Runs promises "filterable, replayable" with no supporting design. | Spec it or downgrade to "viewable". |

---

## 6. Decisions needed from product

Ordered by what's blocking most.

1. **The vertical** (spec §14 Q1) — gates store submission, Milestone 0, and the `debugger` justification. Criteria in the spec are good: boring, repetitive, stable DOM, no anti-automation stance, high frequency, miserable manual alternative.
2. **Hosted auth method** — magic link vs OAuth (G1). Determines the `identity` permission and onboarding mockup 03's hosted variant.
3. **Billing policy** — credit expiry, refunds, top-up + subscription stacking, downgrade, dunning (G3). Merchant of Record confirmed as the right call (Paddle or LemonSqueezy); pick one.
4. **Trial anti-abuse floor** — what verification a cardless trial requires (G4).
5. **Product name and icon** (§14 Q2) — store listing constraints to design against: title ≤ 45 characters, no superlatives ("Best", "#1", "Free"), no Google/Chrome trademarks, and the 16px monochrome legibility requirement already in the UI spec.
6. **E1 perception strategy** — DOM-based vs AX-tree (engineering-led, but it shapes the privacy copy: DOM-based reads never leave the machine until prompt construction).

---

## 7. Recommended pre-development actions

1. Decide the vertical (product).
2. Write the auth + entitlement contract: `identity` permission, flow, JWT shape/refresh, atomic debit semantics, trial anti-abuse (product + engineering, ~1–2 days of doc work).
3. Amend the spec: add `downloads` and `identity` to §6.1; resolve E1/E2/E3; mock hosted onboarding step 3 and the seven missing Options screens (design).
4. **Milestone 0 spike before any product code:** attach debugger → perceive → index → click → verify on 3–5 candidate vertical sites, with token counting wired in. Validates the two riskiest technical assumptions (perception quality, token consumption) for days of work, and produces the numbers §9 currently models.

A full browser-extension skill set is available on the engineering side for the build phase (scaffolding, manifest validation, testing, payments, CWS review prep), so no additional tooling procurement is needed.

---

## Appendix — Store submission notes for Milestone 9

Surfaced during compliance review; not urgent, but cheaper to know now:

- **Source maps:** CWS allows minified bundles but reviewers expect source maps for readability. WXT produces minified output — include source maps in the submission zip.
- **Remote config must stay data, never behaviour.** §7.6's remote model/price config is safe, but "core functionality changed via remote configuration" is a single-purpose violation. Config = model IDs, prices, feature flags; never shipped logic.
- **Permission justifications** are required per sensitive permission in the developer dashboard; `debugger` tops the list. Write these before building, as §12 says.
- **Description** ≤ 132 characters (already noted in §6.1) and must state exactly one purpose in its first sentence.
- Budget the spec's "weeks" of review for `debugger` + host patterns over generic "1–3 days" guidance — sensitive-permission extensions with broad patterns are the slow lane.

---

## Addendum — v0.3 / v0.3.1 re-review (4 September 2026)

The specs were revised after product alignment (v0.3) and a follow-up pass (v0.3.1). Status of this report's findings:

**Closed in v0.3:** G1 (device-code auth contract, §8.1b — the `identity` permission avoided entirely), G2 (`downloads` deferred with an explicit trigger tied to the vertical decision), G3 (atomic conditional debit, §8.3), G4 (trial abuse floor: email verification + per-IP rate limits, §8.1b), G5 (read-only restructured: action-layer primary, per-site network opt-in, §5.1), G6 (run state machine plus the `paused: detached` UI, §3.5 / UI §9.8 / mockup 20), G7 (Options content inventories, rolling-average mechanism, UI §10.1 / §5.1), E1 (perception pinned to CDP, attach-per-run, §2.3), E2 (prompt ordering pinned as load-bearing, caching mechanism flagged verify-in-M0, §7.5), E5 ("viewable, not replayable", §11).

**Closed in v0.3.1:** the §5.1 residual overclaim (definition softened to "cannot type, upload, or submit", with confirm gates as the click backstop and an explicit "What read-only does not stop" paragraph), the stale attach/detach line (§2.3), stale `Fetch`-interception cross-references (§6.2, §13), §7.6/§7.7 ordering, the `ui/` path mismatch (files moved to `Instructions/ui/`), the unmocked device-code screen (UI §6.2c + mockup 03b), and the EEA/CH/UK detection mechanism for the Gemini-key warning (§7.7 — timezone + locale, fail-safe toward showing).

**New product-owned items recorded in the spec:** billing policy (open question 7, blocks Milestone 6), prompt-injection adversarial review (open question 8, before Milestone 4), strict read-only rollout ownership (open question 9).

**Verdict:** the documentation is build-ready for Milestones 0–3. The vertical decision remains the only blocker, and only for store submission.

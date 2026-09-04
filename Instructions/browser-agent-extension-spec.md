# Browser Agent Extension — Technical Specification

**Version:** 0.3.1
**Date:** 4 September 2026
**Audience:** Coding agent implementing v1

**Companion documents — read all three before starting:**

| File | Contents |
|---|---|
| `browser-agent-extension-ui-spec.md` | Design tokens, screen-by-screen behaviour, copy rules, accessibility |
| `ui/mockups.html` | Every screen as static HTML, in journey order. Open in a browser. |
| `ui/tokens.css` | Design tokens and component classes. **Import this; do not re-derive values from the mockups.** |

**Status:** Architecture and UI decided. One open item blocks store submission — see [§14](#14-open-questions).

**Changes from v0.1:** OpenRouter removed in favour of the OpenAI API directly. GPT-5.6 Luna pinned as the single model at every escalation tier. Billing switched from per-task to token-metered credits. Read-only defined mechanically. Scheduling and limited concurrency moved from non-goals into scope. Two UI screens deleted. **Open-source references clarified and full dependency list added (§2.5–2.6): Stagehand v4 is the primary reference, Nanobrowser the secondary; neither is a dependency.**

**Changes from v0.2 → v0.3 (post feasibility review):** Read-only enforcement restructured to action-layer primary with network-layer as per-site opt-in — the previous non-GET rule broke GraphQL apps entirely (§5.1). Credit debit changed to an atomic conditional `UPDATE` — the previous check-then-act raced under concurrency (§8.3). Perception clarified as CDP accessibility tree throughout, content scripts for verification only (§2.3). Prompt ordering pinned as a cost requirement (§7.5). Run state machine added with `onDetach` handling (§3.5). Device-code auth contract added (§8.1b). Provider data terms and the Gemini ZDR enterprise path recorded, plus a mandatory free-tier Gemini key warning (§7.7). `downloads` and `identity` documented as deliberately absent (§6.1). "Replayable" run log downgraded to "viewable" (§11).

**Changes from v0.3 → v0.3.1 (review follow-up):** Read-only definition softened to match what the mechanism delivers — it blocks typing, uploads and form submission, with confirm gates as the backstop for mutating clicks; it is not a guarantee that server state never changes (§5.1). Stale "attach → act → detach" line removed — the debugger stays attached for the run's duration (§2.3). §7.6/§7.7 ordering corrected. `Fetch`-interception cross-references updated for the two-layer read-only design (§6.2, §13). EEA/CH/UK detection mechanism for the Gemini-key warning specified (§7.7).

---

## 1. Overall Goal

A **Manifest V3 Chrome extension** running an AI agent inside the user's own browser, driving pages they are already logged into, with a privacy posture competitors cannot match structurally.

### 1.1 Positioning

Every serious general browser agent on the market (Polar, Comet, Atlas, Dia) ships as a **forked Chromium browser**. We are deliberately not doing that. The extension form factor trades capability for two things those products cannot offer:

1. **Enterprise force-install.** Chrome's `ExtensionInstallForcelist` policy lets an IT admin push the extension to a whole managed fleet — no binary download, no user action, works on the Windows fleets a macOS-only browser cannot reach. This is the primary distribution thesis.
2. **A structural privacy claim.** In bring-your-own-key mode, page content travels browser → OpenAI directly. Our servers are not in the path. Verifiable in devtools, not a policy promise.

### 1.2 Non-goals

| Non-goal | Reason |
|---|---|
| General "does anything" agent | Violates Chrome Web Store single-purpose policy |
| Social media automation (post / DM / follow) | X and LinkedIn ToS prohibit browser automation; suspension lands on **the user's** account |
| Canvas apps (Canva, Figma) | No DOM, no accessibility tree. Requires vision-only coordinate work. Roadmap |
| More than 3 concurrent runs | See [§3.4](#34-concurrency) |
| Our own revenue dashboard | Stripe Dashboard + Baremetrics covers it |

### 1.3 Reliability reality check

Per-step reliability compounds: at 95% per step a 30-step task succeeds 21% of the time. Independent evaluation (Online-Mind2Web, COLM 2025) found frontier agents complete roughly 30% of real tasks, with the best commercial system at 61.3%.

**Design consequence:** the product is built around checkpoints and recovery, not autonomy. Never assume a run completes. Every decision below follows from this.

---

## 2. Architecture

### 2.1 Component responsibilities

| Component | Lifetime | Responsibility |
|---|---|---|
| Service worker | Dies when idle | Thin event router. **Holds no state.** |
| Offscreen document | We control | Hosts the agent loop(s) |
| Side panel | While open | Run viewer: ledger, kill switch, confirm gates |
| Tasks tab | Full tab | Task library, launcher, run status |
| Options tab | Full tab | Settings |
| Content script | With the page | Reading page state only |
| IndexedDB | Persistent | Run checkpoints, page memory, audit log |

### 2.2 The load-bearing rule

**The agent loop does not live in the service worker.** MV3 kills it when idle and there is no fully reliable prevention.

- Agent loop runs in the **offscreen document**
- An open side panel maintains a long-lived port, which helps but is not sufficient
- **Run state is checkpointed to IndexedDB after every single step**, so a worker restart resumes rather than restarts

Not optional, and miserable to retrofit. Build it in Milestone 1.

### 2.3 Perception and action split

**Perception → CDP (`Accessibility.getFullAXTree`).** The debugger is attached for the whole run regardless, because you need it to act — so there is no banner to save by avoiding CDP for reads. Attach once per run, not per step.

Do **not** substitute DOM traversal in a content script for primary perception: accessibility-tree trimming takes a page from roughly 35.7k tokens to 7.4k, and input is most of your credit consumption.

**Verification → content scripts.** Cheap polling without a CDP round-trip: has the spinner cleared, did the row count change, is the toast visible.

**Writing → `chrome.debugger` (CDP).** A JS `element.click()` produces `isTrusted: false` — it skips the real event sequence, React's synthetic event system often ignores it, controlled inputs don't update, and many sites check the flag. CDP's `Input.dispatchMouseEvent` injects below the renderer with `isTrusted: true`.

Attach once per run and stay attached for the run's duration. The one exception is the 3-minute detach while paused on a confirm gate (§3.4). The banner is therefore present whenever the agent works — onboarding and the panel already frame it that way (UI spec §3, §6.1).

### 2.4 The element indexing pattern

The LLM never emits selectors or coordinates. It picks from a numbered menu.

```
1. Perceive:    Accessibility.getFullAXTree → trim → enumerate → assign indices
2. Prompt:      hand the model the numbered list
3. Model:       returns "click 14"
4. Resolve:     index 14 → backendNodeId → DOM.getBoxModel → centre point
5. Act:         Input.dispatchMouseEvent at (x, y)
6. Verify:      content script confirms expected state change
7. Checkpoint:  write step result to IndexedDB
```

LLMs are bad at inventing selectors and terrible at estimating coordinates, but good at picking from a list. Every major framework converged on this independently.

### 2.5 Open-source references: harvest, don't fork

**Nothing is imported as a dependency.** Two projects are read as references, for different layers. Neither is forked, and neither was "chosen" as a base.

| Reference | What it teaches | Lands in |
|---|---|---|
| **Stagehand v4** — primary | CDP dispatch and perception from inside an extension | `agent/cdp.ts`, `agent/perceive.ts` |
| **Nanobrowser** — secondary | Web Store product plumbing | project skeleton, `llm/providers/` |
| **browser-use** — tertiary | Prompt and serialisation heuristics | `agent/escalation.ts` prompts |

#### Stagehand v4 — primary reference

`github.com/browserbase/stagehand`

v4 moved target management, frame and execution-context tracking, and CDP dispatch into a browser extension that starts with the browser and dies with it. That is precisely our hardest problem, solved by people who benchmarked it: 2x faster than Playwright and ~80% more token-efficient, with hybrid accessibility-tree trimming taking a page from ~35.7k tokens to ~7.4k.

**Read specifically:** the extension package's CDP dispatch layer, `observe()`, the accessibility-tree trimming, and the deep-locator handling for nested iframes and closed shadow DOM — that last one addresses the limitation recorded in §6.4.

**Why it cannot be a dependency.** The architecture is `your SDK code ←→ Stagehand's extension ←→ the page`. Your code is still an external Node, Python or Go process, and the extension is Stagehand's own artifact — uploaded into a session and deleted on `browser.close()`. You begin with `localBrowser.launch()` or `browserbase.launch()`, and launching a browser is not something an extension can do, because it is already inside one. Ours **is** the product: installed from the Web Store, with no external process.

**Two hard conflicts even if it could be.** v4 caches `act()`, `observe()` and `extract()` results **on Browserbase's servers**, and the browser runtime makes Model Gateway and managed-cache calls to Stagehand's own URL. Both are incompatible with §8.1.

#### Nanobrowser — secondary reference

`github.com/nanobrowser/nanobrowser` — Apache-2.0, TypeScript, ~13k stars

The closest existing thing to this *product*: a user-installed Web Store extension with BYOK. Read it for what Stagehand's extension has no reason to contain — MV3 lifecycle, side panel plumbing, the install and permission flow, local key storage, multi-provider abstraction.

**Why not fork it:**

1. **Different agent shape.** It runs a Planner/Navigator multi-agent split where the Planner self-corrects and re-instructs the Navigator. Ours is a single loop with an observation-verbosity ladder (§3). You would fight its architecture more than you would write ours.
2. **Different UI.** A chat sidebar versus our ledger (UI spec §1.2). That is a complete rewrite, and it is most of the code.
3. **Conflicting defaults.** PostHog analytics on by default; ours is opt-in (§11). Inheriting a tree whose defaults contradict your positioning is a recurring liability, not a one-time fix.
4. **None of the load-bearing pieces exist there.** No credits or metering, no proxy, no structural-fingerprint memory, no code-enforced confirm gates, no read-only network interception, no scheduling.

#### browser-use — tertiary reference

`github.com/browser-use/browser-use`. Python, and its abstractions are Playwright-shaped (browser contexts, page objects) which do not exist here. Read the system prompts and DOM-serialisation heuristics only.

#### Licence obligations

**Verify per package before copying anything.** Stagehand is a monorepo whose SDK and server/extension packages may not share terms. Nanobrowser is Apache-2.0: commercial use and modification are permitted, but verbatim copying requires preserving `LICENSE` and `NOTICE`, stating your changes, and attributing. Reading and reimplementing carries no obligation — credit both in the README regardless.

Use canonical repos only. Search results surface many near-identical Nanobrowser forks, and that project explicitly disclaims crypto or token-based derivatives built on its codebase.

### 2.6 Dependencies

No agent framework. Everything below is infrastructure.

**Extension**

```
wxt                          # build, manifest generation, HMR for extension contexts
typescript                   # strict mode
react  react-dom             # panel / tasks / options UI (plain TS is viable; React is the default)
dexie                        # IndexedDB — page memory, run checkpoints, audit log
zod                          # validate the model's structured output before acting on it
@fontsource/ibm-plex-sans    # bundles WOFF2 locally — satisfies the no-CDN font rule
@fontsource/ibm-plex-mono
```

**Do not add the `openai` SDK to the extension bundle.** It requires `dangerouslyAllowBrowser: true`, pulls in weight you don't need, and you are making one endpoint call. Use `fetch` directly. Keep the SDK on the Worker if you want it there.

`zod` is not optional. The model returns an action to execute against a live logged-in session; validate its shape before it reaches `agent/act.ts`.

**Backend (Cloudflare Worker)** — a **separate package or repo**, never bundled into the extension.

```
hono                         # router
@supabase/supabase-js        # auth, entitlements, usage ledger
openai                       # optional, server side only
stripe                       # or @paddle/paddle-node-sdk
```

**Dev**

```
vitest                       # unit tests, especially creditsFor() and the fingerprint hash
@types/chrome
eslint  prettier
```

**Optional, later**

```
@xenova/transformers         # local embeddings if semantic page recall is added (§4.4).
                             # Needs wasm-unsafe-eval, already in the manifest CSP.
```

**Styling** comes from `ui/tokens.css`. Import it; do not add a CSS framework. Tailwind in particular would fight the token system and inflate the bundle for no gain — the whole design is seven colours and a dozen components.

---

## 3. The Escalation Ladder

One perception layer with a verbosity dial. **Do not run two frameworks** — two element indexes mean the failure history is written in a vocabulary the fallback doesn't speak, and you lose context exactly when it matters most.

### 3.1 The tiers

| Tier | What is sent to the model | Trigger to escalate |
|---|---|---|
| 1 | nothing — replay cached action path | no cache hit |
| 2 | trimmed accessibility tree, text only | element not found |
| 3 | accessibility tree + screenshot | still stuck |
| 4 | screenshot only, coordinate clicking | guardrail / ambiguity |
| 5 | hand back to user | terminal |

**The model does not change between tiers.** GPT-5.6 Luna is multimodal, so it serves tiers 2, 3 and 4. Escalation is about *how much you send*, not *which model you call*. This is the single biggest simplification in v0.2 — one SDK, one auth path, one caching scheme, one rate-limit bucket.

Every tier reads from **the same element index**, so escalating costs nothing in continuity. The failure record ("tried 7, then 12, modal did not close") is the most valuable thing in the retry prompt.

### 3.2 Build order

**Ship tier 2 + tier 5 first.** Cheap observation plus a clean "I'm stuck, here's what I tried" handoff is a complete product. Add tier 3 when failure logs show which pages need it, tier 1 once you know which flows repeat, tier 4 only for canvas work.

### 3.3 Failure taxonomy — escalation fixes only two of six

| Failure | Fix |
|---|---|
| Wrong element chosen | Escalate ✅ |
| Canvas / no semantic layer | Escalate to tier 4 ✅ |
| Action fired, nothing happened | **Post-action verification**, not more observation |
| Unexpected state (cookie banner, expired session, A/B variant) | **Dedicated recovery routines** |
| Race condition | **Wait 800ms, retry identical observation** (free) |
| Ambiguous instruction | Tier 5 |

Implement verification and wait-retry from day one. A dismiss-overlay routine fixes more real failures than any model upgrade.

### 3.4 Concurrency

`chrome.debugger` can attach to several tabs simultaneously, so parallel runs are feasible — but bounded:

- **Hard cap: 3 concurrent runs.** Enforce in code.
- **Refuse two concurrent runs on the same origin.** They share one cookie jar; when one navigates, the other's element index goes stale and it produces confidently wrong actions that are extremely hard to debug.
- Each run needs its own tab, and each tab shows its own debugger banner.
- One offscreen document orchestrates every loop.
- **A run paused on a confirm gate detaches its debugger after 3 minutes**, keeps its checkpoint, and re-attaches on approval. Otherwise the banner sits there indefinitely and the browser feels hijacked.

### 3.5 Run states, including involuntary detach

`chrome.debugger.onDetach` fires with a reason and **must be handled as a first-class state**, not an error. Both triggers are likely:

| `reason` | Cause | Probability |
|---|---|---|
| `replaced_with_devtools` | User opened DevTools on the agent's tab | **High** — technical early adopters do this constantly |
| `canceled_by_user` | User dismissed the debugger banner | Medium |
| `target_closed` | Tab closed mid-run | Medium |

All three resolve to `paused: detached` with the reason recorded, resumable from the last checkpoint. Because every step is already checkpointed (§2.2) this is UI work, not architecture.

Full run state machine:

```
queued -> planning -> running -> complete
                   -> paused: gate        (awaiting approval)
                   -> paused: detached    (onDetach, resumable)
                   -> paused: credits     (out of credits, resumable)
                   -> paused: auth        (token expired, resumable)
                   -> stopped: stuck      (tier 5 handoff)
                   -> stopped: user       (kill switch)
                   -> stopped: cap        (max steps / duration / spend)
```

Only `stopped:` states are terminal. Every `paused:` state keeps its checkpoint and can resume.

---

## 4. Page Memory

### 4.1 Cache key: structural fingerprint, NOT URL

URLs carry session tokens, tracking params, pagination and fragments. `?page=2` and `?page=7` are the same template; `#inbox` and `#inbox/thread-id` are structurally different behind one origin.

**Key = hash of (normalised URL) + (accessibility tree shape).** Tree shape means roles and hierarchy, **deliberately excluding text content**. Same template + different data = same key. Excluding text also means the cache holds far less sensitive material.

Normalisation: origin + path, query params filtered against an allowlist, fragment dropped unless it's a route.

### 4.2 What to store

Derived artefacts only, never page content:

- Resolved selectors for named actions (`"submit button" → selector`)
- Structure fingerprints
- Successful action sequences
- Failure notes

### 4.3 Invalidation — stale cache is worse than no cache

A stale selector produces confident wrong clicks. Mandatory:

1. Before trusting a cached entry, **verify** the element still has the expected role and accessible name
2. On mismatch → invalidate and re-observe
3. TTL on every entry

Cheap, and non-negotiable.

### 4.4 Storage

- **IndexedDB via Dexie.** `chrome.storage.local` caps at 10MB. Request `unlimitedStorage`.
- **No vectors in v1.** Exact-match on the structural key covers ~90% of the value. If logs later demand semantic recall, use transformers.js locally (needs `wasm-unsafe-eval`, already in the manifest).
- **No `chrome.storage.sync`** — 100KB quota, and cross-device sync would break the local-only claim unless end-to-end encrypted.

### 4.5 Terminology discipline

This is **caching, not learning**. Real skill accretion (the Hermes/Polar "remembers how it solved a problem" property) is a substantially larger build. Do not market the second while shipping the first.

---

## 5. Guardrails

### 5.1 Read-only mode — two enforcement layers

Read-only means: **the agent may read and download, but may not type, upload files, or submit forms.** Default **on** for every new task. It is not a promise that server state never changes — see "What read-only does not stop" below.

Enforcement is **two-layered**, and the primary layer is the action layer — not the network layer.

> **Why not network-first.** Aborting all non-GET requests looks like a clean mechanical guarantee, but it breaks modern apps outright: **GraphQL clients (Apollo, Relay, urql) send every read query over `POST /graphql`.** On a GraphQL SaaS app, non-GET blocking doesn't degrade read-only mode — the page never loads. Search-as-you-type, infinite scroll and autosave frequently POST too, and the block is tab-wide, so the user's own typing in that tab also fails. WebSocket frames aren't covered by `Fetch` interception at all.

| Layer | Mechanism | Coverage |
|---|---|---|
| **Primary — always on** | Block the CDP write primitives (table below) | Works everywhere, including GraphQL and WebSocket apps |
| **Secondary — per-site opt-in** | `Fetch` domain, abort non-GET | Hardening only on sites verified not to break under it |

The primary layer maps directly onto the definition: the agent cannot *provide input*, so the usual mutation paths — typing into a field, uploading a file, activating a submit control — are mechanically closed, whichever transport would have carried the result. That also closes the WebSocket gap: you block the keystroke, not the frame.

| Allowed | Blocked |
|---|---|
| `Accessibility.getFullAXTree` | `Input.dispatchKeyEvent` — all typing |
| `DOMSnapshot.captureSnapshot` | `Input.insertText` |
| `Page.captureScreenshot` | `DOM.setFileInputFiles` |
| `Runtime.evaluate` — reads only | `Runtime.evaluate` with DOM mutation |
| Scroll (`mouseWheel`) | Form submission |
| Clicks that only navigate | Clicks resolving to submit controls (`type=submit`, `role=button` inside a `<form>`, `formaction`) |
| `Page.navigate` within granted origins | |
| Downloads (`Page.setDownloadBehavior`) | |

**Why clicks are allowed:** paginating a table or expanding an accordion requires them, and a strict no-click rule would make read-only useless for its main purpose. Blocking the *input* primitives is what makes that safe — the agent can navigate but cannot type, upload, or activate a submit control.

**What read-only does not stop.** A click on a plain non-submit control can still mutate server state — "Archive", "Mark all as read", a star toggle — because there is no way to know what a click will trigger before it fires. The backstop is §5.3: confirm gates catch actions whose accessible name matches a mutation pattern, and an unattended scheduled run pauses at the gate instead of executing. A mutating click that matches no gate pattern will execute in a read-only run; that class is low-harm and accepted deliberately. Keep privacy copy to what the mechanism delivers — "the agent can't type, upload or submit, and dangerous clicks ask first" — never "cannot mutate server state."

**Per-site network hardening** is a stored per-origin flag, default off, enabled after a run confirms the site works under it. Surface it in Settings → Sites as "strict read-only", with an honest note that some sites break.

**Downloads are permitted** because they write to local disk, not to the page. Overwriting an existing file still triggers a confirm gate (see [§5.3](#53-confirm-gates)).

The compose view should detect a description implying writes ("submit", "send", "pay", "rename") and surface a hint that the task probably needs write access — but never flip the default silently.

### 5.2 User-configurable guardrails

**Scope** — domain allowlist per session; may open new tabs; may navigate off-origin; may enter iframes; max steps; max wall-clock; max credits per run.

**Data** — domains whose content is never sent to any model (banking, health); pattern redaction before prompt construction (card numbers, national IDs, anything in a password field); never read password fields or autofill.

**Session** — always-visible kill switch; pause / step-through; complete audit log.

> Redaction is rarely implemented by competitors and is the most defensible line in your privacy copy. Do not skip it.

### 5.3 Confirm gates

Mandatory approval before: form submit, payment, send / post / DM, delete, upload, file overwrite, and any action on an element whose accessible name matches a never-touch pattern.

**Enforced in application code.** Never requested in the system prompt — a prompt-level gate can be argued past by any page.

### 5.4 Prompt injection

The agent has `chrome.debugger` access to the user's logged-in sessions. Attacker-controlled page text is a live exfiltration path.

1. Page content and instructions are **structurally separated** in the prompt (distinct message roles or delimited blocks, never concatenated)
2. The agent may revise its *actions* from page content, **never its goal**
3. Confirm gates live in code, per §5.3

### 5.5 Scheduled runs

Scheduling is in scope, with honest constraints:

- `chrome.alarms` only fires **while Chrome is open**. A Friday 17:00 task simply will not run if the browser is closed.
- **A silently missed schedule is worse than no schedule.** Persist a `missed` state and surface it on the task card with the reason.
- **Scheduled runs are forced read-only.** Nobody is watching, so nobody can answer a confirm gate. A run that hits an approval boundary pauses, fires a notification, and sets the action badge to `!`.
- Never auto-approve. There is no configuration that permits it.

---

## 6. Manifest & File Layout

### 6.1 manifest.json

```json
{
  "manifest_version": 3,
  "name": "TBD",
  "version": "0.1.0",
  "description": "Under 132 characters, shown in the store listing.",
  "minimum_chrome_version": "116",

  "icons": { "16": "icons/16.png", "48": "icons/48.png", "128": "icons/128.png" },

  "action": { "default_title": "Open tasks" },
  "side_panel": { "default_path": "sidepanel.html" },
  "options_page": "options.html",

  "background": { "service_worker": "background.js", "type": "module" },

  "commands": {
    "halt-agent": {
      "suggested_key": { "default": "Ctrl+Shift+Period", "mac": "Command+Shift+Period" },
      "description": "Stop the agent immediately"
    }
  },

  "permissions": [
    "debugger", "sidePanel", "storage", "unlimitedStorage",
    "tabs", "scripting", "offscreen", "alarms", "notifications"
  ],

  "host_permissions": [],
  "optional_host_permissions": ["https://*/*"],

  "content_security_policy": {
    "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
  }
}
```

**Four decisions worth defending:**

1. **Empty `host_permissions` + `optional_host_permissions`** is the single most consequential line. The install prompt no longer says "read and change all your data on all websites." Request each domain at runtime via `chrome.permissions.request()`. This transforms review outcomes and install conversion, and gives you the domain allowlist enforced by Chrome itself.
2. **No static `content_scripts`.** Inject on demand with `chrome.scripting.executeScript` once permission exists.
3. **`wasm-unsafe-eval`** reserved for transformers.js if semantic memory is added later. `script-src` cannot be loosened beyond this.
4. **The action icon opens the Tasks tab, not the panel.** Call `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false })` and handle `action.onClicked` by opening the Tasks tab. The panel has no idle state — it is a run viewer, and you don't open a viewer with nothing to view.

Add a `"key"` field during development so the extension ID stays stable across reloads (the backend allowlist depends on it).

**Two permissions deliberately absent:**

- **`downloads`** — needed only if the chosen vertical requires per-file renaming or overwrite detection (`chrome.downloads.onDeterminingFilename`, `conflictAction`). CDP's `Browser.setDownloadBehavior` cannot rename per file. The mockups' invoice-renaming example is an *illustration*, not a requirement. **Decide the vertical first (§14 Q1), then add this only if something depends on it** — stacking a second sensitive permission beside `debugger` in one submission is a bad trade for an example.
- **`identity`** — not used. Hosted auth uses the device-code flow in §8.1b instead.

Note: `Page.setDownloadBehavior` is deprecated; use `Browser.setDownloadBehavior` if you use CDP downloads at all.

### 6.2 File structure

```
extension/
├─ manifest.json
├─ src/
│  ├─ background/
│  │  ├─ index.ts           # thin event router, holds no state
│  │  ├─ run-controller.ts  # starts runs, checkpoints every step
│  │  ├─ scheduler.ts       # chrome.alarms, missed-run detection
│  │  └─ entitlement.ts     # cached JWT, graceful offline
│  ├─ offscreen/
│  │  ├─ offscreen.html
│  │  └─ loop.ts            # THE AGENT LOOP LIVES HERE (up to 3)
│  ├─ sidepanel/            # run viewer: ledger, kill switch, gates
│  ├─ tasks/                # task library, launcher, compose
│  ├─ options/              # settings, keys, data controls
│  ├─ content/
│  │  └─ reader.ts          # DOM reads, injected on demand
│  ├─ agent/
│  │  ├─ cdp.ts             # chrome.debugger wrapper
│  │  ├─ perceive.ts        # getFullAXTree, trim, index
│  │  ├─ act.ts             # getBoxModel + dispatchMouseEvent
│  │  ├─ verify.ts          # post-action state confirmation
│  │  ├─ escalation.ts      # the tier ladder
│  │  └─ guardrails.ts      # read-only action-layer blocking + per-site network opt-in (§5.1)
│  ├─ memory/
│  │  ├─ fingerprint.ts     # structural hash
│  │  └─ store.ts           # IndexedDB via Dexie
│  ├─ llm/
│  │  ├─ providers/         # openai | anthropic | ollama | proxy
│  │  ├─ router.ts          # tier → payload shape, config-driven
│  │  ├─ meter.ts           # usage → credits (see §9.2)
│  │  └─ redact.ts          # scrub before prompt construction
│  └─ shared/
│     ├─ messages.ts        # typed message contracts
│     └─ crypto.ts          # Web Crypto key encryption
└─ dist/                    # this is what you zip and upload
```

### 6.3 Tooling

- **WXT** — file-based entrypoints, manifest generation, working HMR for extension contexts, first-class TypeScript. (Alternatives: Plasmo, Vite + CRXJS.)
- **TypeScript** strict mode throughout
- **Dexie** for IndexedDB
- Import `ui/tokens.css` directly. Do not re-derive styling from the mockups.

### 6.4 Known limitations to design around

- **Cross-origin iframes are separate CDP targets.** Payment widgets and embedded docs are not in the main frame's tree — you need flattened target mode.
- **File uploads cannot use synthetic clicks.** The OS picker is outside the page. CDP offers `DOM.setFileInputFiles`, but you also need somewhere to source the bytes.
- **Permanently out of reach:** native browser dialogs (print sheet, profile menus) and anything rendered to `<canvas>`.
- **The debugger banner** cannot be hidden and occupies ~40px at the top of the viewport. Explain it during onboarding; never place our own banner directly beneath it.

---

## 7. Model

### 7.1 Pinned: GPT-5.6 Luna

`gpt-5.6-luna` at every escalation tier.

| Property | Value |
|---|---|
| Input | $0.20 / M tokens |
| Output | $1.20 / M tokens |
| Cached input | ~10% of input — **verify current rate** |
| Context | 1.1M tokens |
| Max output | 272K tokens |
| Multimodal | Yes — text + image in, text out |
| Caching | Explicit cache breakpoints, 30-minute minimum cache life — **contested, verify (§7.5)** |

Chosen because it is the cheapest model from a major lab, it is multimodal (so it serves tiers 2–4 alone), OpenAI does not train on API data by default with 30-day retention, and it is US-jurisdiction — which removes the procurement objection to Chinese-origin models entirely.

### 7.2 Why not DeepSeek — record this decision

DeepSeek trains on conversations by default and stores data on servers in China. Its privacy policy explicitly permits using conversations for training, research and product development; there is no confirmed public mechanism to request removal; no deletion timeline is stated. Reuters reported in January 2026 that DeepSeek was under privacy scrutiny in Australia, the Czech Republic, France, Germany, India, Italy, the Netherlands, South Korea, Taiwan and the US.

The usual escape hatch — route open weights to a Western host like DeepInfra or Together and never touch the vendor's infrastructure — **does not apply to the multimodal variant, whose weights are unpublished.** It is DeepSeek's API or nothing.

### 7.3 Why not OpenRouter — record this decision

v0.1 specified OpenRouter with ZDR provider filtering. Removed, because:

- Enforcing `zdr: true` would likely **exclude the GPT-5.6 family**, since standard OpenAI retention is 30 days and true ZDR requires a negotiated enterprise agreement unavailable at this stage
- The effective guarantee was the union of our setting and an opaque downstream provider's policy — a chain of trust, not a property
- ZDR filtering shrinks the routable provider pool, affecting latency, failover and availability
- OpenRouter's plugins and tools (e.g. web search) sit **outside** ZDR enforcement, so the claim would silently become untrue if we ever enabled them
- Calling OpenAI directly removes a hop, a fee, and a party from the privacy story

### 7.4 Cost traps

- **Never use the `gpt-5.6` alias** — it routes to Sol at $5/$30, a 25x bill. Pin exact model strings.
- **Output costs 6x input.** Reasoning tokens bill as output. **Pin reasoning effort to low at tiers 2–3** or an over-thinking model silently triples credit consumption. This is the largest single cost risk in the product.
- **Above 272K input tokens**, long-context rates apply. Per-request context is ~14K so this is safe today, but memory-recall features could breach it.
- **Regional endpoints add 10%** for models released on or after 5 March 2026.
- Sol's discount is temporary (three months from 21 August 2026) — irrelevant while pinned to Luna, but don't build on it if you later add Terra escalation.

### 7.5 Prompt caching

In an agent loop the system prompt plus action history forms a stable growing prefix — roughly **35% of input tokens are cacheable**, and that saving is already assumed in §9.

**Prompt ordering is load-bearing.** Whether the provider uses automatic prefix caching or explicit breakpoints, the stable content must come first:

```
system prompt  ->  task  ->  action history  ->  current page state
```

Get that backwards — page state before history — and the accessibility tree, which changes every step, invalidates the cache on every single call. That is a silent ~30% cost increase with no error and no symptom.

> **Verify before building.** Sources conflict on whether GPT-5.6 uses explicit cache breakpoints with a 30-minute minimum cache life, or automatic prefix caching as earlier OpenAI models did. Check the current API reference. The ordering rule above holds either way; only the breakpoint API call differs.

### 7.6 Provider interface requirement

Swapping models must be a **config change, not a code change**. `llm/router.ts` maps tier → payload shape and reads model IDs and prices from remote config, so a provider price change or model deprecation does not require a Web Store review cycle.

Three of four models recommended during planning were superseded within days. Treat §7.1 as a default in config, never as a constant in code.

### 7.7 Provider data terms — and the enterprise path

Recorded because it drives the privacy copy in §8.1 and the enterprise roadmap.

| Provider | Trains on API data? | Retention | True ZDR |
|---|---|---|---|
| **OpenAI (pinned)** | No, by default | 30 days, abuse monitoring | Negotiated enterprise agreement only — **not available to us** |
| **Gemini paid API** | No | Limited, Prohibited Use Policy only | Approval-gated, **no documented request path** |
| **Gemini Enterprise Agent Platform** | No | Configurable | **Self-serve** — requires Google Cloud enterprise |
| **Gemini free AI Studio** | **Yes** | — | No |

**Separate two things that are routinely conflated.**

**1. Training exclusion — free, automatic, no application.** On Paid Services, Google does not use prompts (including system instructions, cached content and files) or responses to improve its products. Enable billing and it applies. This is the part that carries the §8.1 privacy copy.

**2. The ZDR flag — approval-gated, and not realistically available to us.** On approval for a project, all user content and identifiable metadata (IP addresses, Google Account IDs) are cleared prior to logging, producing a sanitised record with parity to the Enterprise platform's ZDR. But the docs describe the outcome of approval and **never state how to request it** — no form, no eligibility criteria. And the page's own "what's next" directs anyone needing *self-serve* ZDR controls to the Gemini Enterprise Agent Platform instead. Treat Developer-API ZDR as account-team mediated: **a sales unlock once we have revenue, not a v1 capability.**

OpenAI is stricter still — enterprise agreement only, no request path — so nothing is lost by staying pinned to Luna.

#### Retention checklist — achievable today with no approval

Most of the ZDR page is a list of features that create retention. Avoiding them is free and gets us most of the practical distance:

| Feature | Retention | Action |
|---|---|---|
| Grounding with Google Search | 30 days, **cannot be disabled** | Never enable |
| Grounding with Google Maps | 30 days, **cannot be disabled** | Never enable |
| Interactions API | State storage **on by default** | Set `store: false` |
| File API | At rest until deleted or expired | Do not use |
| **Explicit** context caching (`cached_content`) | At rest for the user-set `ttl` | **Do not use** |
| **Implicit** in-memory caching | RAM only, project-isolated, 24h TTL | **Use this — explicitly does not violate ZDR** |

The caching row is a design constraint, not a footnote: on Gemini, rely on **implicit** caching only. Explicit `cached_content` stores at rest, breaks the claim, and carries a per-hour storage fee on top.

**The claim does not depend on any of this.** The BYOK tier's promise is architectural — browser → provider, our servers not in the path, verifiable in devtools, requiring no vendor's permission. The hosted tier's honest claim is "routed to a provider that does not train on API data; we never log content; retention is short and abuse-only," which is true today on any billing-enabled key. ZDR only upgrades the enterprise pitch.

**Why not switch the hosted tier to Gemini 3.8 Flash now.** At $0.75/$3.75 it is ~3.6x Luna per typical task ($0.166 vs $0.046); both rates double on 1 January 2027 to $1.50/$7.50, with the whole Flash 3.x family sharing that expiry; it **trails heavily on computer use** on Google's own benchmarks, which is precisely our workload; it reaches its scores by spending more reasoning tokens, giving a *higher* cost per completed task than its predecessor despite flat headline pricing; and its 64K output ceiling is tight for long tool-calling runs. Worth re-checking **Gemini 3.5 Flash-Lite** — if it prices near Luna it would give ZDR and competitive economics together.

#### BYOK hazard: free-tier Gemini keys — MUST IMPLEMENT

On free AI Studio, Google uses submitted content to improve its products including for machine-learning purposes, and reviewers may annotate inputs and outputs; the terms explicitly warn against submitting sensitive or confidential data.

A user pasting a free Gemini key turns their page content into training data that humans may read — silently breaking the promise on our own onboarding screen. Tier is not detectable from the key string, so:

1. Require explicit confirmation that the project is **billing-enabled** before accepting a Gemini key
2. Warn plainly otherwise, and do not treat the key as privacy-safe
3. The warning may be suppressed for users in the **EEA, Switzerland and the UK**, who receive paid-tier terms across all services including unpaid quota. Detection is client-side and fail-safe: check the IANA timezone (`Intl.DateTimeFormat().resolvedOptions().timeZone`) against the EEA/CH/UK zone list, cross-checked with the locale region (`navigator.language`). Suppress only when **both** indicate EEA/CH/UK; on any doubt, show the warning. Never use IP geolocation — BYOK makes no server contact, a false suppression silently breaks the privacy promise, and a false display costs only a checkbox.
4. Never enable Google's opt-in log/dataset sharing — shared logs may inform training of future models under Unpaid Services terms, with human review

---

## 8. Backend

### 8.1 The two-tier split — do not blur this

| | Credits tier | BYOK tier |
|---|---|---|
| Key holder | Us (Cloudflare Worker) | User (local, encrypted) |
| Request path | Extension → our Worker → OpenAI | Extension → OpenAI **directly** |
| Our servers see content? | Yes, in transit | **No** |
| Claim | "Routed to OpenAI, which doesn't train on API data. We never log content." | "Your data never touches our servers." |

**Never proxy BYOK traffic.** The standard advice about hiding API keys behind a proxy protects *your* key from *your users*. In BYOK the key belongs to the user — there is nothing to protect it from, and proxying would destroy the exact claim the tier exists to make.

Extensions with host permissions bypass CORS, so direct calls work. Anthropic (if added later) additionally requires `anthropic-dangerous-direct-browser-access: true`.

### 8.1b Hosted-tier authentication — device code, not `chrome.identity`

Onboarding step 2 offers a hosted tier with 500 trial credits, so the user needs an account. **Do not use `chrome.identity.launchWebAuthFlow`** — it requires the `identity` permission, and stacking another sensitive permission alongside `debugger` in the same review submission is the wrong trade.

**Use a device-code flow:**

1. Extension calls `POST /auth/device` → receives `{ device_code, user_code, verify_url, interval, expires_in }`
2. Extension opens `verify_url` in a normal tab and displays `user_code`
3. User signs in on your web app (email magic link) and confirms the code
4. Extension polls `POST /auth/device/token` at `interval` until it receives a token pair
5. On success: store refresh token encrypted via `shared/crypto.ts`; keep the access token in memory

No new manifest permission, no OAuth provider, no `externally_connectable` surface. Marginally clunkier than a popup; free on review.

**Token contract**

| Token | Lifetime | Storage | On expiry |
|---|---|---|---|
| Access (JWT) | 15 min | memory only | silent refresh |
| Refresh | 30 days, rotating | encrypted at rest | device-code flow again |

JWT claims: `sub`, `plan`, `credits_remaining`, `exp`, `iat`. Treat `credits_remaining` as **advisory for UI only** — the ledger in §8.3 is authoritative, and the atomic debit is the only thing that may gate a request.

**Offline:** a cached valid JWT permits the run to continue; an expired one pauses the run as `paused: auth` (resumable), never discards its checkpoint.

**Trial abuse floor.** 500 credits is ~$0.50 of non-resellable inference, so farming only pays at volume. Require email verification before credits are issued; add per-IP signup rate limiting in the Worker. If abuse appears, **cut trial credits to 300 rather than adding signup friction** — cardless is a conversion feature worth protecting.

### 8.2 Stack

- **Cloudflare Workers** — proxy for the credits tier. No cold start, cheap, good SSE streaming. (Vercel serverless timeouts are too short for agent steps.)
- **Supabase** — auth, Postgres for entitlements and the usage ledger.
- **Sentry** with aggressive PII scrubbing.
- **PostHog** (self-hostable) for server-side feature flags — Web Store review latency makes client-side A/B testing impractical — and privacy-preserving analytics.

### 8.3 The real threat is quota abuse, not key extraction

Anyone can extract a JWT from a running extension and script against it. Key hiding does not stop that. Server-side limits do.

Mandatory in the Worker:

- **Atomic conditional debit — never check-then-act.** With up to 3 concurrent runs, "check balance, then decrement" lets two runs pass the same check against the same balance. Use one statement:

  ```sql
  UPDATE balances SET balance = balance - $cost
  WHERE user_id = $u AND balance >= $cost
  RETURNING balance;
  ```

  Zero rows returned means insufficient credit. No race, no reservation records to reap. The Worker is already in the request path for the hosted tier, so this adds no round trip. Reservations only become worthwhile if per-step writes become a bottleneck, which at 25 steps x 3 runs they will not.
- Per-user request quota, windowed (hourly + daily), independent of the monthly balance
- Hard daily spend ceiling and anomaly alerting
- Assume every credential leaks eventually; keep the blast radius small

### 8.4 Logging discipline

**Log metadata only:** user ID, model, token counts, cached-token count, latency, credits, step number, structural fingerprint.

**Never log prompt content.** The moment you do, your own infrastructure becomes the weakest link in your privacy claim. For failure diagnostics log the fingerprint and step number, never page text.

---

## 9. Billing

### 9.1 Token metering, not per-task

Per-task pricing was a financial hole: a run that burns 50 steps and fails costs you real money and the user one "task." Token metering closes it — a run consumes exactly what it burned, so you are never underwater and the user is never charged for work they didn't get.

It also means **the retry multiplier stops mattering for pricing.** It only affects how you *describe* capacity.

### 9.2 The credit formula

Every OpenAI-compatible response returns a `usage` object. Meter what actually happened rather than estimating.

Because output costs 6x input and cached input is ~10x cheaper, raw token counts would misprice badly. Credits are **cost-weighted**. Define **1 credit = $0.001 of provider cost**:

```ts
// PRICE lives in remote config, never hard-coded.
const PRICE = { input: 0.20, cachedIn: 0.02, output: 1.20 }; // $ per 1M

export function creditsFor(usage: OpenAIUsage): number {
  const cachedIn   = usage.prompt_tokens_details?.cached_tokens ?? 0;
  const uncachedIn = usage.prompt_tokens - cachedIn;

  const costUsd =
      (uncachedIn / 1e6) * PRICE.input
    + (cachedIn   / 1e6) * PRICE.cachedIn
    + (usage.completion_tokens / 1e6) * PRICE.output;

  return Math.ceil(costUsd * 1000);
}
```

Accumulate per step, write to the ledger per step, so a killed run has already been billed for what it used.

### 9.3 Consumption model

A typical step sends ~2,000 tokens of system prompt (cacheable), ~7,000 of trimmed accessibility tree, ~150 per prior step of history, plus ~1,500 for a screenshot at tier 3. Output ~250 tokens.

| Task | Steps | Tokens (in / out) | Credits | Cost |
|---|---|---|---|---|
| Simple | 10 | 100K / 2.5K | ~17 | $0.017 |
| Typical | 25 | 280K / 6K | ~46 | $0.046 |
| Complex | 50 | 725K / 15K | ~117 | $0.117 |

**1M input tokens ≈ 3.5 typical tasks.** Keep that in mind — it is far less generous than "1M tokens" sounds.

### 9.4 Plans

At 30% margin, a credit sells for $0.00143.

| Plan | Price | Credits | ≈ typical tasks |
|---|---|---|---|
| Trial | free | 500 | ~6 |
| Starter | $9.99 | 7,000 | ~85 |
| Pro | $19.99 | 14,000 | ~170 |
| Power | $49.99 | 35,000 | ~420 |
| Top-up | $5 | 3,000 | ~36 |

Top-up is priced above the in-plan rate so upgrading always beats topping up. Subtract 3–5% for Stripe/Paddle fees.

### 9.5 BYOK tier

**Free**, with a skippable "Can you support the project?" prompt.

- Give payers a token benefit (badge, priority bug triage, early access to guardrail profiles). Pure donation prompts convert in low single digits; a token benefit multiplies that.
- **Model revenue as zero.** Anything it brings is upside.
- Rationale: monthly subscriptions below ~$3 lose 18–30% to payment processing fixed fees, and one support email costs more than a year of that user's revenue.

### 9.6 Payments

- **Paddle** or **LemonSqueezy** as Merchant of Record (handles global VAT/sales tax). **Stripe** if you want control and will run Stripe Tax.
- Chrome Web Store payments were discontinued years ago; you must use your own processor.
- **Do not build a revenue dashboard.** Stripe Dashboard + Baremetrics/ChartMogul.

### 9.7 Transparency requirements

Cursor's mid-2025 pricing crisis was a *labelling* failure, not a pricing one — opaque units, unexpected charges, refunds and a public apology.

- Meter always visible, always paired with a plain-language estimate from that user's **own rolling average** (see UI spec §5)
- User-settable hard credit cap
- Publish honest expected-usage bands
- **Interrupted runs resume.** Since you checkpoint every step anyway, resuming after a top-up is nearly free to implement and turns a paywall into an unblock.

---

## 10. Onboarding

### 10.1 One fork, not three personas

Do not ask users to self-classify by skill. The real question is orthogonal: **who pays for inference?** Hosted is the nudged default (full card, solid button); BYOK is a text link. Ollama lives in Settings.

### 10.2 Trial cap

500 credits, ~6 typical tasks, no card required, nothing auto-renews. Visible meter from the first run. Trials that expire on value delivered convert better than ones that expire on wall-clock time.

### 10.3 The permission moment

The first-run permission prompt is the highest-drop-off point in the funnel. The explainer screen runs **before** Chrome asks, and covers both per-site access and the debugger banner.

### 10.4 Survey

Two questions, tappable, **after** the first successful task, one dismiss path. Before value delivery it is pure conversion tax.

### 10.5 Key storage

`chrome.storage.local` is plaintext on disk. Either encrypt with Web Crypto (AES-GCM) under a passphrase-derived key, or use `chrome.storage.session` (memory-only). Pick one and state it in the privacy copy — the mockups say "encrypted with Web Crypto."

Always verify a key with a real one-token round trip before accepting it.

### 10.6 Ollama

Host permission for `http://localhost:11434/*`; user must set `OLLAMA_ORIGINS`; Chrome's Private Network Access checks will fire. **Gate behind a capability check** — a 7B model will fail at multi-step tool use, and without a check your support inbox fills with "the agent is stupid" reports that are really "the model is too small."

---

## 11. Settings

| Group | Contents |
|---|---|
| **Runs** | Full audit log, filterable, **viewable** (not replayable — replay belongs to tier-1 caching and the Tasks tab; do not promise run replay) |
| **Guardrails** | Default profile for new tasks |
| **Sites** | Granted origins with revoke. Mirrors `chrome.permissions`; must never drift from it |
| **Keys** | Per provider, add/rotate/delete, test connection. Never render a stored key back (`sk-··········4f2a`) |
| **Models** | Tier → model mapping from remote config, with override. Show credits per typical task beside each |
| **Your data** | View / export / delete page memory; per-site forget; delete all. **The screen that makes the privacy claim credible** |
| **Spending** | Credit balance, history, user-set hard cap. For BYOK, tokens and dollars |
| **Account** | Subscription, top-ups, cancellation, **full account deletion (GDPR, not optional)** |

Telemetry is **opt-in**. Also required: ToS, privacy policy, DPA link for business buyers, version and update channel.

---

## 12. Chrome Web Store Compliance

- **MV3 only.**
- **No remotely-hosted code.** Every line of JS ships in the package. No CDN scripts, no `eval`, no `new Function`. LLM output is *data* our bundled code interprets — keep it that way. Policy explicitly permits executing logic from remote sources through documented APIs like the Debugger and User Scripts APIs.
- **Fonts must be bundled.** `ui/mockups.html` loads IBM Plex from a CDN for preview only; production ships WOFF2 subsets. A font request on every panel open leaks to Google and contradicts the privacy posture.
- **Per-permission written justification** in the developer dashboard. `debugger` needs the strongest one — **write it before building**. If you can't justify it in two sentences, the scope is wrong.
- **Privacy policy URL** mandatory once user data is touched.
- **Data usage disclosure form must match actual behaviour.** Misrepresentation gets you removed, not merely rejected.
- **Single purpose** — the narrow vertical solves this; "general agent" does not.
- **Monotonically increasing versions**; no reuse or rollback.
- Expect **weeks** of manual review for `debugger` + broad host patterns. Plan release cadence accordingly and keep feature flags server-side.

---

## 13. Build Order

### Milestone 0 — Benchmark harness (week 1, before anything else)
20-task suite on target-vertical sites with token counting wired in. **Everything in §9 is modelled, not measured.** Real numbers will move the credit consumption figures and possibly the plan sizes.

Run it as an end-to-end spike on 3–5 candidate vertical sites: attach debugger → perceive → index → click → verify. This validates the two riskiest technical assumptions — perception quality and token consumption — in days rather than after the product is built. Also confirm here: the `cached_tokens` field exists, the caching mechanism behaves as §7.5 assumes, and reasoning effort is actually pinnable.

### Milestone 1 — Skeleton
WXT project, manifest, side panel, offscreen document, service worker as router, IndexedDB schema, **checkpoint-every-step from the start**. Import `ui/tokens.css`.

### Milestone 2 — Perceive & act
`chrome.debugger` wrapper, `getFullAXTree` → trim → index, `getBoxModel` → `dispatchMouseEvent`, content-script verification, wait-retry, dismiss-overlay routine.

### Milestone 3 — Tier 2 + Tier 5
Luna at tier 2, the ledger in the panel, kill switch, stuck handoff with `Show me`. **This is a shippable product.**

### Milestone 4 — Tasks tab & guardrails
Task library, compose, play/watch/warning/trash states, runtime permission requests, read-only action-layer blocking with per-site network hardening (§5.1), confirm gates in code, redaction, audit log, Your data screen.

### Milestone 5 — BYOK
Encrypted local key storage, direct-to-OpenAI calls, token and spend display, Ollama with capability check.

### Milestone 6 — Backend & credits
Cloudflare Worker, Supabase auth + usage ledger, `creditsFor()` metering, server-side caps and windowed rate limits, Paddle/Stripe, entitlement JWT, out-of-credits with resume.

### Milestone 7 — Scheduling & concurrency
`chrome.alarms`, missed-run detection, forced read-only for unattended runs, up to 3 concurrent with same-origin refusal.

### Milestone 8 — Tier 3, then Tier 1
Screenshot escalation once failure logs justify it. Replay cache once repeat flows are identified.

### Milestone 9 — Store submission
Permission justifications, privacy policy, data disclosure form, listing assets. Budget weeks.

---

## 14. Open Questions

1. **Which vertical ships first? — BLOCKS STORE SUBMISSION.** Still undecided. Criteria: boring, repetitive, stable DOM, no anti-automation stance, high frequency, miserable manual alternative. Candidates: expense report entry, procurement portals, insurance/government forms, internal admin dashboards, CRM hygiene. This determines the single-purpose statement, the `debugger` permission justification, and the Milestone 0 benchmark suite.

2. **Product name and icon.** Affects the action icon, which must read at 16px in monochrome — favour a single geometric form over a wordmark. `ui/mockups.html` uses "Product name" as a placeholder.

3. **Verify Luna's current cached-input rate.** The ~10%-of-input figure circulating dates from launch pricing, before the 80% input cut on 30 July 2026. §9.2 assumes $0.02/M.

4. **Panel attach: per-tab or per-window?** Per-tab matches "the agent works on this page"; per-window survives tab switching mid-run. Leaning per-window with the target tab named in the header.

5. **Confidential-compute inference** (Phala, Tinfoil, Azure Confidential AI Inferencing) converts "we promise not to look" into hardware-attested "we cannot look." Roadmap for the enterprise tier — design the provider interface so it can slot in. **Gemini project-level ZDR (§7.7) is a nearer and cheaper first step toward the same claim.**

6. **Verify the `usage` response shape.** The entire `creditsFor()` formula assumes `prompt_tokens_details.cached_tokens` exists on Luna's response. Confirm the field exists *and* the cached rate before the ledger is built on it. Q3 flags the rate; the field itself was unflagged until the feasibility review.

7. **Billing policy — product-owned, blocks Milestone 6.** Credit expiry (do unused credits roll over?), refunds, top-up + subscription stacking order of consumption, downgrade behaviour, dunning on failed renewal. None of these are engineering questions.

8. **Prompt-injection review.** §5.4 specifies structural separation, but no one has adversarially reviewed whether it is sufficient for a product holding `chrome.debugger` access to logged-in sessions. This is the highest-severity security item in the spec and it was not covered by the feasibility review. Schedule a dedicated pass before Milestone 4.

9. **Per-site strict read-only rollout.** §5.1's network-layer hardening is per-origin opt-in. Who decides a site is safe for it — the user, after a successful run, or a shipped allowlist we maintain? Erodes the mechanical guarantee either way; a product decision.

---

## Appendix — Sources of Truth

Everything in §7 and §9 is a snapshot with a shelf life of weeks. Before relying on any figure:

- OpenAI pricing and model docs — prices moved twice in the month before this was written
- Chrome Extensions MV3 documentation and Web Store program policies
- `ui/tokens.css` for all styling values
- **Your own benchmark harness output — this outranks all of the above**

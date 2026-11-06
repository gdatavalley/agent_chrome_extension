# PROJECT.md — for coding agents

An MV3 Chrome extension that runs an AI agent inside the user's own browser,
driving pages they're already logged into. Supervised autonomy: every action
is a numbered, timestamped ledger row; irreversible actions pause for
approval; every step is checkpointed so nothing is lost when Chrome kills
something. Two billing modes: hosted credits (proxied through our Worker)
and bring-your-own-key (browser → provider directly, we see nothing). A third
mode, `mock`, runs a scripted provider for development and E2E.

**Read first:** `Instructions/browser-agent-extension-spec.md` (v0.3.1) is
the design spec — architecture, guardrails, billing, build order. It is
authoritative **except where "Where the code departs from the spec" below
says otherwise**; those departures are deliberate, so don't "fix" the code
back to the spec. `Instructions/browser-agent-extension-ui-spec.md` +
`Instructions/ui/` (mockups, tokens.css) govern all UI. `PROGRESS.md` tracks
milestone status and every open item.

## Repo layout

```
entrypoints/            WXT entrypoints (one per surface)
  background.ts         service worker — THIN ROUTER, holds no state (spec §2.1).
                        Also BYOK key add/test/delete and the dev-only __devCommand hook
  offscreen/            offscreen document — hosts the agent loops, one per run (§2.2)
  sidepanel/            run viewer: ledger, kill switch, confirm gates (no idle state)
  tasks/                task library, launcher, compose/edit (full tab; action-icon target)
  options/              settings, 8 sections incl. Keys and per-run full ledger (full tab)
  onboarding/           6-step first-run flow incl. device-code hosted path
src/
  agent/                loop.ts (THE AGENT LOOP), cdp.ts (SW proxy client),
                        perceive.ts, act.ts, verify.ts, guardrails.ts, escalation.ts
  background/           run-controller.ts, scheduler.ts, offscreen.ts
  llm/                  router.ts (OpenAI + hosted providers), resolve.ts (llm.mode → provider),
                        entitlement.ts, prompts.ts, redact.ts, schemas.ts (zod), providers/mock.ts
  memory/               db.ts (Dexie: runs, steps, gates, tasks, pageMemory, audit,
                        keys, settings, meter), fingerprint.ts
  shared/               types.ts, messages.ts (the command contract), meter.ts, crypto.ts
  ui/                   tokens.css (verbatim copy — single source of truth),
                        shared.ts (liveQuery hooks, billing display, formatters)
backend/                SEPARATE PACKAGE — hono app (hosted tier, spec §8)
  src/                  app.ts (routes), auth.ts, store.ts (Store interface + MemoryStore),
                        meter.ts, ratelimit.ts, dev.ts (Node server), index.ts (Worker entry)
  schema.sql            Supabase schema incl. atomic debit() / top_up() — not applied anywhere yet
  wrangler.toml
tests/                  extension unit tests (vitest)
scripts/                run-e2e.mjs (E2E), serve.mjs (harness server + spike.html portal),
                        sw-console.mjs / ext-errors.mjs (debugging), run-spike.mjs (M0 spike)
docs/store/             CWS submission docs
Instructions/           the specs + feasibility review — read them
```

## Where the code departs from the spec

Deliberate. Keep them unless a decision changes them, and add to this table
when you make another one.

| Spec | Code |
|---|---|
| §6.2 file tree (`src/background/index.ts`, `src/offscreen/loop.ts`, `src/content/`, `llm/meter.ts`, `memory/store.ts`) | WXT layout above (§6.3). The loop is `src/agent/loop.ts`, hosted by `entrypoints/offscreen/main.ts`; entitlement is in `src/llm/`, the meter in `src/shared/`, Dexie in `memory/db.ts`. OpenAI and hosted providers live in `router.ts`; `providers/` holds only the mock. |
| §2.3 verification via content scripts | `Runtime.evaluate` probes through the same SW CDP proxy (`verify.ts`). There are no content scripts. |
| Two billing tiers (§8.1) | Three: `llm.mode` is `mock` \| `byok` \| `hosted`, default `mock`. The first verified key moves `mock` → `byok` and never overrides `hosted`. |
| §7.1 model pinned | `DEFAULT_MODEL` (`gpt-5.6-luna`) is a config default (§7.6). BYOK users can edit the model id and reasoning effort (`off` omits the parameter, for models that reject it). Hosted pins both server-side from `/config`. |
| Max steps 25 (UI spec Guardrails + Compose) | Default 50, editable in Guardrails; Compose inherits the saved profile. |
| One site per task; same-origin refusal (§3.4) | `Run.origins: string[]` — Compose takes "Start on" plus "Also allowed" origins; concurrency refuses on **any** origin overlap. |
| UI spec navigation | Additions: ⚙ in the Tasks header → Options, and "← Tasks" in Options, so Settings is reachable with no active run. The action icon focuses an open Tasks tab rather than opening another. |

## Not built yet: the customer side

The extension runs end to end; the server side only runs locally. Nothing
persists customers today.

- **Store.** `backend/src/store.ts` defines the `Store` interface — the seam
  for a Supabase adapter. Only `MemoryStore` implements it, and
  `backend/src/index.ts` constructs a `new MemoryStore()` **per request**, so
  the Worker entry is not deployable as-is: every request sees an empty
  database. `schema.sql` (users, device codes, balances, usage ledger,
  refresh tokens, `debit()`, `top_up()`) is written but unapplied.
- **Sign-in web app.** `/auth/device` returns `verify_url = …/verify?code=…`,
  but nothing serves `/verify`. The Supabase magic-link page that should call
  `/auth/device/confirm` doesn't exist; that endpoint currently accepts any
  email, and E2E skips it via the dev-only `/test/confirm`.
- **Trial abuse floor (§8.1b).** No email verification before credits, no
  per-IP signup limit. `ratelimit.ts` quotas are per-user and in-memory per
  isolate (approximate by design; the debit is the real limit).
- **Payments.** No Paddle/LemonSqueezy webhook; `Store.topUp()` is its
  target. Billing policy (§14 Q7) is undecided.
- **Ops (§8.2).** No Sentry, no PostHog. The Options telemetry toggle
  (`telemetry.optIn`) is stored but nothing reads it.

## Known gaps against the spec — decide, then fix or move to the table above

- **`mock` is also the production default.** `resolve.ts` isn't gated on
  `import.meta.env.DEV`, so a production install with no key and no sign-in
  runs `providers/mock.ts` and reports canned success.
- **Entitlement tokens are plain Dexie settings.** §8.1b says access token in
  memory only, refresh token encrypted via `shared/crypto.ts`; today both are
  unencrypted `entitlement.*` rows in `settings`.
- **`scripting` is requested but unused.** `docs/store/permission-justifications.md`
  justifies it with content-script verification that doesn't exist. Drop the
  permission or correct the justification before submission.
- Everything else (strict read-only §5.1, dismiss-overlay routine, Show-me
  picker, Ollama, Gemini verification, iframes, i18n) is tracked in `PROGRESS.md`.

## Architecture rules you must not break

1. **The agent loop lives in the offscreen document, never the service
   worker.** MV3 kills the SW at ~30s idle. The SW routes events only.
2. **Checkpoint every step to IndexedDB before the next one.** Dexie is the
   source of truth; the SW rehydrates from it after restarts.
3. **chrome.debugger is only callable from the SW.** The loop proxies every
   CDP call through it (`cdp:exec` message). Perception = CDP AX tree;
   verification = `Runtime.evaluate` probes over the same proxy; writes =
   trusted CDP input only.
4. **The model never emits selectors or coordinates** — it picks from a
   numbered menu (§2.4). Validate its output with zod before acting (§2.6).
5. **Guardrails live in code, never in the prompt.** Read-only blocks input
   primitives (§5.1); confirm gates pause the run for named-dangerous
   actions (§5.3). Never auto-approve anything.
6. **Never log or store prompt content / page text** (§8.4). Redact before
   prompt construction (§5.2). Password fields are excluded at perception.
7. **Credits are cost-weighted and metered from the real `usage` object**
   (§9.2); server-side debit is one atomic conditional UPDATE (§8.3).
8. **UI state flows through Dexie liveQuery, not messages.** Messages are
   commands only (`src/shared/messages.ts` is the contract).
9. **Prompt order is load-bearing for caching** (§7.5): system → task →
   history → current page state (always last).
10. **UI copy and styling follow the UI spec exactly** — tokens.css values,
    sentence case, no "successfully"/"please", the agent never says "I".

## Commands

```bash
npm run build            # production build → .output/chrome-mv3
npm run compile          # tsc --noEmit (must stay clean)
npm test                 # all 31 unit tests: tests/ + backend/src/*.test.ts (vitest)
node scripts/run-e2e.mjs all      # 8 scenarios on real Chrome (see below)
node scripts/run-e2e.mjs real     # live OpenAI run (needs .env key; spends on it)
node scripts/run-e2e.mjs hosted   # full backend flow (spawns local Worker)
node scripts/sw-console.mjs 30    # stream the SW console of a running dev browser
cd backend && npm install && npx vitest run   # backend unit tests on their own
cd backend && npm run dev                     # backend on :8787 (Node, MemoryStore)
```

## The E2E harness (how it works — read before touching it)

`run-e2e.mjs` spawns the harness server (`serve.mjs`, :8899, serves the fake
invoice portal + receives reports) and `npx wxt` (dev runner, opens a
managed Chrome with the extension). Commands reach the extension over CDP
(`--remote-debugging-port`, a free port per run): into the SW via
`globalThis.__devCommand`, or into any extension page via
`chrome.runtime.sendMessage` (which wakes the SW). Reports come from the
offscreen loop host (alive by definition when the loop does something).
Scenarios are scripted via task-title prefixes in `providers/mock.ts`
(`[stuck]`, `[gate]`, `[type]`, `[escalate]`).

- **It waits on readiness, not time:** CDP endpoint (150s), an extension
  target (60s), backend `/health` (90s, failing fast if the process exits).
  Fixed sleeps here have caused every flake so far.
- **It bypasses the UI.** Commands enter below the click handlers, and `real`
  / `hosted` set `mode` in the command. A green suite says nothing about UI
  wiring — the unused-BYOK-key and panel-never-opens bugs (`106fd7c`) both
  passed it.
- `replay` only passes after `default` in the same session (no persistent
  profile), so run it via `all`.

## Environment gotchas (hard-won, verified on Chrome 152 stable)

- **`--load-extension` is silently ignored**; CDP `Extensions.loadUnpacked`
  registers but never starts the MV3 SW. The WXT dev runner is the working
  load path — always drive it, don't launch Chrome yourself.
- **The extension installs after CDP is reachable** — wait for a
  `chrome-extension://` target before sending commands.
- **User-gesture APIs die at the first `await`, and the SW never has one.**
  `sidePanel.open()` is called from the Tasks click handler, not forwarded to
  the SW; `keys:test` checks `permissions.contains` rather than re-requesting.
- **`AXNode.backendDOMNodeId`**, not `backendNodeId`, for `DOM.getBoxModel`.
- **`chrome.tabs.query({url})` match patterns reject ports** — query
  broadly, compare `tab.url` manually. Same for permission patterns: strip
  ports (`permissionPattern()` in run-controller).
- **`runtime.sendMessage` from the SW never loops back to its own listener**
  — the harness calls `__devCommand` instead.
- **Dexie hooks fire inside the transaction** — defer async DB reads
  (setTimeout) or you get DexieError (see badge refresh).
- **Offscreen listeners race `createDocument`** — `sendToOffscreen` retries.
- **Reasoning models reject `max_tokens`; some reject `reasoning_effort`.**
  Key verification sends no `max_tokens`; effort `off` omits the parameter.
- **`hono/jwt` `verify` requires an explicit `alg`** ('HS256').
- **Vite inlines `WXT_*` env vars in production too** — the `.env` key
  bridge in `wxt.config.ts` is dev-gated for exactly this reason. Keep
  secrets out of prefixed variables.
- **Cold starts are slow here:** Chrome 8–41s, backend `npx tsx` up to ~18s.
- Background processes spawned via this repo's scripts die if their parent
  dies — the orchestrator owns its children deliberately.

## Keys & secrets

- `.env` (gitignored): `OPENAI_API_KEY=...` — dev-only BYOK/testing key,
  bridged into the dev bundle by `wxt.config.ts`. Never print it, never
  commit it, never let it into a production bundle.
- Backend secrets (production): `wrangler secret put OPENAI_API_KEY` and
  `JWT_SECRET`. Not needed locally — `backend/src/dev.ts` reads `.env`.

## Current state

Extension: milestones 1–8 built and E2E-verified on the local harness, with
the per-milestone open items in `PROGRESS.md` (the 🟡 rows). Backend: the
hosted flow works end to end against the in-memory store; the customer side
above is unbuilt. M9 prep done; submission is blocked on the vertical
(§14 Q1), name and icon (Q2), billing policy (Q7), accounts, and the
prompt-injection review (Q8).

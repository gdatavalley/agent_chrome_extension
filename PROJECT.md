# PROJECT.md — for coding agents

An MV3 Chrome extension that runs an AI agent inside the user's own browser,
driving pages they're already logged into. Supervised autonomy: every action
is a numbered, timestamped ledger row; irreversible actions pause for
approval; every step is checkpointed so nothing is lost when Chrome kills
something. Two billing modes: hosted credits (proxied through our Worker)
and bring-your-own-key (browser → provider directly, we see nothing).

**Read first:** `Instructions/browser-agent-extension-spec.md` (v0.3.1) is
the authoritative spec — architecture, guardrails, billing, build order.
`Instructions/browser-agent-extension-ui-spec.md` + `Instructions/ui/`
(mockups, tokens.css) govern all UI. `PROGRESS.md` tracks milestone status.

## Repo layout

```
entrypoints/            WXT entrypoints (one per surface)
  background.ts         service worker — THIN ROUTER, holds no state (spec §2.1)
  offscreen/            offscreen document — THE AGENT LOOP LIVES HERE (§2.2)
  sidepanel/            run viewer: ledger, kill switch, confirm gates
  tasks/                task library, launcher, compose (full tab)
  options/              settings, 8 sections (full tab)
  onboarding/           6-step first-run flow incl. device-code hosted path
src/
  agent/                cdp.ts (SW proxy client), perceive.ts, act.ts,
                        verify.ts, guardrails.ts, escalation.ts, loop.ts
  background/           run-controller.ts, scheduler.ts, offscreen.ts
  llm/                  router.ts, resolve.ts, entitlement.ts, prompts.ts,
                        redact.ts, schemas.ts (zod), providers/mock.ts
  memory/               db.ts (Dexie), fingerprint.ts
  shared/               types.ts, messages.ts, meter.ts, crypto.ts
  ui/                   tokens.css (verbatim copy — single source of truth)
backend/                SEPARATE PACKAGE — hono Worker (hosted tier, spec §8)
  src/                  app.ts, auth.ts, store.ts, meter.ts, ratelimit.ts,
                        dev.ts (local server), index.ts (Worker entry)
  schema.sql            Supabase schema incl. atomic debit() function
tests/                  extension unit tests (vitest)
scripts/                E2E harness (run-e2e.mjs, serve.mjs, spike.html)
docs/store/             CWS submission docs
Instructions/           the specs + feasibility review — read them
```

## Architecture rules you must not break

1. **The agent loop lives in the offscreen document, never the service
   worker.** MV3 kills the SW at ~30s idle. The SW routes events only.
2. **Checkpoint every step to IndexedDB before the next one.** Dexie is the
   source of truth; the SW rehydrates from it after restarts.
3. **chrome.debugger is only callable from the SW.** The loop proxies every
   CDP call through it (`cdp:exec` message). Perception = CDP AX tree;
   verification = cheap reads; writes = trusted CDP input only.
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
npm test                 # extension unit tests (vitest)
node scripts/run-e2e.mjs all      # 8 scenarios on real Chrome (see below)
node scripts/run-e2e.mjs real     # live OpenAI run (needs .env key)
node scripts/run-e2e.mjs hosted   # full backend flow (spawns local Worker)
cd backend && npm install && npx vitest run   # backend unit tests
cd backend && npm run dev                     # Worker on :8787
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

## Environment gotchas (hard-won, verified on Chrome 152 stable)

- **`--load-extension` is silently ignored**; CDP `Extensions.loadUnpacked`
  registers but never starts the MV3 SW. The WXT dev runner is the working
  load path — always drive it, don't launch Chrome yourself.
- **`AXNode.backendDOMNodeId`**, not `backendNodeId`, for `DOM.getBoxModel`.
- **`chrome.tabs.query({url})` match patterns reject ports** — query
  broadly, compare `tab.url` manually. Same for permission patterns: strip
  ports (`permissionPattern()` in run-controller).
- **`runtime.sendMessage` from the SW never loops back to its own listener**
  — the harness calls `__devCommand` instead.
- **Dexie hooks fire inside the transaction** — defer async DB reads
  (setTimeout) or you get DexieError (see badge refresh).
- **Offscreen listeners race `createDocument`** — `sendToOffscreen` retries.
- **`hono/jwt` `verify` requires an explicit `alg`** ('HS256').
- **Vite inlines `WXT_*` env vars in production too** — the `.env` key
  bridge in `wxt.config.ts` is dev-gated for exactly this reason. Keep
  secrets out of prefixed variables.
- Background processes spawned via this repo's scripts die if their parent
  dies — the orchestrator owns its children deliberately.

## Keys & secrets

- `.env` (gitignored): `OPENAI_API_KEY=...` — dev-only BYOK/testing key,
  bridged into the dev bundle by `wxt.config.ts`. Never print it, never
  commit it, never let it into a production bundle.
- Backend secrets (production): `wrangler secret put OPENAI_API_KEY` and
  `JWT_SECRET`. Not needed locally — `backend/src/dev.ts` reads `.env`.

## Current state

Milestones 0–8 built and E2E-verified; M9 prep done. Remaining: deployment,
payments (Paddle/LemonSqueezy webhook), vertical + name decisions, and the
open engineering items listed in `PROGRESS.md`. Details in commit history
(checkpoint pushes per milestone).

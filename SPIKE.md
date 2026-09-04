# Milestone 0 — Debugger Pipeline Spike

Validates the riskiest technical assumptions from spec §13 (Milestone 0)
before any product code: **attach → perceive → trim → index → click → verify**,
through `chrome.debugger` on real Chrome, with size and latency metrics.

## Run it

```
npm run spike
```

One command. It starts the report server if needed, launches the WXT dev
runner (which opens a managed browser with the extension), the extension's
service worker opens the target page (`scripts/spike.html`, a fake invoice
portal served on :8899), executes three steps, and posts a JSON report to
`spike-results.json`. Exit code 0 = all steps verified.

## What it proved (4 September 2026, Chrome 152.0.7977.76)

| Step | Picked | Verified | Step time |
|---|---|---|---|
| Dismiss cookie banner | ⟨button #1⟩ | banner removed | 27 ms |
| Apply filters | ⟨button #2⟩ | toast shown | 31 ms |
| Next page | ⟨button #5⟩ | page advanced | 16 ms |

- Debugger attach: ~2 ms. Whole 3-step task: ~77 ms excluding page loads.
- Perception: `Accessibility.getFullAXTree` 161–273 raw nodes per step,
  10–21 ms per call.
- Trimming works: 34 interactive elements serialize to ~1,000 chars
  (~250 tokens) vs ~6,400 chars (~1,600 tokens) for the naive full dump —
  a ~6x reduction on a simple page, directionally consistent with
  Stagehand's published 35.7k → 7.4k figure on heavier pages.
- `DOM.getBoxModel` → centre → `Input.dispatchMouseEvent` clicks landed
  first try, every step; the 800 ms wait-retry (spec §3.3) never fired.
- Post-action verification via `Runtime.evaluate` read checks worked.

## Hard-won environment findings (read before Milestone 1)

1. **Chrome 152 stable ignores `--load-extension`.** The flag is accepted
   silently; the extension never registers (verified in Secure Preferences).
2. **CDP `Extensions.loadUnpacked` is not a workaround.** It returns an
   extension ID and writes Secure Preferences, but the MV3 service worker
   never starts — `pending_on_installed_event_dispatch_info` stays set and
   `onInstalled` is never dispatched, even for a trivial two-file extension.
3. **What works: the framework's own runner.** `npx wxt` (dev) opens a
   managed browser in which the extension loads and the SW runs normally.
   `scripts/run-spike.mjs` orchestrates this.
4. **`AXNode.backendDOMNodeId`, not `backendNodeId`.** `DOM.getBoxModel`
   fails with -32000 otherwise.
5. **`chrome.tabs.query({url})` match patterns reject ports.** Query
   broadly and compare `tab.url` manually.

## Not yet validated (remaining Milestone 0 items)

- Real OpenAI round trip: `usage.prompt_tokens_details.cached_tokens` field
  shape, prompt-caching behaviour (spec §7.5 is marked "contested, verify"),
  and pinning reasoning effort. Needs an API key; the picker is currently a
  deterministic stand-in for the model.
- Runs against 3–5 candidate vertical sites (awaits the vertical decision,
  spec §14 Q1). The spike target is a local page by design: deterministic,
  no ToS surface, no auth.

## Files

- `entrypoints/background.ts` — the spike pipeline (throwaway; the real loop
  moves to an offscreen document in Milestone 1 per spec §2.2)
- `scripts/spike.html` — fake invoice portal target
- `scripts/serve.mjs` — static server + `/report` endpoint
- `scripts/run-spike.mjs` — orchestrator (`npm run spike`)
- `spike-results.json` — last report

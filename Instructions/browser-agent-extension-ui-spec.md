# Browser Agent Extension — UI Specification

**Version:** 0.3.1
**Date:** 4 September 2026
**Audience:** Coding agent implementing v1

**Companion documents:**

| File | Contents |
|---|---|
| `browser-agent-extension-spec.md` | Architecture, model, billing, guardrails, build order |
| `ui/mockups.html` | Every screen as static HTML in journey order. **Open this in a browser first.** |
| `ui/tokens.css` | All colour, type, spacing and component values. **Import it. Do not re-derive values from the mockups.** |

**Changes from v0.2 → v0.3 (post feasibility review):** Added the `paused: detached` panel state (§9.8) for when the user opens DevTools or dismisses the debugger banner mid-run. Added the mandatory free-tier Gemini warning to key entry (§6.2b). Seven Options sections given content inventories (§10.1). Rolling-average mechanism specified (§5.1). "Replayable" downgraded to "viewable".

**Changes from v0.3 → v0.3.1 (review follow-up):** Hosted onboarding step 3 specified — the device-code confirmation screen (§6.2c) with a mockup (`ui/mockups.html` 03b). EEA/CH/UK detection mechanism for the Gemini warning referenced (§6.2b). Mockup section cross-references corrected after the v0.3 renumbering (§9, §10, §10.1).

**Changes from v0.1:** The side panel lost its idle state and its launcher — it is now a run viewer only. Task management moved entirely to a dedicated Tasks tab with play / watch / warning / trash controls and up to three concurrent runs. Compose ends in *Save*, not *Run*. The meter is denominated in credits, not tasks. Two screens deleted (§12).

---

## 1. Design Position

### 1.1 What this interface is for

Not conversation. **Supervision.**

The agent completes roughly 30% of novel tasks unaided, and per-step reliability compounds badly. The interface exists so a person can watch an autonomous process, understand what it just did, and intervene at the right moment.

The reference vernacular is a **flight recorder / version-control log / audit trail**, not a chat product.

### 1.2 The concept: a ledger, not a conversation

Each agent action is a **numbered, timestamped, immutable row**. Chat bubbles are wrong here: they imply a peer exchange, they hide sequence, and they can't show which escalation tier handled a step.

Numbering is used because the content genuinely **is** a sequence. Do not add numbered markers anywhere else in the product.

### 1.3 Signature element

**The step gutter.** A continuous 1px vertical rule down the left of the ledger, thickening to 3px solid ink at the active step. It reads as tape running through a recorder. This is the one place the design is allowed to be memorable; everything around it stays quiet.

### 1.4 State language: inversion, not colour

| State | Treatment |
|---|---|
| Normal / running | Ink on paper |
| Needs attention | **Inverted** — paper text on solid ink |
| Irreversible | Inverted + `--alarm` rule + icon + the words "This can't be undone." |

Inversion is the primary state channel: unmistakable, genuinely monochrome, and it survives greyscale and colour blindness.

**`--alarm` is the only colour in the product.** It appears in exactly three places: the 2px rule inside a confirm gate, the `!` action badge, and destructive text buttons. It never carries meaning alone.

### 1.5 Explicit anti-patterns

Do not produce any of these — they are the tells that make a minimal monochrome interface read as templated:

- Acid-green or vermilion accent on near-black (the default "AI product" look)
- Tinted near-black (`#0B0B0B`, `#111`) standing in for black — this brief gets **true** `#000000`
- Tracked-out ALL-CAPS eyebrow labels
- `→` appended to button text
- Identical rounded cards with a soft grey shadow under each
- One border-radius on everything regardless of hierarchy
- Meta strings joined with middle dots (`A · B · C`) as a layout device
- Monospace used decoratively. It appears **only** where alignment is functional: step indices, timestamps, element refs, credit counts, token counts, domains.

---

## 2. Design Tokens

**All values live in `ui/tokens.css`.** This section explains the reasoning; that file is authoritative.

### 2.1 Colour

Seven values, six monochrome: `--ink` `--ink-60` `--ink-35` `--rule` `--wash` `--paper` `--alarm`.

Dark mode is **mandatory** — Chrome side panels follow the browser theme. The ramp inverts, with one deliberate exception: `--paper` becomes `#0A0A0A` rather than pure black, because a pure-black panel against Chrome's own dark chrome reads as edgeless and floating.

### 2.2 Typography

**IBM Plex Sans** for UI, **IBM Plex Mono** for data. Plex was designed for technical products and carries a slightly engineered character that suits an instrument panel; Inter is the reflexive default and reads as generic. The two faces are metrically related, so mono data columns align against sans labels without optical correction.

*Acceptable alternative pairing:* Geist Sans + Geist Mono.

> **MV3 constraint — do not miss this.** Both families must ship as bundled WOFF2 subsets. `ui/mockups.html` loads them from Google Fonts **for preview only**; a font request on every panel open leaks to Google and contradicts the product's positioning.

Scale: 11 / 13 / 15 / 18 / 22 / 28px. Base is 13px because the panel is narrow. **Never below 11px.** Two weights only — 400 and 500. Heavy weights against Chrome's own chrome look wrong.

Line length under 80 characters everywhere. On the options page this means capping the content column, not letting it fill the tab.

### 2.3 Shape

**Radius is hierarchical, not uniform:** 0 for ledger rows and single-sided borders, 4px for controls, 8px for cards and panels, 12px for onboarding pages.

**No shadows anywhere** except the focus ring. Depth comes from `--rule` hairlines and `--wash` fills.

### 2.4 Motion

One orchestrated moment: a new ledger row fades in over 120ms. No slide, no scale.

**The confirm gate is instant, with no transition.** Safety UI must not animate — a fading modal invites a click before it is readable.

Everything else: no transitions except `background-color` on hover at 80ms. `prefers-reduced-motion: reduce` disables the row fade entirely.

---

## 3. Surfaces

**The most consequential practical fact in this document:** the side panel is phone-width.

| Surface | Width | Layout |
|---|---|---|
| Side panel | Design 360px · works at 320 · doesn't break at 560 | Single column |
| Tasks tab | Full tab | 2-column card grid |
| Options tab | Full tab | Nav 152px + content capped 720px |
| Onboarding | Full tab | Centred column, 560px |

Every run-time screen is a single narrow column — no side-by-side layouts, no tables wider than two columns, no horizontal scrolling.

**Vertical budget:** the `chrome.debugger` banner occupies ~40px at the top of the viewport whenever the agent is attached. It is not our UI and cannot be hidden. Never place our own persistent banner directly beneath it — two stacked banners read as broken.

### 3.1 The surface rule

Each surface answers exactly one question. **No screen appears on two surfaces.**

| Surface | Question it answers |
|---|---|
| **Tasks tab** | What do I own, and what's happening right now? |
| **Side panel** | One run, up close |
| **Options tab** | How is this configured? |

This rule is what killed the panel launcher in v0.1 (see §12). If a new screen seems to belong on two surfaces, it means one of them is wrong.

---

## 4. Chrome Surfaces Used

| Surface | Used? | Purpose |
|---|---|---|
| **Side panel** | ✅ | Run viewer only |
| **Options page** | ✅ | Settings |
| **Action icon + badge** | ✅ | Click opens the **Tasks tab**; badge shows run state |
| **Commands** | ✅ | Global kill-switch shortcut |
| **Notifications** | ✅ | Run complete / needs attention / schedule missed |
| **Tooltip** | ✅ | Via `action.default_title` |
| **Context menu** | Optional | "Run a task on this page" |
| **Popup** | ❌ | Closes on click-away — fatal for a process you must watch |
| **Omnibox / override pages / DevTools panel** | ❌ | |

### 4.1 The action icon opens the Tasks tab

Set `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false })` and handle `action.onClicked` by opening the Tasks tab.

**The panel has no idle state.** It opens when a run starts, or when the user clicks a watch or warning control on a task card. You don't open a viewer with nothing to view.

### 4.2 Action badge

| Run state | Badge | Background |
|---|---|---|
| Idle | `""` | — |
| Running | count of active runs | `--ink` |
| Needs confirmation | `!` | `--alarm` |
| Stuck / missed schedule | `?` | `--ink` |

The `!` state is the only place `--alarm` appears outside a confirm gate or destructive button, and it earns it: an agent waiting on a decision must be visible from anywhere in the browser.

### 4.3 Kill switch command

`Ctrl/Cmd + Shift + .` halts **all** active runs. Must work whether or not the panel is open or focused. This is a safety control, not a convenience.

---

## 5. The Meter

Denominated in **credits**, never tokens, never tasks, never a percentage ring.

**The label always carries a plain-language estimate derived from that user's own rolling average consumption.** Credits alone are opaque; the estimate makes them legible and self-corrects as the user's real task mix emerges.

| Tier | Bar? | Label |
|---|---|---|
| Trial | Yes | `412 of 500 trial credits` / `about 5 more tasks like yours` |
| Credits, healthy | Yes | `4,120 of 7,000 credits` / `about 62 more tasks like yours` |
| Credits, >85% used | Yes | `840 of 7,000 credits` / `running low — top up or upgrade` |
| BYOK | **No** | `318K tokens · $1.84 this month` / `your key` |

**BYOK gets no bar.** There is no cap, so drawing one would invent a limit that doesn't exist. It gets a running total instead — different component, not the same one with different text.

### 5.1 The rolling-average mechanism

`about N more tasks like yours` is computed locally, never server-side.

- Store an exponentially-weighted moving average of credits-per-**completed** run in IndexedDB, alongside page memory
- Window: last 20 completed runs, α ≈ 0.2 so recent runs dominate without whiplash
- Exclude stopped and paused runs — they under-report and would flatter the estimate
- **Before 3 completed runs**, fall back to the §9.3 typical-task figure (46 credits) and soften the wording to `roughly N tasks`
- Never round to a false precision: show `about 60`, not `about 62`

**Never recolour the bar** at the low threshold. Add a second label line. That's what `--alarm` is reserved from.

Live credit consumption also appears per running task card and in the panel footer during a run, so cost is attributable rather than arriving as one opaque monthly total.

---

## 6. Onboarding

Full tab, opened on `chrome.runtime.onInstalled`. Six steps, progress as a plain `2 of 6` in mono. No dot indicators, no progress bar.

See `ui/mockups.html` sections 01–06.

| # | Screen | Notes |
|---|---|---|
| 1 | Welcome | No hero image. The third sentence — "stops before anything it can't undo" — is the hero. |
| 2 | Provider choice | **Hosted is nudged:** full card, solid button. BYOK is a text link. Both statements must stay literally true. |
| 3 | Key entry *(BYOK)* or **device code** *(hosted)* | BYOK: `Test` does a real one-token round trip; never accept an unverified key. Hosted: device-code confirmation (§6.2c). |
| 4 | **Permission explainer** | Runs *before* Chrome's dialog. Covers per-site access and the debugger banner. |
| 5 | First site grant | Offer the current tab as a radio — removes typing for most users. |
| 6 | Handoff | Opens the **Tasks tab**. Advises starting with something read-only. |

### 6.1 Why step 4 matters most

Chrome's permission dialogue is frightening and unexplained, and this is the highest-drop-off point in the funnel. Render a **facsimile** of the debugger banner, not a screenshot — screenshots go stale across Chrome versions.

The copy commits to something worth keeping: *"we can't hide it, and you shouldn't want us to."* That framing turns a liability into a trust signal.

### 6.2 Ollama

If selected in step 3, show setup inline: the `OLLAMA_ORIGINS` value, and a capability check. **If the detected model is under ~30B, warn plainly** — "This model will likely fail at multi-step tasks." Inform, don't block.

### 6.2b Free-tier Gemini keys — mandatory warning

On free AI Studio, Google uses submitted content to improve its products including for machine-learning purposes, and human reviewers may annotate inputs and outputs. A user pasting a free key silently breaks the promise made two screens earlier.

Tier is not detectable from the key string, so when **Gemini** is selected in step 3, add a required checkbox below the key field:

```
  [ ] This is a billing-enabled Google Cloud project

  ┌──────────────────────────────────────────────┐
  │  Free Gemini keys aren't private             │
  │                                              │
  │  On Google's free tier, page content the     │
  │  agent reads may be used to train Google's   │
  │  models, and reviewers may read it. Use a    │
  │  billing-enabled project.                    │
  └──────────────────────────────────────────────┘
```

- The `Continue` button stays enabled (§11 — avoid disabled buttons); if unchecked, activating it re-surfaces the warning and asks for confirmation
- **Suppress entirely for users in the EEA, Switzerland and the UK**, who receive paid-tier terms across all services including unpaid quota. Detection is client-side (timezone + locale, fail-safe toward showing) — the mechanism is specified in general spec §7.7.
- Warning styling is the standard `.alert` (single-sided ink rule), **not** an inverted gate — this is informational, not a blocked irreversible action

### 6.2c Hosted sign-in — the device-code screen

Choosing hosted in step 2 starts the device-code flow (general spec §8.1b). Step 3 for that path is a confirmation screen, not a form:

- The extension has already called `POST /auth/device` and opened `verify_url` in a normal tab. Say so plainly: "A tab just opened — sign in there and enter this code."
- The `user_code` is the hero: mono, 22px, letter-spaced, grouped as it will be typed (`WDJB-7QK4`). It must be selectable for copy.
- A waiting state in mono meta: `Waiting for confirmation…` while polling. No spinner theatrics; the code staying on screen *is* the state.
- A ghost `Open the tab again` for the user who closed it, and a ghost `Get a new code` that appears once the code nears expiry (`expires_in` from the flow).
- On success, advance to step 4 without a button press — the poll resolving is the confirmation. On expiry, say the code expired and offer `Get a new code` in its place.
- Copy never says "successfully" and never celebrates — sign-in is a toll booth, not a feature.

See `ui/mockups.html` section 03b.

### 6.3 Survey — deferred

Fires **after the first successful task**, in the panel, one dismiss path. Two questions, both tappable, no free text. Never before value has been delivered.

---

## 7. Tasks Tab

The task library, the launcher, and the live status of every run. See `ui/mockups.html` sections 07–11.

### 7.1 Card anatomy

Title, then a foot row with metadata on the left and controls on the right.

**The card border carries run state:**

| State | Border | Controls |
|---|---|---|
| Idle | 1px `--rule` | trash, play |
| Running | 1px `--ink-60` | watch (activity icon) |
| Needs approval | 2px `--ink` | inverted warning square + `Action awaiting your approval` label |

Metadata shows `last run · schedule` when idle, and `step N of M · C credits` when running.

### 7.2 The trash control

**Hidden while a task is running — never disabled.** A disabled control invites a click that does nothing. Stop the run first, then delete.

Deletion asks for confirmation and states what goes with it: the task, its schedule, and its cached page memory.

### 7.3 The add card

Dashed 1px `--ink-35` border, centred plus glyph, `New task`. Opens Compose.

### 7.4 Concurrency states

Up to **3** concurrent runs, and never two on the same origin (general spec §3.4). When the cap is reached, play controls on idle cards become inert with a one-line explanation rather than silently doing nothing.

### 7.5 Missed schedules

A task whose scheduled run didn't fire shows an inverted `Didn't run` pill and the reason in its metadata: `Fridays 17:00 · Chrome closed`.

This is mandatory. `chrome.alarms` only fires while Chrome is open, so misses **will** happen, and a silently missed schedule is worse than no schedule. Stating the cause matters because "Chrome was closed" is user-fixable — otherwise they conclude the product is broken.

### 7.6 Empty state

Invites rather than apologises: *"Start with something you'd otherwise do by hand twice a week. Reading and summarising is a safer first try than submitting."* Never "Nothing here yet."

---

## 8. Compose

**The only free-text input in the product.** See `ui/mockups.html` section 08.

Textarea, then setting rows for Site, Read only, Max steps, Run automatically. Primary button is **`Save`**, which returns to Tasks. Running starts from the grid.

### 8.1 Why Save and not Run

v0.1 had `Run now` here, which meant the side panel appeared unannounced while the user was still looking at the tab they'd clicked in. Save returns them to Tasks, where the play control makes starting an explicit, located action.

### 8.2 Read-only default

**Defaults on** (general spec §5.1). The mockup shows it off because that example task writes files.

Compose should detect a description implying writes ("submit", "send", "pay", "rename", "download") and surface a hint that the task probably needs write access — but **never flip the default silently.**

### 8.3 Schedule block

When `Run automatically` is on, reveal day and time, plus a `--wash` honesty block stating: scheduled tasks only run while Chrome is open; a missed run is marked and waits; scheduled runs stay read-only because nobody can answer a confirm gate.

---

## 9. Side Panel

**A run viewer. Nothing else.** Header is **always the current task name**, never the product name. See `ui/mockups.html` sections 12–20.

### 9.0 Persistent chrome

```
┌─ 360px ────────────────────────────┐
│  Task name                    ⚙    │  44px header, 1px bottom rule
├────────────────────────────────────┤
│  … state-specific body …           │
├────────────────────────────────────┤
│  [ ███  Stop  ███ ]  step 4 · 18cr │  during a run
└────────────────────────────────────┘
```

The stop button is the only element permitted solid `--ink` fill during a run. Nothing competes with it, and it is **always visible without scrolling**.

### 9.1 Planning

`Reading the page…`, the element count found, and — critically — **the guardrails in force**, in mono: `expenses.acme-corp.com / read only · max 25 steps / no new tabs`.

This is the cheapest trust-building in the product and it catches misconfiguration before it costs credits.

### 9.2 Running — the ledger (hero screen)

Build this first. It's where the design either works or doesn't.

| Part | Face | Colour |
|---|---|---|
| Gutter | 1px | `--rule` |
| Active gutter | 3px | `--ink` |
| Step index, timestamp, tier dots | mono 11px | `--ink-35` |
| Verb (`Clicked`) | sans 13px / 500 | `--ink` |
| Target (`Invoices`) | sans 13px / 400 | `--ink` |
| Element ref `⟨button #12⟩` | mono 11px | `--ink-60` |
| Failure note | sans 11px | `--ink-60` |

**Tier dots** make the escalation ladder visible: `·` accessibility tree only, `··` tree plus screenshot, `···` screenshot only. One glyph, and it's how a user builds intuition about why some tasks cost more credits.

Rows have **no background, no border, no radius**. Dense lists get rules, not cards.

**Failures are first-class rows**, not hidden. A `Retried after wait / table didn't load` row is information, not an embarrassment.

Auto-scroll to newest unless the user has scrolled up — then show `↓ 3 new steps` rather than yanking their viewport. The container is `aria-live="polite"` with each step an `<li>`.

### 9.3 Confirm gate

1. **Inline in the ledger, never a floating overlay.** The audit trail stays continuous, and `position: fixed` in 360px is claustrophobic.
2. `role="alertdialog"`, focus moves in and is trapped until resolved.
3. **Names the literal element** it will activate, in mono, so the user can verify it isn't about to hit something adjacent.
4. `--alarm` as a 2px rule **plus** the words "This can't be undone." Never colour alone.
5. Buttons name the outcome: `Replace them` / `Stop here`. Not `OK` / `Cancel`.
6. **No timeout, no default action.** An unanswered gate blocks forever; notify via `chrome.notifications` and the `!` badge.
7. **Enforced in application code**, never in the prompt.

Gates aren't only about money — the mockup uses file overwriting deliberately, to establish that pattern.

### 9.4 Stuck — tier 5 handoff

`Stopped after N steps`, then `What I tried` (as a rule-bordered list) and `What would help`. Actions: `Show me` / `Rephrase` / `Done`.

**`Show me` is the mechanism worth getting right.** It puts the page into pick-an-element mode; the user clicks the real element, the agent resolves it, caches it against the page's structural fingerprint, and resumes. The worst moment in the product becomes the thing that makes it better — and it feeds the tier-1 replay cache.

Never apologise. State what happened and what would help.

### 9.5 Out of credits

Leads with **"Nothing was lost — it resumes from there once you top up."** Since every step is checkpointed to IndexedDB anyway, resuming is nearly free to implement, and it's the difference between a paywall and a hostage situation.

Then: the exhausted meter, `Top up — 3,000 for $5`, `Upgrade to Pro`, and a link to BYOK as the free alternative.

### 9.6 Complete

`14 steps · 2m 08s · 46 credits` in mono, an outcome sentence, files produced, then `Save as a task` and `View full log`. The footer meter reflects the new balance — the user sees the cost in the unit they bought, at the moment they got value.

### 9.7 Blocked

Names the origin needing permission, notes it's revocable, offers `Grant access`, and **lists what's already granted** — which turns a scary permission moment into a routine one.

Can fire as early as the first run attempt if a task points at an ungranted site, so it isn't strictly late in the journey.

---

### 9.8 Paused — detached

Fires on `chrome.debugger.onDetach`. The likeliest trigger is **not** banner dismissal — it's the user opening DevTools on the agent's tab, which Chrome treats as a competing debugger client.

```
│  ▏ 08  09:14:44          ·         │
│  ▏     Clicked  Next page          │
│                                    │
│  Paused                            │
│                                    │
│  DevTools took over this tab, so   │
│  the agent lost control. Nothing   │
│  was lost — it can pick up from    │
│  step 8.                           │
│                                    │
│  [ Resume ]        [ Stop ]        │
```

Requirements:

- **Not an error.** No red, no "Error:", no apology. It's a resumable pause, and the phrasing must say so in the first line the user reads.
- **Name the actual cause**, mapped from the `reason`: DevTools took over / you dismissed the debugging bar / the tab was closed. A generic "connection lost" makes people assume the product is broken.
- Uses the standard `.alert` treatment, **not** an inverted gate — nothing irreversible is pending.
- If the tab was closed (`target_closed`), `Resume` reopens the target URL first and re-perceives before continuing; the cached fingerprint may still hit.
- Fires a `chrome.notifications` message and sets the action badge to `?`, since the panel may not be open.

## 10. Options Tab

Nav 152px + content capped 720px. Eight sections mapping 1:1 to general spec §11. See `ui/mockups.html` section 21.

**`Your data` is the flagship screen** and gets real design attention: per-site page counts, per-site delete, full export, delete-all, and an explicit statement of what is never stored. A vague privacy page is worse than none.

### 10.1 Content inventory for the seven unmocked sections

Only `Your data` has a mockup (`ui/mockups.html` §21). The rest follow the same pattern — heading, one line of prose, `.setting-row` list, actions at the bottom — so they need inventories rather than full mockups.

| Section | Contents | Notes |
|---|---|---|
| **Runs** | Table: task, date, steps, credits, outcome. Filter by task and outcome. Row opens the full ledger. | **Viewable, not replayable.** Re-running a task lives in the Tasks tab. |
| **Guardrails** | Default profile for new tasks: read only (on), max steps (25), new tabs (off), off-origin (off), iframes (on), max credits per run. | Same `.setting-row` controls as Compose, so it reads as the same thing. |
| **Sites** | Granted origins, each with revoke and a "strict read-only" toggle (spec §5.1). | **Must mirror `chrome.permissions` live** — re-read on focus. A stale list here is a broken trust claim. |
| **Keys** | Per provider: add, rotate, delete, test connection, last-verified timestamp. | Never render a stored key back — `sk-··········4f2a`. Gemini rows carry the §6.2b warning state. |
| **Models** | Tier → model mapping from remote config, with per-tier override. Credits per typical task beside each. | Read-only display when remote config is authoritative; override is advanced. |
| **Spending** | Credit balance, consumption history by task, user-set hard cap, top-up and plan buttons. BYOK variant shows tokens and dollars, no cap. | The only screen where currency appears for credits users. |
| **Account** | Email, plan, renewal date, top-ups, cancel, **delete account** (GDPR). | Delete account states what goes: runs, page memory, keys, credits. Credits are forfeit — say so before the confirm. |

Telemetry lives at the foot of **Your data** as a single unchecked box with an honest description of what would be sent.

---

## 11. Components

All classes are in `ui/tokens.css`.

**Buttons** — three variants: `--solid` (one per view, maximum), `--outline`, `--ghost`, plus `--danger` for destructive text actions. 32px tall, 4px radius, 13px/500. Verb-first labels, sentence case, no terminal punctuation, no arrow glyphs. Avoid disabled buttons — keep them enabled and explain on use.

**Inputs** — 36px, 1px `--rule`, focus ring 2px `--ink` at 2px offset. Placeholders are real examples, never restatements of the label.

**Toggle** — 26×15px. **Always paired with a text label stating the current state** (`New tabs — off`), because a monochrome toggle alone is ambiguous.

**Pill** — inverted, for lower-urgency attention (`Didn't run`, `Action awaiting your approval`).

**Alert** — single-sided 2px `--ink` left border, radius 0, `--wash` fill. For dismissible in-context notices.

---

## 12. Deleted Screens — Do Not Build

| Screen | Superseded by | Why |
|---|---|---|
| **Panel launcher** (task list in the side panel) | Tasks tab | Redundant once the grid gained play, watch, warning and trash controls. It also duplicated the "Your tasks" title, which actively suggested the two screens were the same thing. |
| **Panel idle with inline task input** | Compose | Created a second free-text input competing with the Tasks tab. There is now exactly one input in the product. |

Consequences already reflected above: the panel has no idle state, its header is always the task name, and the action icon opens the Tasks tab.

---

## 13. Accessibility

Non-negotiable, per Chrome's extension accessibility guidance:

- **State is never conveyed by colour alone.** Enforced structurally: inversion + text label + icon on every attention state. The single colour in the palette always appears alongside words.
- **Visible keyboard focus:** 2px `--ink` outline at 2px offset on every interactive element. Never `outline: none`.
- **Full keyboard path** through onboarding, task creation, launching, and confirm gates. The kill switch has a global shortcut.
- **Confirm gates** are `role="alertdialog"` with focus trap and focus return on resolve.
- **The ledger** is `aria-live="polite"`; each step is a list item with a text summary that doesn't depend on the gutter graphic.
- **Contrast:** `--ink` on `--paper` is 21:1. `--ink-60` is 5.7:1 (AA for body). `--ink-35` is metadata only and must never carry information unavailable elsewhere.
- **`prefers-reduced-motion`** disables the ledger fade.
- Minimum 11px type. Test the panel at 320px and at 200% browser zoom.
- All strings through `chrome.i18n` from the start — retrofitting is expensive.

---

## 14. Copy Rules

- Sentence case everywhere. No Title Case, no ALL CAPS.
- Contractions: "can't", "didn't", "you'll".
- Active voice, verb first. "Delete remembered pages", not "Page deletion".
- Banned: "successfully", "please", "simply", "just", "easy", "seamless". No exclamation marks in system copy.
- Errors state what happened and what to do, in one sentence, no "Error:" prefix, no first person: *"The table didn't load. Retried twice."*
- Empty states invite; they don't apologise.
- **The agent's UI never says "I".** It reports actions — `Clicked Invoices`, not `I clicked Invoices`. This is a ledger, and ledgers don't have a voice. (Exception: the stuck screen's `What I tried`, where first person is the honest framing for a failure report.)
- An action keeps its name through the whole flow: the button reading `Approve` produces a log row reading `Approved`.

---

## 15. Build Order

Maps onto general spec §13.

| Order | Deliverable | Depends on |
|---|---|---|
| 1 | Import `tokens.css`, bundle fonts, verify dark mode | — |
| 2 | Panel shell: header, footer, kill switch, badge sync | Milestone 1 |
| 3 | **Running state: the ledger + tier dots** | Milestone 2 |
| 4 | Stuck state + `Show me` element picker | Milestone 3 |
| 5 | Tasks tab: card states, play/watch/trash, add card | Milestone 4 |
| 6 | Compose + schedule block | Milestone 4 |
| 7 | Confirm gate | Milestone 4 |
| 8 | Onboarding 1–6 | Milestone 4 |
| 9 | Options: Your data, Sites, Guardrails | Milestone 4 |
| 10 | Keys, Models, Spending, meter variants | Milestones 5–6 |
| 11 | Out of credits + resume | Milestone 6 |
| 12 | Concurrency states, missed-schedule pill | Milestone 7 |
| 13 | Complete state, survey | Milestone 8 |

**Build the running state before anything else visual.** It's the hero screen and everything else is arranged around it.

---

## 16. Open Questions

1. **Product name and icon.** Gates the action icon (must read at 16px in monochrome — favour a single geometric form over a wordmark) and the store listing. `ui/mockups.html` uses "Product name" as a placeholder.
2. **Light/dark override in settings, or follow the browser only?** Following the browser is correct for most users; an override is cheap. Defer.
3. **Are tier dots visible by default,** or behind a "show detail" toggle? They build valuable intuition about credit consumption but add noise for a non-technical procurement clerk. Test with real users.
4. **Panel per-tab or per-window?** Per-tab matches "the agent works on this page"; per-window survives tab switching mid-run. Leaning per-window with the target tab named in the header. Interacts with concurrency — with 3 runs across 3 tabs, per-window means one panel switching between runs.

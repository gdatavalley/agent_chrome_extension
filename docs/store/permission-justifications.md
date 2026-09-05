# Chrome Web Store — Permission Justifications

Draft per spec §12 ("write it before building"). These go in the developer
dashboard's per-permission justification fields. Each is two sentences, in
the plain register the reviewers respond to. **Update the vertical reference
once §14 Q1 is decided** — the single-purpose statement and this document
share the same noun.

## debugger (the strong one — reviewers scrutinise this hardest)

The extension's core function is performing multi-step tasks on websites the
user already uses — filling forms, navigating records, downloading documents.
The Debugger API is the only Chrome API that produces trusted input events
(clicks and keystrokes that sites accept as real user actions); synthetic
JavaScript events are ignored by the frameworks real business sites use.
The debugger attaches only to tabs the user has explicitly started a task on,
only after the user granted that site permission, and detaches the moment the
task ends, is paused, or is stopped — the run ledger shown in the side panel
makes every action visible to the user as it happens.

## sidePanel

The side panel is the run viewer: it shows the live step ledger, the stop
control, and the approval prompts a user must answer while a task runs.
These are ongoing processes the user supervises, which is exactly the surface
the side panel exists for.

## storage

Task definitions, run checkpoints, and settings are stored locally so runs
survive browser restarts and resume where they stopped.

## unlimitedStorage

Page-structure memory and the complete run audit log exceed the 10MB
`storage.local` quota over time. All data stays on the user's machine and is
viewable, exportable, and deletable in Settings → Your data.

## tabs

Each run operates in its own tab. The extension opens a tab when a task
starts, and the kill switch / stop control closes or releases it when the
user stops a run.

## scripting

Read-only page-state checks (did the table load, did the toast appear) are
injected on demand into tabs that already have an active run. There are no
static content scripts and nothing is injected without an active task and a
granted site.

## offscreen

Manifest V3 terminates idle service workers, which would kill long-running
tasks mid-flight. The offscreen document hosts the task loops; every step is
checkpointed to local storage so a paused or interrupted run resumes rather
than restarts.

## alarms

Users can schedule tasks (e.g. "Mondays 09:00"). Alarms fire the schedule,
and missed schedules (browser closed) are detected and shown to the user
with the reason.

## notifications

Notifies the user when a run completes, when it pauses waiting for an
approval decision, and when a scheduled run was missed because Chrome was
closed. No marketing use.

## optional_host_permissions (`https://*/*`, `http://localhost/*`)

The extension never requests broad site access at install. Site access is
granted one origin at a time, at runtime, when the user points a task at a
site — and can be revoked per-site in Settings. `http://localhost/*` covers
self-hosted model endpoints (Ollama) that privacy-sensitive users run
locally.

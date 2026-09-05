// Run controller (spec §6.2 background/run-controller.ts). Owns the run
// registry, tab + debugger attach, concurrency bounds (§3.4), badge sync,
// gate detach timers, and onDetach → paused:detached mapping (§3.5).
// Holds no durable state — runs live in Dexie; this is orchestration only.
import { db } from '../memory/db';
import { ensureOffscreen } from './offscreen';
import { isPaused, isTerminal, type DetachReason, type Run, type Task } from '../shared/types';

const MAX_CONCURRENT = 3; // §3.4 hard cap
const GATE_DETACH_ALARM = 'gate-detach:'; // §3.4: detach after 3 min on a gate

const attachedRuns = new Map<number, string>(); // tabId → runId (ephemeral)

// Chrome match patterns don't support ports — strip them for permission ops.
export function permissionPattern(siteOrOrigin: string): string {
  const u = new URL(siteOrOrigin);
  return `${u.protocol}//${u.hostname}/*`;
}

// The offscreen document's listener takes a beat to register after
// createDocument resolves — retry instead of racing it.
export async function sendToOffscreen(msg: Record<string, unknown>, attempts = 6): Promise<void> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      await chrome.runtime.sendMessage(msg);
      return;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function startRun(taskId: string): Promise<{ runId?: string; error?: string }> {
  const task = await db.tasks.get(taskId);
  if (!task) return { error: 'Task not found' };

  const active = (await db.runs.toArray()).filter((r) => !isTerminal(r.state) && r.state !== 'queued');
  if (active.length >= MAX_CONCURRENT) {
    return { error: `Already ${MAX_CONCURRENT} runs in progress — wait for one to finish.` };
  }
  const taskOrigin = new URL(task.site).origin;
  if (active.some((r) => r.origins.some((o) => o === taskOrigin))) {
    return { error: 'A run is already active on this site — one per site at a time.' };
  }

  // Runtime per-site grants (§6.1): no grant → the run parks as blocked and
  // the panel's Blocked screen (UI §9.7) offers Grant access. Chrome match
  // patterns reject ports, so permission checks use the host-only pattern.
  const hasAccess = await chrome.permissions.contains({ origins: [permissionPattern(task.site)] });

  const run: Run = {
    id: crypto.randomUUID(),
    taskId,
    taskTitle: task.title,
    state: 'queued',
    origins: [taskOrigin],
    readOnly: task.readOnly,
    maxSteps: task.maxSteps,
    stepCount: 0,
    creditsUsed: 0,
    tier: 2,
    scheduled: false,
    startedAt: Date.now(),
    ...(hasAccess ? {} : { error: `no-access:${taskOrigin}/*` }),
  };
  await db.runs.put(run);
  await db.tasks.update(taskId, { missedReason: undefined });
  await db.audit.add({ ts: Date.now(), runId: run.id, taskId, type: 'run:start', summary: task.title });

  if (!hasAccess) {
    await refreshBadge();
    return { runId: run.id }; // parked; resume happens via the Blocked screen
  }

  const tab = await chrome.tabs.create({ url: task.site, active: true });
  if (tab.id == null) return { error: 'Could not open a tab for the run' };
  run.tabId = tab.id;
  await db.runs.update(run.id, { tabId: tab.id });

  await attachDebugger(tab.id, run.id);
  await ensureOffscreen();
  await sendToOffscreen({ type: 'loop:start', runId: run.id });
  await refreshBadge();
  return { runId: run.id };
}

export async function stopRun(runId: string): Promise<void> {
  await chrome.runtime.sendMessage({ type: 'run:abort', runId }).catch(() => {});
  // The loop writes stopped:user itself; if it isn't live, write it here.
  const run = await db.runs.get(runId);
  if (run && !isTerminal(run.state)) {
    await db.runs.update(runId, { state: 'stopped:user', endedAt: Date.now() });
    await detachForRun(runId);
  }
  await refreshBadge();
}

export async function stopAllRuns(): Promise<void> {
  const active = (await db.runs.toArray()).filter((r) => !isTerminal(r.state));
  await Promise.all(active.map((r) => stopRun(r.id)));
}

export async function resumeRun(runId: string): Promise<{ error?: string }> {
  const run = await db.runs.get(runId);
  if (!run) return { error: 'Nothing to resume' };

  // Blocked runs (UI §9.7): parked as queued + no-access error. The Blocked
  // screen's Grant access resolves the permission, then resumes — now we can
  // actually open the tab and start the loop.
  if (run.error?.startsWith('no-access:')) {
    const task = await db.tasks.get(run.taskId);
    if (!task) return { error: 'Task not found' };
    const granted = await chrome.permissions.contains({ origins: [permissionPattern(task.site)] });
    if (!granted) return { error: 'Access not granted yet' };
    const tab = await chrome.tabs.create({ url: task.site, active: true });
    if (tab.id == null) return { error: 'Could not open a tab for the run' };
    await db.runs.update(runId, { tabId: tab.id, error: undefined, state: 'queued' });
    await attachDebugger(tab.id, runId);
    await ensureOffscreen();
    await sendToOffscreen({ type: 'loop:start', runId });
    await refreshBadge();
    return {};
  }

  if (!isPaused(run.state)) return { error: 'Nothing to resume' };

  if (run.state === 'paused:gate') return { error: 'Resolve the approval first' };

  // Re-establish a controllable tab (§9.8: target_closed → reopen first).
  if (run.state === 'paused:detached') {
    const tabAlive = run.tabId != null && (await chrome.tabs.get(run.tabId).catch(() => null)) != null;
    if (!tabAlive) {
      const task = await db.tasks.get(run.taskId);
      const tab = await chrome.tabs.create({ url: task?.site ?? 'about:blank', active: true });
      run.tabId = tab.id;
    }
    await db.runs.update(runId, { tabId: run.tabId, state: 'running', detachReason: undefined });
    await attachDebugger(run.tabId!, runId);
  } else {
    await db.runs.update(runId, { state: 'running' });
  }

  await ensureOffscreen();
  await sendToOffscreen({ type: 'run:resume-loop', runId });
  await refreshBadge();
  return {};
}

export async function resolveGate(gateId: string, approved: boolean): Promise<void> {
  const gate = await db.gates.get(gateId);
  if (!gate) return;
  const run = await db.runs.get(gate.runId);
  await db.gates.update(gateId, { status: approved ? 'approved' : 'stopped', resolvedAt: Date.now() });
  await chrome.alarms.clear(GATE_DETACH_ALARM + gate.runId);

  if (run) {
    // §3.4: the debugger may have been detached while waiting — re-attach.
    if (approved && run.tabId != null && attachedRuns.get(run.tabId) !== run.id) {
      await attachDebugger(run.tabId, run.id);
    }
    await chrome.runtime.sendMessage({ type: 'gate:resolved', runId: gate.runId, gateId, approved }).catch(() => {});
    if (!approved && run.state === 'paused:gate') {
      await db.runs.update(run.id, { state: 'stopped:user', endedAt: Date.now() });
      await detachForRun(run.id);
    }
  }
  await refreshBadge();
}

// Runs paused on a gate detach their debugger after 3 minutes (§3.4) so the
// banner doesn't sit there indefinitely.
async function armGateDetachTimer(): Promise<void> {
  const gated = (await db.runs.toArray()).filter((r) => r.state === 'paused:gate');
  for (const run of gated) {
    const existing = await chrome.alarms.get(GATE_DETACH_ALARM + run.id);
    if (!existing) chrome.alarms.create(GATE_DETACH_ALARM + run.id, { delayInMinutes: 3 });
  }
}

export async function handleAlarm(name: string): Promise<void> {
  if (name.startsWith(GATE_DETACH_ALARM)) {
    const runId = name.slice(GATE_DETACH_ALARM.length);
    const run = await db.runs.get(runId);
    if (run?.state === 'paused:gate') await detachForRun(runId, { keepRegistration: true });
  }
}

export async function onDebuggerDetach(tabId: number, reason: DetachReason): Promise<void> {
  const runId = attachedRuns.get(tabId);
  attachedRuns.delete(tabId);
  if (!runId) return;
  const run = await db.runs.get(runId);
  if (!run || isTerminal(run.state)) return;
  // A gate-wait detach (§3.4) is deliberate — don't overwrite the gate state.
  if (run.state === 'paused:gate') return;

  await db.runs.update(runId, { state: 'paused:detached', detachReason: reason });
  await chrome.runtime.sendMessage({ type: 'run:detached', runId, reason }).catch(() => {});
  await notify(
    'Run paused',
    reason === 'replaced_with_devtools'
      ? `DevTools took over the tab — "${run.taskTitle}" can resume from step ${run.stepCount}.`
      : reason === 'target_closed'
        ? `The tab was closed — "${run.taskTitle}" can resume from step ${run.stepCount}.`
        : `Debugging was cancelled — "${run.taskTitle}" can resume from step ${run.stepCount}.`,
  );
  await refreshBadge();
}

export async function onLoopExited(runId: string): Promise<void> {
  await detachForRun(runId);
  await armGateDetachTimer();
  await refreshBadge();
}

async function attachDebugger(tabId: number, runId: string): Promise<void> {
  if (attachedRuns.get(tabId) === runId) return;
  await chrome.debugger.attach({ tabId }, '1.3');
  attachedRuns.set(tabId, runId);
}

async function detachForRun(runId: string, opts: { keepRegistration?: boolean } = {}): Promise<void> {
  const run = await db.runs.get(runId);
  const tabId = run?.tabId;
  if (tabId == null) return;
  if (!opts.keepRegistration) attachedRuns.delete(tabId);
  if (attachedRuns.get(tabId) === runId || !opts.keepRegistration) {
    await chrome.debugger.detach({ tabId }).catch(() => {});
  }
  if (opts.keepRegistration) attachedRuns.delete(tabId);
}

export function isAttachedTab(tabId: number): boolean {
  return attachedRuns.has(tabId);
}

// ---------------------------------------------------------------- badge ---

export async function refreshBadge(): Promise<void> {
  const runs = await db.runs.toArray();
  const tasks = await db.tasks.toArray();
  const live = runs.filter((r) => !isTerminal(r.state));
  const gated = live.filter((r) => r.state === 'paused:gate').length;
  const detached = live.filter((r) => r.state === 'paused:detached').length;
  const missed = tasks.filter((t) => t.missedReason).length;
  const running = live.filter((r) => r.state === 'running' || r.state === 'planning' || r.state === 'queued').length;

  // UI spec §4.2: count when running, ! on alarm-red when a gate waits,
  // ? for stuck/detached/missed.
  if (gated > 0) {
    await chrome.action.setBadgeText({ text: '!' });
    await chrome.action.setBadgeBackgroundColor({ color: '#C8102E' });
  } else if (detached > 0 || missed > 0) {
    await chrome.action.setBadgeText({ text: '?' });
    await chrome.action.setBadgeBackgroundColor({ color: '#000000' });
  } else if (running > 0) {
    await chrome.action.setBadgeText({ text: String(running) });
    await chrome.action.setBadgeBackgroundColor({ color: '#000000' });
  } else {
    await chrome.action.setBadgeText({ text: '' });
  }
}

export async function notify(title: string, message: string): Promise<void> {
  await chrome.notifications.create({
    type: 'basic', iconUrl: 'icon/128.png', title, message,
  }).catch(() => {});
}

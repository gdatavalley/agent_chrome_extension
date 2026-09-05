// Service worker entrypoint — thin event router, holds no state (spec §2.1).
// Durable state lives in Dexie; orchestration lives in src/background/*.
import { db } from '../src/memory/db';
import { encryptText, decryptText } from '../src/shared/crypto';
import type { KeyRecord, LLMProviderId } from '../src/shared/types';
import type { Request, Response } from '../src/shared/messages';
import type { DetachReason } from '../src/shared/types';
import {
  startRun, stopRun, stopAllRuns, resumeRun, resolveGate,
  onDebuggerDetach, onLoopExited, handleAlarm, refreshBadge, notify,
} from '../src/background/run-controller';
import { ensureOffscreen } from '../src/background/offscreen';
import { syncScheduleAlarms, handleScheduleAlarm, detectMissedSchedules } from '../src/background/scheduler';

export default defineBackground(() => {
  // The action icon opens the Tasks tab, never the panel (UI spec §4.1).
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
  chrome.action.onClicked.addListener(() => {
    void chrome.tabs.create({ url: chrome.runtime.getURL('tasks.html') });
  });

  chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
      void chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') });
    }
    void refreshBadge();
  });

  chrome.runtime.onStartup.addListener(() => {
    void (async () => {
      await syncScheduleAlarms();
      await detectMissedSchedules();
      await refreshBadge();
    })();
  });

  // Global kill switch (UI spec §4.3) — works whether or not the panel is open.
  chrome.commands.onCommand.addListener((command) => {
    if (command === 'halt-agent') void stopAllRuns();
  });

  // §3.5: involuntary detach is a first-class run state, not an error.
  chrome.debugger.onDetach.addListener((source, reason) => {
    if (source.tabId != null) void onDebuggerDetach(source.tabId, reason as DetachReason);
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name.startsWith('sched:')) void handleScheduleAlarm(alarm.name);
    else void handleAlarm(alarm.name);
  });

  chrome.runtime.onMessage.addListener((msg: Request & { type: string }, _sender, reply) => {
    void route(msg)
      .then((result) => reply({ ok: true, result } satisfies Response))
      .catch((err) => reply({ ok: false, error: err instanceof Error ? err.message : String(err) } satisfies Response));
    return true; // async reply
  });
});

async function route(msg: Request & { type: string }): Promise<unknown> {
  switch (msg.type) {
    case 'cdp:exec': {
      const res = await chrome.debugger.sendCommand({ tabId: msg.tabId }, msg.method, msg.params ?? {});
      return res ?? {};
    }
    case 'run:start': {
      const out = await startRun(msg.taskId);
      if (out.error) throw new Error(out.error);
      // Surface the run in the panel (UI §4.1: the panel opens when a run starts).
      const win = await chrome.windows.getCurrent().catch(() => null);
      if (win?.id != null) await chrome.sidePanel.open({ windowId: win.id }).catch(() => {});
      await chrome.storage.session.set({ 'panel.currentRunId': out.runId });
      return out;
    }
    case 'run:stop': return stopRun(msg.runId);
    case 'run:stopAll': return stopAllRuns();
    case 'run:resume': {
      const out = await resumeRun(msg.runId);
      if (out.error) throw new Error(out.error);
      return out;
    }
    case 'gate:resolve': return resolveGate(msg.gateId, msg.approved);
    case 'run:show-me': {
      // Full element-picker overlay lands with the content-reader work; for
      // now Show me resumes the run so the loop retries with fresh context.
      const out = await resumeRun(msg.runId);
      if (out.error) throw new Error(out.error);
      return out;
    }
    case 'keys:add': return addKey(msg.provider, msg.key, msg.billingEnabledConfirmed);
    case 'keys:test': return testKey(msg.keyId);
    case 'keys:delete': return db.keys.delete(msg.keyId);
    case 'task:save': return db.tasks.put(msg.task);
    case 'task:delete': {
      await db.tasks.delete(msg.taskId);
      await syncScheduleAlarms();
      return null;
    }
    case 'permissions:request': {
      const granted = await chrome.permissions.request({ origins: [msg.origin] });
      return { granted };
    }
    case 'permissions:revoke': {
      const removed = await chrome.permissions.remove({ origins: [msg.origin] });
      return { removed };
    }
    case 'panel:watch': {
      await chrome.storage.session.set({ 'panel.currentRunId': msg.runId });
      const win = await chrome.windows.getCurrent().catch(() => null);
      if (win?.id != null) await chrome.sidePanel.open({ windowId: win.id }).catch(() => {});
      return null;
    }
    case 'dev:report': {
      // Harness hook (dev builds only): forward run telemetry to the local
      // report server. No-ops when the server isn't there.
      await fetch('http://localhost:8899/report', {
        method: 'POST', body: JSON.stringify(msg.payload),
      }).catch(() => {});
      return null;
    }
    case 'dev:command': {
      if (!import.meta.env.DEV) throw new Error('dev commands are dev-build only');
      const cmd = msg.command;
      if (cmd.kind === 'start' && cmd.task) {
        const task = {
          id: crypto.randomUUID(),
          allowNewTabs: false, allowOffOrigin: false, allowIframes: true,
          schedule: null, createdAt: Date.now(), maxSteps: 25,
          readOnly: true, ...cmd.task,
        } as import('../src/shared/types').Task;
        await db.tasks.put(task);
        if (cmd.mode) {
          const { setLlmMode } = await import('../src/llm/resolve');
          await setLlmMode(cmd.mode as 'mock' | 'byok' | 'hosted');
        }
        const out = await startRun(task.id);
        if (out.error) throw new Error(out.error);
        return out;
      }
      if (cmd.kind === 'approveGates') {
        const pending = await db.gates.where('status').equals('pending').toArray();
        for (const g of pending) await resolveGate(g.id, true);
        return { approved: pending.length };
      }
      if (cmd.kind === 'stopAll') return stopAllRuns();
      if (cmd.kind === 'hostedSignin') {
        const worker = 'http://localhost:8787';
        const d = await (await fetch(`${worker}/auth/device`, { method: 'POST' })).json();
        await fetch(`${worker}/test/confirm`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ user_code: d.user_code }),
        });
        const t = await (await fetch(`${worker}/auth/device/token`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ device_code: d.device_code }),
        })).json();
        const { storeTokenPair, refreshEntitlementSnapshot } = await import('../src/llm/entitlement');
        await storeTokenPair(t);
        await refreshEntitlementSnapshot();
        const { setLlmMode } = await import('../src/llm/resolve');
        await setLlmMode('hosted');
        const me = await (await fetch(`${worker}/v1/me`, {
          headers: { authorization: `Bearer ${t.access_token}` },
        })).json();
        return { userId: me.user_id, credits: me.credits_remaining };
      }
      if (cmd.kind === 'resumeLatest') {
        const runs = await db.runs.toArray();
        const run = runs
          .filter((r) => r.state.startsWith('paused:'))
          .sort((a, b) => b.startedAt - a.startedAt)[0];
        if (!run) throw new Error('no paused run to resume');
        const out = await resumeRun(run.id);
        if (out.error) throw new Error(out.error);
        return { runId: run.id };
      }
      throw new Error(`unknown dev command: ${cmd.kind}`);
    }
    case 'loop:exited': return onLoopExited((msg as unknown as { runId: string }).runId);
    default:
      throw new Error(`unknown message type: ${(msg as { type: string }).type}`);
  }
}

// ---------------------------------------------------------------- keys ---
// §10.5: verify with a real one-token round trip before accepting; encrypt
// with Web Crypto; never render a stored key back (§11).

const PROVIDER_ENDPOINTS: Partial<Record<LLMProviderId, { origin: string; url: string }>> = {
  openai: { origin: 'https://api.openai.com/*', url: 'https://api.openai.com/v1/chat/completions' },
  gemini: { origin: 'https://generativelanguage.googleapis.com/*', url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent' },
};

async function verifyKeyRoundTrip(provider: LLMProviderId, key: string): Promise<void> {
  const ep = PROVIDER_ENDPOINTS[provider];
  if (!ep) throw new Error(`unknown provider ${provider}`);
  const granted = await chrome.permissions.request({ origins: [ep.origin] });
  if (!granted) throw new Error(`access to ${ep.origin} was not granted`);

  if (provider === 'openai') {
    const res = await fetch(ep.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: 'gpt-5.6-luna', max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    });
    if (res.status === 401 || res.status === 403) throw new Error('The provider rejected that key.');
    if (!res.ok) throw new Error(`The provider answered ${res.status} — try again in a moment.`);
    return;
  }
  throw new Error(`verification for ${provider} is not wired yet`);
}

async function addKey(
  provider: LLMProviderId,
  key: string,
  billingEnabledConfirmed?: boolean,
): Promise<{ keyId: string; label: string }> {
  await verifyKeyRoundTrip(provider, key);
  const { ciphertext, iv } = await encryptText(key);
  const rec: KeyRecord = {
    id: crypto.randomUUID(),
    provider,
    label: `${key.slice(0, 3)}··········${key.slice(-4)}`,
    ciphertext,
    iv,
    billingEnabledConfirmed,
    createdAt: Date.now(),
    lastVerifiedAt: Date.now(),
  };
  await db.keys.put(rec);
  return { keyId: rec.id, label: rec.label };
}

async function testKey(keyId: string): Promise<{ verified: boolean }> {
  const rec = await db.keys.get(keyId);
  if (!rec) throw new Error('key not found');
  const key = await decryptText(rec.ciphertext, rec.iv);
  await verifyKeyRoundTrip(rec.provider, key);
  await db.keys.update(keyId, { lastVerifiedAt: Date.now() });
  return { verified: true };
}

// Re-sync badge whenever runs change underneath us (SW restarts lose nothing
// — Dexie is the source of truth). Hooks fire inside Dexie's transaction, so
// the actual read is deferred — doing async DB work inside a hook callback
// kills the transaction (DexieError).
let badgeTimer: ReturnType<typeof setTimeout> | undefined;
const scheduleBadgeRefresh = () => {
  clearTimeout(badgeTimer);
  badgeTimer = setTimeout(() => void refreshBadge(), 50);
};
db.runs.hook('creating', scheduleBadgeRefresh);
db.runs.hook('updating', scheduleBadgeRefresh);
db.runs.hook('deleting', scheduleBadgeRefresh);

// ---------------------------------------------------------------------------
// DEV ONLY — E2E harness wiring lives in the offscreen loop host (reporting)
// and the dev:command message case above (commands). The SW deliberately does
// NOT poll: MV3 kills it at ~30s idle and timers die with it.
// The harness may also invoke commands directly in this context — a
// runtime.sendMessage from the SW never loops back to its own listener.
if (import.meta.env.DEV) {
  (globalThis as Record<string, unknown>).__devCommand = (command: unknown) =>
    route({ type: 'dev:command', command: command as never });
}

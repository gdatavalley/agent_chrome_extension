// Typed message contracts between surfaces (spec §6.2 shared/messages.ts).
// UI and the offscreen loop talk to the service worker; the SW is a thin
// router and holds no state (§2.1). Live UI state flows through Dexie
// liveQuery, not through messages — messages are commands and CDP transport.
import type { GateKind, LLMProviderId, RunState, Task } from './types';

export type Request =
  | { type: 'cdp:exec'; runId: string; tabId: number; method: string; params?: Record<string, unknown> }
  | { type: 'run:start'; taskId: string }
  | { type: 'run:stop'; runId: string }
  | { type: 'run:stopAll' }
  | { type: 'run:resume'; runId: string }
  | { type: 'run:show-me'; runId: string }
  | { type: 'gate:resolve'; gateId: string; approved: boolean }
  | { type: 'task:save'; task: Task }
  | { type: 'task:delete'; taskId: string }
  | { type: 'permissions:request'; origin: string }
  | { type: 'permissions:revoke'; origin: string }
  | { type: 'keys:add'; provider: LLMProviderId; key: string; billingEnabledConfirmed?: boolean }
  | { type: 'keys:test'; keyId: string }
  | { type: 'keys:delete'; keyId: string }
  | { type: 'panel:watch'; runId: string }
  | { type: 'loop:exited'; runId: string }
  | { type: 'dev:command'; command: { kind: string; task?: Record<string, unknown>; mode?: 'mock' | 'byok' | 'hosted' } }
  | { type: 'dev:report'; payload: unknown };

export type Response<T = unknown> =
  | { ok: true; result: T }
  | { ok: false; error: string };

export async function send<T = unknown>(msg: Request): Promise<T> {
  const res = (await chrome.runtime.sendMessage(msg)) as Response<T>;
  if (!res || typeof res !== 'object' || !('ok' in res)) {
    throw new Error(`no response for ${msg.type}`);
  }
  if (!res.ok) throw new Error(res.error);
  return res.result;
}

// SW → offscreen notifications (detached debugger, abort).
export type SwEvent =
  | { type: 'loop:start'; runId: string }
  | { type: 'run:detached'; runId: string; reason: string }
  | { type: 'run:abort'; runId: string }
  | { type: 'run:resume-loop'; runId: string }
  | { type: 'gate:resolved'; runId: string; gateId: string; approved: boolean };

export type RunStateChanged = { runId: string; state: RunState };
export type { GateKind };

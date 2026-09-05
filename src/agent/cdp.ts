// chrome.debugger wrapper (spec §6.2 agent/cdp.ts).
//
// The agent loop lives in the offscreen document, but chrome.debugger is only
// available to the service worker — so every CDP call is proxied through the
// SW ('cdp:exec'), which is the thin router in §2.1. The SW also owns
// attach/detach and onDetach → run-state mapping (§3.5).
import { send } from '../shared/messages';

export async function cdpExec<T = unknown>(
  runId: string,
  tabId: number,
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  return send<T>({ type: 'cdp:exec', runId, tabId, method, params });
}

export interface AxNode {
  nodeId: string;
  ignored?: boolean;
  role?: { value?: string };
  name?: { value?: string };
  backendDOMNodeId?: number;
  childIds?: string[];
  properties?: Array<{ name: string; value?: { value?: unknown } }>;
}

// Guardrails (spec §5). Two jobs:
//
// 1. Read-only action-layer enforcement (§5.1 primary layer): typing, file
//    input and submit-control clicks are mechanically blocked. What read-only
//    does NOT stop — mutating non-submit clicks — falls through to gates.
// 2. Confirm-gate classification (§5.3): name-pattern based, enforced here in
//    application code, never requested in the prompt.
import { isSubmitControl } from './act';
import type { IndexedElement } from './perceive';
import type { AgentAction } from '../llm/schemas';
import type { GateKind } from '../shared/types';

const GATE_PATTERNS: Array<{ kind: GateKind; re: RegExp; irreversible: boolean }> = [
  { kind: 'payment', re: /\b(pay|purchase|checkout|buy|order now|place order)\b/i, irreversible: true },
  { kind: 'delete', re: /\b(delete|remove|erase|destroy|discard)\b/i, irreversible: true },
  { kind: 'send', re: /\b(send|post|publish|dm|message|share|submit)\b/i, irreversible: true },
  { kind: 'upload', re: /\b(upload|attach)\b/i, irreversible: false },
  { kind: 'file-overwrite', re: /\b(replace|overwrite)\b/i, irreversible: true },
  { kind: 'form-submit', re: /\b(confirm|apply|save changes|sign up|register)\b/i, irreversible: false },
];

export interface GateVerdict {
  kind: GateKind;
  irreversible: boolean;
}

// Never-touch patterns come from task/guardrail settings (§5.3).
export function gateFor(
  el: IndexedElement,
  neverTouch: RegExp[] = [],
): GateVerdict | null {
  const name = el.name.trim();
  if (neverTouch.some((re) => re.test(name))) return { kind: 'never-touch', irreversible: true };
  for (const p of GATE_PATTERNS) {
    if (p.re.test(name)) return { kind: p.kind, irreversible: p.irreversible };
  }
  return null;
}

// Read-only: which actions are mechanically blocked? (§5.1)
// Typing is always blocked. Clicks are blocked only when they resolve to a
// submit control — checked against the live DOM, not guessed from the name.
export async function readOnlyBlockReason(
  action: AgentAction,
  el: IndexedElement | undefined,
  submitCheck: (el: IndexedElement) => Promise<boolean>,
): Promise<string | null> {
  if (action.action === 'type') return 'typing is blocked in read-only mode';
  if (action.action === 'click' && el && (await submitCheck(el))) {
    return 'submit controls are blocked in read-only mode';
  }
  return null;
}

export { isSubmitControl };

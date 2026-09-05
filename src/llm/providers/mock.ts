// Deterministic stand-in for the model, used by the E2E harness and dev runs
// when no API key is configured (setting llm.mode = 'mock'). It exercises the
// full protocol — zod-validated actions, usage objects, credits — so the
// loop, guardrails, gates and metering are all tested against the real code
// paths. Task title prefixes script the interesting paths:
//   "[stuck] ..."  → hands off at tier 5 on step 2
//   "[gate] ..."   → clicks an element matching /approve/i (triggers a gate)
//   "[type] ..."   → attempts to type (read-only block path)
// Anything else runs the default plan: dismiss overlays, click something
// matching the task words, paginate once, done.
import type { Provider, CallArgs } from '../router';
import type { ModelResult } from '../schemas';
import type { AgentAction } from '../schemas';

const USAGE = { prompt_tokens: 9000, completion_tokens: 60 };

function findIndex(menu: string, re: RegExp): number | null {
  for (const line of menu.split('\n')) {
    const m = line.match(/^(\d+)\.\s+\w+\s+"(.*)"$/);
    const idx = m?.[1];
    const name = m?.[2];
    if (idx && name != null && re.test(name)) return Number(idx);
  }
  return null;
}

export function mockProvider(): Provider {
  // Per-task call counter (each loop iteration builds a fresh prompt object,
  // so keying by object identity would never increment).
  const calls = new Map<string, number>();

  return {
    id: 'mock',
    call: async (args: CallArgs): Promise<ModelResult> => {
      const n = (calls.get(args.prompt.taskTitle) ?? 0) + 1;
      calls.set(args.prompt.taskTitle, n);

      const { menu, taskTitle, history } = args.prompt;
      let action: AgentAction;

      if (taskTitle.startsWith('[stuck]')) {
        action = n < 2
          ? { action: 'click', index: findIndex(menu, /dismiss/i) ?? 1 }
          : {
              action: 'stuck',
              reason: "Couldn't find the export button",
              tried: ['Looked for a button named "Export" or "Download"', 'Waited and retried twice'],
              help: 'Show me where to click, or describe it differently.',
            };
      } else if (taskTitle.startsWith('[gate]')) {
        const idx = findIndex(menu, /delete/i);
        action = n < 2 && idx != null
          ? { action: 'click', index: idx }
          : { action: 'done', outcome: 'Old invoices deleted' };
      } else if (taskTitle.startsWith('[type]')) {
        const idx = findIndex(menu, /search|vendor/i);
        action = idx != null
          ? { action: 'type', index: idx, text: 'Northgate' }
          : { action: 'done', outcome: 'no input found' };
      } else {
        action = defaultPlan(menu, taskTitle, history.length);
      }

      return { action, usage: { ...USAGE } };
    },
  };
}

function defaultPlan(menu: string, taskTitle: string, step: number): AgentAction {
  const dismiss = findIndex(menu, /dismiss/i);
  if (dismiss != null && step === 0) return { action: 'click', index: dismiss };

  // Match meaningful task words (≥4 chars) against menu entries.
  const words = taskTitle.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 4);
  for (const word of words) {
    const idx = findIndex(menu, new RegExp(word, 'i'));
    if (idx != null && step <= 1) return { action: 'click', index: idx };
  }

  const next = findIndex(menu, /next page/i);
  if (next != null && step <= 2) return { action: 'click', index: next };

  return {
    action: 'done',
    outcome: '8 invoices downloaded and renamed by vendor',
    files: ['northgate-2026-07.pdf', 'brightline-2026-07.pdf'],
  };
}

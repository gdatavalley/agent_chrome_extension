// Post-action verification (spec §3.3 — "action fired, nothing happened" is
// fixed by verification, not more observation) and the race-condition fix:
// wait 800ms, retry the identical observation.
import { cdpExec } from './cdp';

export const WAIT_RETRY_MS = 800;

export async function evaluate<T = unknown>(runId: string, tabId: number, expression: string): Promise<T | undefined> {
  const res = await cdpExec<{ result?: { value?: T } }>(
    runId, tabId, 'Runtime.evaluate', { expression, returnByValue: true },
  );
  return res.result?.value;
}

export async function verifyWithRetry(
  runId: string,
  tabId: number,
  expression: string,
  retries = 1,
): Promise<boolean> {
  const check = async () => (await evaluate<boolean>(runId, tabId, expression)) === true;
  if (await check()) return true;
  for (let i = 0; i < retries; i++) {
    await new Promise((r) => setTimeout(r, WAIT_RETRY_MS));
    if (await check()) return true;
  }
  return false;
}

// Derives a cheap state probe after an action: did ANYTHING on the page move?
// Used when the model's expectation is implicit.
export async function pageMutationProbe(runId: string, tabId: number): Promise<string> {
  return (await evaluate<string>(
    runId, tabId,
    `location.href + '|' + document.title + '|' + document.body.innerText.length`,
  )) ?? '';
}

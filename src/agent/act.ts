// Action primitives (spec §2.3, §2.4, §6.2 agent/act.ts).
// Index → backendNodeId → DOM.getBoxModel → centre point → CDP input with
// isTrusted: true. Read-only enforcement and gate classification live in
// guardrails.ts; this module only executes what it is handed.
import { cdpExec } from './cdp';
import type { IndexedElement } from './perceive';

export async function resolvePoint(
  runId: string, tabId: number, el: IndexedElement,
): Promise<{ x: number; y: number }> {
  await cdpExec(runId, tabId, 'DOM.scrollIntoViewIfNeeded', { backendNodeId: el.backendNodeId }).catch(() => {});
  const { model } = await cdpExec<{ model: { border: number[] } }>(
    runId, tabId, 'DOM.getBoxModel', { backendNodeId: el.backendNodeId },
  );
  const q = model.border as [number, number, number, number, number, number, number, number];
  return { x: (q[0] + q[2] + q[4] + q[6]) / 4, y: (q[1] + q[3] + q[5] + q[7]) / 4 };
}

export async function click(runId: string, tabId: number, el: IndexedElement): Promise<void> {
  const { x, y } = await resolvePoint(runId, tabId, el);
  await cdpExec(runId, tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await cdpExec(runId, tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

export async function typeText(runId: string, tabId: number, el: IndexedElement, text: string): Promise<void> {
  await click(runId, tabId, el); // focus first, like a person
  await cdpExec(runId, tabId, 'Input.insertText', { text });
}

export async function scroll(runId: string, tabId: number, direction: 'up' | 'down'): Promise<void> {
  await cdpExec(runId, tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseWheel', x: 200, y: 300, deltaX: 0, deltaY: direction === 'down' ? 480 : -480,
  });
}

export async function navigate(runId: string, tabId: number, url: string): Promise<void> {
  await cdpExec(runId, tabId, 'Page.navigate', { url });
}

// Used by read-only enforcement (§5.1): is this element a submit control?
// Resolves the backend node and inspects it in page context (a read).
export async function isSubmitControl(runId: string, tabId: number, el: IndexedElement): Promise<boolean> {
  try {
    const { object } = await cdpExec<{ object: { objectId: string } }>(
      runId, tabId, 'DOM.resolveNode', { backendNodeId: el.backendNodeId },
    );
    const res = await cdpExec<{ result?: { value?: boolean } }>(
      runId, tabId, 'Runtime.callFunctionOn',
      {
        objectId: object.objectId,
        returnByValue: true,
        functionDeclaration: `function() {
          const t = (this.getAttribute('type') || '').toLowerCase();
          return t === 'submit' || t === 'image' || this.hasAttribute('formaction')
            || (this.closest('form') != null && this.tagName === 'BUTTON' && t === '');
        }`,
      },
    );
    return res.result?.value === true;
  } catch {
    return false; // can't prove it — the name-pattern gate check still applies
  }
}

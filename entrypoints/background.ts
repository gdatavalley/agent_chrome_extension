// Milestone 0 spike — validates the debugger pipeline end to end:
// attach → Accessibility.getFullAXTree → trim → index → resolve →
// Input.dispatchMouseEvent → verify, with size and latency metrics.
//
// Throwaway by design (spec §13, Milestone 0). Not the production
// architecture: the agent loop moves to an offscreen document in M1,
// verification moves to content scripts in M2, and the element picker
// is a deterministic stand-in for the model.

const SPIKE_URL = 'http://localhost:8899/spike.html';
const REPORT_URL = 'http://localhost:8899/report';
const WAIT_RETRY_MS = 800; // spec §3.3: race condition → wait, retry identical observation

const INTERACTIVE_ROLES = new Set([
  'link', 'button', 'textbox', 'searchbox', 'combobox', 'listbox',
  'checkbox', 'radio', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
  'tab', 'option', 'switch', 'slider', 'spinbutton', 'treeitem',
]);
const NAMELESS_OK = new Set(['textbox', 'searchbox', 'combobox', 'checkbox', 'radio', 'switch', 'slider', 'spinbutton']);

type Send = (method: string, params?: Record<string, unknown>) => Promise<any>;

interface IndexedElement {
  index: number;
  role: string;
  name: string;
  backendNodeId: number;
}

interface Perception {
  elements: IndexedElement[];
  menu: string;
  rawNodes: number;
  fullChars: number;
  menuChars: number;
  latencyMs: number;
}

interface StepResult {
  goal: string;
  picked: string;
  rawAxNodes: number;
  interactiveElements: number;
  fullTreeChars: number;
  menuChars: number;
  menuTokensEst: number;
  fullTreeTokensEst: number;
  perceiveMs: number;
  actionMs: number;
  verified: boolean;
  verifyDesc: string;
  stepMs: number;
}

function axString(v: unknown): string {
  const val = (v as { value?: unknown } | undefined)?.value;
  return typeof val === 'string' ? val : '';
}

export default defineBackground(() => {
  console.log('[spike] background alive, opening', SPIKE_URL);
  // The SW opens the target tab itself: an externally-driven tab (puppeteer,
  // DevTools) already has a debugger client attached and chrome.debugger
  // would refuse with a conflict (spec §3.5's replaced_with_devtools).
  chrome.tabs.create({ url: SPIKE_URL }).catch((err) =>
    postReport({ ok: false, fatal: `tabs.create failed: ${String(err)}` }),
  );
  const timer = setInterval(async () => {
    // tabs.query url filter uses match patterns, which reject ports —
    // query broadly and match manually instead.
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((t) => t.url === SPIKE_URL);
    if (tab?.id != null) {
      clearInterval(timer);
      runSpike(tab.id).catch((err) => postReport({ ok: false, fatal: String(err) }));
    }
  }, 500);
});

async function postReport(body: Record<string, unknown>) {
  console.log('[spike] report', JSON.stringify(body));
  await fetch(REPORT_URL, { method: 'POST', body: JSON.stringify(body) }).catch(() => {});
}

async function runSpike(tabId: number) {
  const target = { tabId };
  const send: Send = (method, params = {}) => chrome.debugger.sendCommand(target, method, params);

  const tAttach = performance.now();
  await chrome.debugger.attach(target, '1.3');
  const attachMs = performance.now() - tAttach;
  console.log('[spike] debugger attached in', attachMs.toFixed(0), 'ms');

  const steps = [
    {
      goal: 'Dismiss',
      expectExpr: `!document.getElementById('cookie-banner')`,
      expectDesc: 'cookie banner removed',
    },
    {
      goal: 'Apply filters',
      expectExpr: `document.getElementById('toast')?.classList.contains('show') === true`,
      expectDesc: 'toast shown',
    },
    {
      goal: 'Next page',
      expectExpr: `document.getElementById('page-num')?.textContent?.trim() === 'Page 2 of 3'`,
      expectDesc: 'page advanced',
    },
  ];

  const results: StepResult[] = [];
  try {
    for (const step of steps) {
      const t0 = performance.now();
      const perception = await perceive(send);
      const pick = pickElement(perception.elements, step.goal);
      if (!pick) {
        throw new Error(`picker found nothing named like "${step.goal}" among ${perception.elements.length} elements`);
      }

      const tAction = performance.now();
      const point = await resolvePoint(send, pick);
      await clickAt(send, point);
      const actionMs = performance.now() - tAction;

      const verified = await verifyWithRetry(send, step.expectExpr);
      const stepMs = performance.now() - t0;

      results.push({
        goal: step.goal,
        picked: `⟨${pick.role} #${pick.index}⟩ "${pick.name}"`,
        rawAxNodes: perception.rawNodes,
        interactiveElements: perception.elements.length,
        fullTreeChars: perception.fullChars,
        menuChars: perception.menuChars,
        menuTokensEst: Math.ceil(perception.menuChars / 4),
        fullTreeTokensEst: Math.ceil(perception.fullChars / 4),
        perceiveMs: Math.round(perception.latencyMs),
        actionMs: Math.round(actionMs),
        verified,
        verifyDesc: step.expectDesc,
        stepMs: Math.round(stepMs),
      });
      console.log(`[spike] step "${step.goal}" → ${pick.name} verified=${verified} in ${stepMs.toFixed(0)}ms`);
    }

    await postReport({
      ok: results.every((s) => s.verified),
      attachMs: Math.round(attachMs),
      totalMs: Math.round(performance.now() - tAttach),
      steps: results,
    });
  } finally {
    await chrome.debugger.detach(target).catch(() => {});
  }
}

async function perceive(send: Send): Promise<Perception> {
  const t0 = performance.now();
  const { nodes } = await send('Accessibility.getFullAXTree');

  let fullChars = 0;
  const elements: IndexedElement[] = [];
  for (const n of nodes as any[]) {
    if (n.ignored) continue;
    const role = axString(n.role);
    const name = axString(n.name);
    fullChars += role.length + name.length + 6;
    if (INTERACTIVE_ROLES.has(role) && (name.length > 0 || NAMELESS_OK.has(role))) {
      // AXNode exposes the DOM node as backendDOMNodeId (not backendNodeId).
      elements.push({ index: elements.length + 1, role, name, backendNodeId: n.backendDOMNodeId });
    }
  }
  const menu = elements.map((e) => `${e.index}. ${e.role} "${e.name}"`).join('\n');
  return {
    elements,
    menu,
    rawNodes: (nodes as unknown[]).length,
    fullChars,
    menuChars: menu.length,
    latencyMs: performance.now() - t0,
  };
}

// Deterministic stand-in for the model: the real loop hands `menu` to the LLM
// and it returns an index. Real-key verification of usage/caching fields is a
// separate M0 item pending an API key.
function pickElement(elements: IndexedElement[], goal: string): IndexedElement | undefined {
  const g = goal.toLowerCase();
  return elements.find((e) => e.name.toLowerCase() === g)
      ?? elements.find((e) => e.name.toLowerCase().includes(g));
}

async function resolvePoint(send: Send, el: IndexedElement): Promise<{ x: number; y: number }> {
  await send('DOM.scrollIntoViewIfNeeded', { backendNodeId: el.backendNodeId }).catch(() => {});
  const { model } = await send('DOM.getBoxModel', { backendNodeId: el.backendNodeId });
  const q = model.border as [number, number, number, number, number, number, number, number];
  return { x: (q[0] + q[2] + q[4] + q[6]) / 4, y: (q[1] + q[3] + q[5] + q[7]) / 4 };
}

async function clickAt(send: Send, { x, y }: { x: number; y: number }) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

async function verifyWithRetry(send: Send, expr: string): Promise<boolean> {
  const check = async () => {
    const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    return res?.result?.value === true;
  };
  if (await check()) return true;
  await new Promise((r) => setTimeout(r, WAIT_RETRY_MS));
  return check();
}

// Perception (spec §2.3, §2.4, §6.2 agent/perceive.ts).
// Accessibility.getFullAXTree → trim → enumerate → assign indices.
// Interactive elements become the numbered menu; the full role/depth walk
// feeds the structural fingerprint (§4.1). Password fields are never read
// (§5.2): nodes marked protected are excluded from the menu entirely.
import { cdpExec, type AxNode } from './cdp';

const INTERACTIVE_ROLES = new Set([
  'link', 'button', 'textbox', 'searchbox', 'combobox', 'listbox',
  'checkbox', 'radio', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
  'tab', 'option', 'switch', 'slider', 'spinbutton', 'treeitem',
]);
const NAMELESS_OK = new Set([
  'textbox', 'searchbox', 'combobox', 'checkbox', 'radio', 'switch', 'slider', 'spinbutton',
]);

export interface IndexedElement {
  index: number;
  role: string;
  name: string;
  backendNodeId: number;
}

export interface Perception {
  url: string;
  title: string;
  elements: IndexedElement[];
  menu: string;
  roleDepths: Array<{ role: string; depth: number }>;
  rawNodes: number;
  latencyMs: number;
}

function axString(v: unknown): string {
  const val = (v as { value?: unknown } | undefined)?.value;
  return typeof val === 'string' ? val : '';
}

function isProtected(node: AxNode): boolean {
  return (node.properties ?? []).some(
    (p) => p.name === 'protected' && p.value?.value === true,
  );
}

export async function perceive(runId: string, tabId: number): Promise<Perception> {
  const t0 = performance.now();
  const [{ nodes }, layout] = await Promise.all([
    cdpExec<{ nodes: AxNode[] }>(runId, tabId, 'Accessibility.getFullAXTree'),
    cdpExec<{ result?: { value?: { url?: string; title?: string } } }>(
      runId, tabId, 'Runtime.evaluate',
      { expression: '({url: location.href, title: document.title})', returnByValue: true },
    ),
  ]);

  // Depth via BFS over childIds for the fingerprint's shape string.
  const byId = new Map<string, AxNode>(nodes.map((n) => [n.nodeId, n]));
  const roots = nodes.filter((n) => !nodes.some((p) => p.childIds?.includes(n.nodeId)));
  const roleDepths: Array<{ role: string; depth: number }> = [];
  const queue: Array<[AxNode, number]> = roots.map((r) => [r, 0]);
  const seen = new Set<string>();
  while (queue.length > 0) {
    const [node, depth] = queue.shift()!;
    if (seen.has(node.nodeId)) continue;
    seen.add(node.nodeId);
    const role = axString(node.role);
    if (!node.ignored && role) roleDepths.push({ role, depth });
    for (const cid of node.childIds ?? []) {
      const child = byId.get(cid);
      if (child) queue.push([child, depth + 1]);
    }
  }

  const elements: IndexedElement[] = [];
  for (const n of nodes) {
    if (n.ignored || isProtected(n)) continue;
    const role = axString(n.role);
    const name = axString(n.name);
    if (INTERACTIVE_ROLES.has(role) && (name.length > 0 || NAMELESS_OK.has(role)) && n.backendDOMNodeId) {
      elements.push({ index: elements.length + 1, role, name, backendNodeId: n.backendDOMNodeId });
    }
  }
  const menu = elements.map((e) => `${e.index}. ${e.role} "${e.name}"`).join('\n');

  return {
    url: layout.result?.value?.url ?? '',
    title: layout.result?.value?.title ?? '',
    elements,
    menu,
    roleDepths,
    rawNodes: nodes.length,
    latencyMs: performance.now() - t0,
  };
}

// The offscreen document hosts the agent loops (spec §2.2 — the load-bearing
// rule). It holds no Chrome-API ambition beyond messaging and IndexedDB; CDP
// work is proxied through the service worker.
import { db } from '../../src/memory/db';
import { AgentLoop } from '../../src/agent/loop';
import { resolveLlm } from '../../src/llm/resolve';
import type { SwEvent } from '../../src/shared/messages';

const loops = new Map<string, AgentLoop>();

// DEV ONLY — harness reporting. The loop host is guaranteed alive at these
// moments (it just did the work), so reports come from here, not the SW.
async function devReport(runId: string): Promise<void> {
  if (!import.meta.env.DEV) return;
  try {
    const [run, steps, gates] = await Promise.all([
      db.runs.get(runId),
      db.steps.where('runId').equals(runId).sortBy('n'),
      db.gates.where('runId').equals(runId).toArray(),
    ]);
    await fetch('http://localhost:8899/report', {
      method: 'POST',
      body: JSON.stringify({ run, steps, gates }),
    });
  } catch { /* harness server not up */ }
}

async function startLoop(runId: string, resume: boolean): Promise<void> {
  const run = await db.runs.get(runId);
  if (!run) return;
  const task = await db.tasks.get(run.taskId);
  if (!task) return;
  try {
    const llm = await resolveLlm();
    const deps = {
      ...llm,
      onStateChange: (r: typeof run) => {
        if (r.state === 'paused:gate' || r.state === 'paused:credits' || r.state === 'paused:auth') {
          void devReport(r.id);
        }
      },
    };
    const loop = resume
      ? await AgentLoop.resume(run, task, deps)
      : await AgentLoop.start(run, task, deps);
    loops.set(runId, loop);
    await loop.execute();
  } catch (err) {
    // Missing key / expired token parks the run as paused:auth with its
    // checkpoint intact (§3.5) — resumable once the user fixes the key.
    const { PausedError } = await import('../../src/llm/router');
    if (err instanceof PausedError) {
      await db.runs.update(runId, { state: 'paused:auth', error: err.message });
    } else {
      await db.runs.update(runId, { state: 'stopped:cap', error: String(err), endedAt: Date.now() });
    }
  } finally {
    loops.delete(runId);
    await devReport(runId);
    // Housekeeping signal: the SW refreshes the badge and detaches the
    // debugger when the loop is no longer live.
    await chrome.runtime.sendMessage({ type: 'loop:exited', runId }).catch(() => {});
  }
}

chrome.runtime.onMessage.addListener((msg: SwEvent & { type: string }) => {
  if (!msg || typeof msg !== 'object') return;
  switch (msg.type) {
    case 'loop:start':
      void startLoop((msg as unknown as { runId: string }).runId, false);
      break;
    case 'run:resume-loop':
      void startLoop(msg.runId, true);
      break;
    case 'run:abort':
      loops.get(msg.runId)?.abort();
      break;
    case 'run:detached':
      loops.get(msg.runId)?.noteDetached();
      break;
    case 'gate:resolved':
      loops.get(msg.runId)?.resolveGate(msg.gateId, msg.approved);
      break;
  }
});

console.log('[offscreen] loop host ready');

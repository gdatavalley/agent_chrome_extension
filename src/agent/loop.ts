// THE AGENT LOOP (spec §2.2 — it lives in the offscreen document, never the
// service worker). One run = one AgentLoop. Every step is checkpointed to
// IndexedDB before the next begins, so a worker restart resumes rather than
// restarts. UI surfaces never talk to the loop directly — they watch Dexie.
import { db, getSetting } from '../memory/db';
import { fingerprint } from '../memory/fingerprint';
import { cdpExec } from './cdp';
import { perceive, type IndexedElement, type Perception } from './perceive';
import { click, typeText, scroll, navigate, isSubmitControl } from './act';
import { pageMutationProbe, WAIT_RETRY_MS } from './verify';
import { gateFor, readOnlyBlockReason } from './guardrails';
import { Escalation } from './escalation';
import { redactText } from '../llm/redact';
import { creditsFor, usdFor } from '../shared/meter';
import { DEFAULT_GUARDRAILS, type Gate, type Run, type RunState, type Task } from '../shared/types';
import type { Provider } from '../llm/router';
import { PausedError } from '../llm/router';
import type { AgentAction, ModelResult } from '../llm/schemas';
import type { ModelConfig } from '../shared/types';

interface CachedSequence {
  taskTitle: string;
  outcome: string;
  files?: string[];
  steps: Array<{ role: string; name: string }>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const VERBS: Record<string, string> = {
  click: 'Clicked',
  type: 'Typed',
  scroll: 'Scrolled',
  navigate: 'Navigated',
};

export interface LoopDeps {
  provider: Provider;
  model: ModelConfig;
  // Harness/observability hook — fires on every state transition. Production
  // callers leave it undefined; the offscreen host wires dev reporting.
  onStateChange?: (run: Run) => void;
}

export class AgentLoop {
  private escalation = new Escalation();
  private history: string[] = [];
  private replayTrail: Array<{ role: string; name: string }> = [];
  private startFingerprint = '';
  private aborted = false;
  private detached = false;
  private gateWaiters = new Map<string, (approved: boolean) => void>();

  private constructor(
    private run: Run,
    private task: Task,
    private deps: LoopDeps,
  ) {}

  // Fresh run or resume from checkpoint (§2.2) — history is rebuilt from the
  // durable step rows so the retry prompt loses nothing.
  static async start(run: Run, task: Task, deps: LoopDeps): Promise<AgentLoop> {
    return new AgentLoop(run, task, deps);
  }

  static async resume(run: Run, task: Task, deps: LoopDeps): Promise<AgentLoop> {
    const loop = new AgentLoop(run, task, deps);
    const rows = await db.steps.where('runId').equals(run.id).sortBy('n');
    loop.history = rows
      .filter((s) => s.kind === 'action')
      .map((s) => `${s.n}. ${s.verb}${s.target ? ` ${s.target}` : ''}${s.note ? ` (${s.note})` : ''}`);
    return loop;
  }

  abort(): void {
    this.aborted = true;
  }

  noteDetached(): void {
    this.detached = true;
    this.aborted = true;
  }

  resolveGate(gateId: string, approved: boolean): void {
    this.gateWaiters.get(gateId)?.(approved);
    this.gateWaiters.delete(gateId);
  }

  async execute(): Promise<void> {
    try {
      await this.main();
    } catch (err) {
      await this.fail(err);
    }
  }

  // ---------------------------------------------------------------- main ---

  private async main(): Promise<void> {
    const { run, task } = this;
    if (run.tabId == null) throw new Error('run has no tab');

    if (run.state === 'queued' || run.state === 'planning') {
      await this.transition('planning');
      await this.row('info', 'Reading the page…');
    }

    let perception = await perceive(run.id, run.tabId);
    if (run.stepCount === 0) {
      await this.row('info', `Found ${perception.elements.length} things to interact with`, {
        note: `${new URL(task.site).host}\n${task.readOnly ? 'read only' : 'can write'} · max ${task.maxSteps} steps${task.allowNewTabs ? '' : '\nno new tabs'}`,
      });
      await this.rememberPageShape(perception);
    }

    const guardrails = await getSetting('guardrails', DEFAULT_GUARDRAILS);
    if (guardrails.neverSendDomains.some((d) => d && perception.url.includes(d))) {
      return this.stop('stopped:cap', 'This site is excluded from model content (Settings → Guardrails).');
    }

    // Tier 1 (§3.1): replay a remembered path for this exact page shape —
    // zero model calls. Anything breaking falls through to tier 2 with the
    // partial path visible in the history.
    if (run.stepCount === 0) {
      this.startFingerprint = fingerprint(perception.url, perception.roleDepths);
      const replayed = await this.tryReplay(perception);
      if (replayed === 'done') return;
    }

    while (true) {
      if (this.detached) return; // SW wrote paused:detached; checkpoint is durable
      if (this.aborted) return this.stop('stopped:user');
      if (run.stepCount >= task.maxSteps) return this.stop('stopped:cap', `Stopped after ${run.stepCount} steps`);
      if (task.maxCredits != null && run.creditsUsed >= task.maxCredits) {
        return this.stop('stopped:cap', 'Hit the per-run credit cap.');
      }

      // 1–2. Perceive → prompt (§2.4). Page state goes last (§7.5).
      const result = await this.callModel(perception);
      if (!result) return; // paused — state + checkpoint already written

      const action = result.action;
      this.run.creditsUsed += creditsFor(result.usage, this.deps.model);
      await this.meterUsage(result);

      if (action.action === 'done') return this.complete(action);
      if (action.action === 'stuck') return this.stuck(action);

      // 3–4. Resolve the model's index against the CURRENT menu.
      const needsElement = action.action === 'click' || action.action === 'type';
      const el = needsElement ? perception.elements.find((e) => e.index === action.index) : undefined;
      if (needsElement && !el) {
        await this.miss(run, `model picked #${action.index}, not in the current menu`, perception);
        await this.maybeEscalate();
        perception = await perceive(run.id, run.tabId);
        if (await this.maybeHandOff(run)) return;
        continue;
      }

      // 5. Guardrails, enforced in code (§5.1, §5.3).
      if (run.readOnly) {
        const reason = await readOnlyBlockReason(action, el, (e) =>
          isSubmitControl(run.id, run.tabId!, e),
        );
        if (reason) {
          await this.row('failure', 'Blocked', { note: reason });
          this.history.push(`· Blocked: ${reason}`);
          await this.miss(run, reason, perception);
          await this.maybeEscalate();
          if (await this.maybeHandOff(run)) return;
          continue;
        }
      }
      if (el && (action.action === 'click' || action.action === 'type')) {
        const verdict = gateFor(el);
        if (verdict) {
          const approved = await this.confirmGate(verdict.kind, verdict.irreversible, el, action);
          if (!approved) return this.stop('stopped:user', 'Stopped at a confirm gate.');
        }
      }

      // 5b. Act (§2.4 step 5) with a before/after mutation probe.
      const probeBefore = await pageMutationProbe(run.id, run.tabId);
      await this.dispatch(action, el, perception);
      await sleep(350);

      // 6. Verify (§3.3: post-action verification, then wait-retry).
      let probeAfter = await pageMutationProbe(run.id, run.tabId);
      if (probeAfter === probeBefore) {
        await sleep(WAIT_RETRY_MS);
        probeAfter = await pageMutationProbe(run.id, run.tabId);
        if (probeAfter === probeBefore) {
          await this.row('failure', 'Retried', {
            target: 'after wait',
            note: "nothing changed on the page",
          });
          await this.miss(run, 'action fired, nothing happened', perception);
          await this.maybeEscalate();
          if (await this.maybeHandOff(run)) return;
          continue;
        }
      }

      // 7. Checkpoint (§2.2) — every single step, before the next one.
      this.escalation.noteSuccess();
      run.stepCount += 1;
      const verb = VERBS[action.action] ?? 'Acted';
      const target = el?.name ?? (action.action === 'navigate' ? action.url : action.action === 'scroll' ? action.direction : '');
      this.history.push(`${run.stepCount}. ${verb}${target ? ` ${target}` : ''}`);
      if (el && action.action === 'click') this.replayTrail.push({ role: el.role, name: el.name });
      await this.row('action', verb, {
        target,
        ref: el ? `⟨${el.role} #${el.index}⟩` : undefined,
      });
      await this.checkpoint();
      perception = await perceive(run.id, run.tabId);
    }
  }

  // ------------------------------------------------------------ internals ---

  private async callModel(perception: Perception): Promise<ModelResult | null> {
    const { run, task } = this;
    try {
      // Tier 3 (§3.1): same element index, plus a screenshot of the page.
      const screenshotBase64 = this.escalation.tier >= 3
        ? await this.captureScreenshot()
        : undefined;
      return await this.deps.provider.call({
        prompt: {
          taskTitle: task.title,
          readOnly: run.readOnly,
          origins: run.origins,
          maxSteps: task.maxSteps,
          history: this.history,
          failureRecord: this.escalation.failurePrompt(),
          menu: redactText(perception.menu),
          screenshotBase64,
        },
        model: this.deps.model,
      });
    } catch (err) {
      if (err instanceof PausedError) {
        await this.pause(err.kind === 'credits' ? 'paused:credits' : 'paused:auth');
        return null;
      }
      throw err;
    }
  }

  private async captureScreenshot(): Promise<string | undefined> {
    try {
      const { data } = await cdpExec<{ data: string }>(
        this.run.id, this.run.tabId!, 'Page.captureScreenshot',
        { format: 'jpeg', quality: 60 },
      );
      return data;
    } catch {
      return undefined; // a failed capture never blocks the run
    }
  }

  // Tier 1 replay (§4.2–4.3): exact structural fingerprint match, then every
  // cached step is verified against the LIVE menu — expected role AND
  // accessible name — before it executes. One mismatch invalidates and we
  // re-observe at tier 2.
  private async tryReplay(perception: Perception): Promise<'done' | 'failed' | 'none'> {
    const entry = await db.pageMemory.get(this.startFingerprint);
    if (!entry || entry.ttl < Date.now()) return 'none';
    const seq = entry.successes.find((s) => s.taskTitle === this.task.title);
    if (!seq || seq.steps.length === 0) return 'none';

    const { run } = this;
    const tabId = run.tabId!;
    this.escalation.tier = 1;
    await this.checkpoint();
    await this.row('info', 'Replaying a remembered path', {
      note: `${seq.steps.length} steps from an earlier run`,
    });

    for (const cached of seq.steps) {
      const el = perception.elements.find(
        (e) => e.name === cached.name && e.role === cached.role,
      );
      if (!el) {
        await this.row('failure', 'Remembered path broke', {
          note: `"${cached.name}" is not where it was — re-observing`,
        });
        this.escalation.escalateTo(2);
        return 'failed';
      }
      const probeBefore = await pageMutationProbe(run.id, tabId);
      await click(run.id, tabId, el);
      await sleep(350);
      let probeAfter = await pageMutationProbe(run.id, tabId);
      if (probeAfter === probeBefore) {
        await sleep(WAIT_RETRY_MS);
        probeAfter = await pageMutationProbe(run.id, tabId);
        if (probeAfter === probeBefore) {
          await this.row('failure', 'Remembered path broke', {
            note: `"${cached.name}" did nothing this time — re-observing`,
          });
          this.escalation.escalateTo(2);
          return 'failed';
        }
      }
      run.stepCount += 1;
      this.history.push(`${run.stepCount}. Clicked ${el.name}`);
      await this.row('action', 'Clicked', { target: el.name, ref: `⟨${el.role} #${el.index}⟩` });
      await this.checkpoint();
      perception = await perceive(run.id, tabId);
    }

    await this.complete({ action: 'done', outcome: seq.outcome, files: seq.files });
    return 'done';
  }

  private async saveSuccesses(action: Extract<AgentAction, { action: 'done' }>): Promise<void> {
    if (this.replayTrail.length === 0 || !this.startFingerprint) return;
    const entry = await db.pageMemory.get(this.startFingerprint);
    if (!entry) return;
    const successes = entry.successes.filter((s) => s.taskTitle !== this.task.title);
    successes.push({
      taskTitle: this.task.title,
      outcome: action.outcome,
      files: action.files,
      steps: this.replayTrail,
    });
    await db.pageMemory.update(this.startFingerprint, {
      successes,
      updatedAt: Date.now(),
      ttl: Date.now() + 30 * 24 * 3600 * 1000,
    });
  }

  private async miss(run: Run, summary: string, _perception: Perception): Promise<void> {
    this.escalation.noteMiss(run.stepCount, summary);
    this.history.push(`· ${summary}`);
    await this.checkpoint();
  }

  private async maybeEscalate(): Promise<void> {
    if (this.escalation.shouldEscalateToScreenshot()) {
      this.escalation.escalateTo(3);
      await this.row('info', 'Escalated to a screenshot', {
        note: 'the element menu was not enough',
      });
    }
  }

  private async maybeHandOff(run: Run): Promise<boolean> {
    if (!this.escalation.shouldHandOff(3)) return false; // tier 3 is the highest built tier
    await this.stuck({
      action: 'stuck',
      reason: "Couldn't make progress after repeated attempts",
      tried: this.escalation.failures.slice(-3).map((f) => f.summary),
      help: 'Show me where to click, or describe it differently.',
    });
    return true;
  }

  private async confirmGate(
    kind: Gate['kind'],
    irreversible: boolean,
    el: IndexedElement,
    action: AgentAction,
  ): Promise<boolean> {
    const gate: Gate = {
      id: crypto.randomUUID(),
      runId: this.run.id,
      stepN: this.run.stepCount + 1,
      kind,
      detail: detailFor(kind, el),
      ref: `⟨${el.role} #${el.index}⟩ ${el.name}`,
      irreversible,
      approveLabel: approveLabelFor(kind, action),
      stopLabel: 'Stop here',
      status: 'pending',
      createdAt: Date.now(),
    };
    await db.gates.put(gate);
    await this.row('gate', 'Needs your approval', { ref: gate.ref, note: gate.detail });
    await this.transition('paused:gate');
    return new Promise<boolean>((resolve) => {
      this.gateWaiters.set(gate.id, async (approved) => {
        await db.gates.update(gate.id, { status: approved ? 'approved' : 'stopped', resolvedAt: Date.now() });
        if (approved) await this.transition('running');
        resolve(approved);
      });
    });
  }

  private async dispatch(
    action: AgentAction,
    el: IndexedElement | undefined,
    _perception: Perception,
  ): Promise<void> {
    const { run } = this;
    const tabId = run.tabId!;
    switch (action.action) {
      case 'click': return click(run.id, tabId, el!);
      case 'type': return typeText(run.id, tabId, el!, action.text);
      case 'scroll': return scroll(run.id, tabId, action.direction);
      case 'navigate': return navigate(run.id, tabId, action.url);
      default: return;
    }
  }

  private async complete(action: Extract<AgentAction, { action: 'done' }>): Promise<void> {
    this.run.stepCount += 1;
    await this.row('system', 'Done', { note: action.outcome });
    await this.saveSuccesses(action);
    await this.stop('complete');
    await this.updateMeterOnComplete();
  }

  private async stuck(action: Extract<AgentAction, { action: 'stuck' }>): Promise<void> {
    await this.row('failure', "Couldn't make progress", { note: action.reason });
    await db.audit.add({
      ts: Date.now(), runId: this.run.id, taskId: this.task.id,
      type: 'stuck', summary: action.reason,
      meta: { tried: action.tried, help: action.help },
    });
    await this.stop('stopped:stuck', action.reason);
  }

  private async stop(state: RunState, note?: string): Promise<void> {
    this.run.state = state;
    this.run.endedAt = Date.now();
    if (note) this.run.error = note;
    await this.checkpoint();
    this.deps.onStateChange?.(this.run);
    await db.audit.add({
      ts: Date.now(), runId: this.run.id, taskId: this.task.id,
      type: 'run:end', summary: `${state}${note ? ` — ${note}` : ''}`,
      meta: { steps: this.run.stepCount, credits: this.run.creditsUsed },
    });
  }

  private async pause(state: RunState): Promise<void> {
    this.run.state = state;
    await this.checkpoint();
    this.deps.onStateChange?.(this.run);
  }

  private async fail(err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    await this.row('failure', 'Stopped', { note: message }).catch(() => {});
    await this.stop('stopped:cap', message).catch(() => {});
  }

  private async transition(state: RunState): Promise<void> {
    this.run.state = state;
    await this.checkpoint();
    this.deps.onStateChange?.(this.run);
  }

  private async checkpoint(): Promise<void> {
    this.run.tier = this.escalation.tier;
    await db.runs.put({ ...this.run });
  }

  private async row(
    kind: 'action' | 'failure' | 'info' | 'gate' | 'system',
    verb: string,
    extra: { target?: string; ref?: string; note?: string } = {},
  ): Promise<void> {
    // Actions already incremented stepCount; failures refer to the upcoming one.
    const n = kind === 'action' ? this.run.stepCount : kind === 'failure' ? this.run.stepCount + 1 : 0;
    await db.steps.add({
      runId: this.run.id,
      n,
      ts: Date.now(),
      tier: this.escalation.tier,
      kind,
      verb,
      target: extra.target,
      ref: extra.ref,
      note: extra.note,
    });
    await db.runs.update(this.run.id, { stepCount: this.run.stepCount, creditsUsed: this.run.creditsUsed });
  }

  private async rememberPageShape(perception: Perception): Promise<void> {
    const fp = fingerprint(perception.url, perception.roleDepths);
    const existing = await db.pageMemory.get(fp);
    await db.pageMemory.put({
      fingerprint: fp,
      origin: new URL(perception.url || this.task.site).origin,
      url: perception.url,
      actions: existing?.actions ?? {},
      successes: existing?.successes ?? [],
      failures: existing?.failures ?? [],
      updatedAt: Date.now(),
      ttl: Date.now() + 30 * 24 * 3600 * 1000,
    });
  }

  private async meterUsage(result: ModelResult): Promise<void> {
    // BYOK meter (UI §5: tokens + dollars, no bar). Hosted credits are
    // debited server-side; the run row already carries creditsUsed.
    if (this.deps.provider.id === 'hosted') return;
    const meter = (await db.meter.get('local')) ?? {
      id: 'local' as const, ewmaCredits: 0, completedRuns: 0,
      byokTokens: 0, byokCostUsd: 0, monthBucket: monthBucket(),
    };
    if (meter.monthBucket !== monthBucket()) {
      meter.byokTokens = 0;
      meter.byokCostUsd = 0;
      meter.monthBucket = monthBucket();
    }
    meter.byokTokens += result.usage.prompt_tokens + result.usage.completion_tokens;
    meter.byokCostUsd += usdFor(result.usage, this.deps.model);
    await db.meter.put(meter);
  }

  private async updateMeterOnComplete(): Promise<void> {
    // Rolling average from completed runs only (UI §5.1): EWMA α≈0.2.
    const meter = (await db.meter.get('local')) ?? {
      id: 'local' as const, ewmaCredits: 0, completedRuns: 0,
      byokTokens: 0, byokCostUsd: 0, monthBucket: monthBucket(),
    };
    const α = 0.2;
    meter.ewmaCredits = meter.completedRuns === 0
      ? this.run.creditsUsed
      : α * this.run.creditsUsed + (1 - α) * meter.ewmaCredits;
    meter.completedRuns += 1;
    await db.meter.put(meter);
    await db.tasks.update(this.task.id, { lastRunAt: Date.now() });
  }
}

function monthBucket(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function detailFor(kind: Gate['kind'], el: IndexedElement): string {
  switch (kind) {
    case 'payment': return `This will activate a payment control: ${el.name}`;
    case 'delete': return `This will delete or remove something: ${el.name}`;
    case 'send': return `This will send, post or submit: ${el.name}`;
    case 'upload': return `This will upload a file: ${el.name}`;
    case 'file-overwrite': return `This will replace something that already exists: ${el.name}`;
    case 'never-touch': return `This element matches a never-touch pattern: ${el.name}`;
    default: return `This will activate: ${el.name}`;
  }
}

function approveLabelFor(kind: Gate['kind'], action: AgentAction): string {
  const verb = action.action === 'type' ? 'Type it' : 'Do it';
  switch (kind) {
    case 'payment': return 'Pay';
    case 'delete': return 'Delete it';
    case 'send': return 'Send it';
    case 'upload': return 'Upload it';
    case 'file-overwrite': return 'Replace them';
    default: return verb;
  }
}

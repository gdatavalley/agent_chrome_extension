// Shared UI helpers: Dexie live queries, meter formatting, time formatting.
// All copy follows UI spec §14 (sentence case, contractions, no "successfully").
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getSetting } from '../memory/db';
import { planAllowance, type BillingTier, type MeterStats, type Run, type Step, type Task } from '../shared/types';

export { useLiveQuery };
export { db };

export function useRun(runId: string | undefined): Run | undefined {
  return useLiveQuery(() => (runId ? db.runs.get(runId) : undefined), [runId]);
}

export function useRunSteps(runId: string | undefined): Step[] | undefined {
  return useLiveQuery(
    async () => (runId ? db.steps.where('runId').equals(runId).sortBy('id') : []),
    [runId],
  );
}

export function useTasks(): Task[] | undefined {
  return useLiveQuery(() => db.tasks.orderBy('createdAt').toArray(), []);
}

export function useRuns(): Run[] | undefined {
  return useLiveQuery(() => db.runs.toArray(), []);
}

export function useMeter(): MeterStats | undefined {
  return useLiveQuery(() => db.meter.get('local'), []);
}

export function relTime(ts: number | undefined): string {
  if (!ts) return 'never run';
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

export function duration(startedAt: number, endedAt?: number): string {
  const s = Math.max(0, Math.round(((endedAt ?? Date.now()) - startedAt) / 1000));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m === 0 ? `${sec}s` : `${m}m ${String(sec).padStart(2, '0')}s`;
}

export function clockTime(ts: number): string {
  const d = new Date(ts);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
}

// The meter label always carries a plain-language estimate from the user's
// own rolling average (UI §5, §5.1). Before 3 completed runs, fall back to
// the spec's typical-task figure (46 credits) and soften the wording.
export function tasksLeftEstimate(creditsRemaining: number, meter: MeterStats | undefined): string {
  const avg = meter && meter.completedRuns >= 3 && meter.ewmaCredits > 0 ? meter.ewmaCredits : 46;
  const rough = meter && meter.completedRuns >= 3 ? 'about' : 'roughly';
  const n = Math.max(0, Math.round(creditsRemaining / avg / 5) * 5); // never false precision
  return `${rough} ${n} more tasks like yours`;
}

export function formatCredits(n: number): string {
  return n.toLocaleString('en-US');
}

// Billing context, read once and shared by every meter surface so the panel,
// the Tasks header and Spending can never disagree about what tier you're on.
export function useBilling(): { mode: BillingTier; plan: string; remaining: number; allowance: number } {
  const mode = useLiveQuery(() => getSetting<BillingTier>('llm.mode', 'mock'), []);
  const plan = useLiveQuery(() => getSetting<string>('entitlement.plan', 'trial'), []);
  const remaining = useLiveQuery(() => getSetting<number | null>('entitlement.creditsRemaining', null), []);
  const resolvedPlan = plan ?? 'trial';
  const allowance = planAllowance(resolvedPlan);
  return {
    mode: mode ?? 'mock',
    plan: resolvedPlan,
    remaining: remaining ?? allowance,
    allowance,
  };
}

// UI §5: at >85% consumed the label gains a second line rather than recolouring
// the bar — the palette's one colour is reserved for gates and the ! badge.
export function creditHeadline(remaining: number, allowance: number): string {
  return `${formatCredits(remaining)} of ${formatCredits(allowance)} credits`;
}

export function creditSubline(
  remaining: number,
  allowance: number,
  meter: MeterStats | undefined,
): string {
  const used = allowance - remaining;
  if (allowance > 0 && used / allowance > 0.85) return 'running low — top up or upgrade';
  return tasksLeftEstimate(remaining, meter);
}

export function scheduleLabel(task: Task): string {
  if (!task.schedule) return 'manual';
  const days = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
  const names = task.schedule.days.map((d) => days[d]).join(', ');
  return `${names} ${task.schedule.time}`;
}

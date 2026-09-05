// Shared UI helpers: Dexie live queries, meter formatting, time formatting.
// All copy follows UI spec §14 (sentence case, contractions, no "successfully").
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../memory/db';
import type { MeterStats, Run, Step, Task } from '../shared/types';

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

export function scheduleLabel(task: Task): string {
  if (!task.schedule) return 'manual';
  const days = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
  const names = task.schedule.days.map((d) => days[d]).join(', ');
  return `${names} ${task.schedule.time}`;
}

// Scheduling (spec §5.5). chrome.alarms only fires while Chrome is open —
// a silently missed schedule is worse than no schedule, so misses are
// detected on startup and stamped on the task with the reason. Scheduled
// runs are forced read-only: nobody is watching to answer a confirm gate.
import { db } from '../memory/db';
import { startRun, notify, refreshBadge } from './run-controller';

const SCHEDULE_ALARM = 'sched:';

export async function syncScheduleAlarms(): Promise<void> {
  const tasks = await db.tasks.toArray();
  const wanted = new Map<string, { days: number[]; time: string }>();
  for (const t of tasks) if (t.schedule) wanted.set(t.id, t.schedule);

  const existing = await chrome.alarms.getAll();
  for (const alarm of existing) {
    if (alarm.name.startsWith(SCHEDULE_ALARM) && !wanted.has(alarm.name.slice(SCHEDULE_ALARM.length))) {
      await chrome.alarms.clear(alarm.name);
    }
  }
  for (const [taskId, sched] of wanted) {
    // Weekly granularity: one alarm per scheduled day. v1 keeps it simple —
    // the first day in the list gets the alarm; multi-day tasks get one each.
    for (const day of sched.days) {
      const when = nextOccurrence(day, sched.time);
      chrome.alarms.create(`${SCHEDULE_ALARM}${taskId}:${day}`, { scheduledTime: when, periodInMinutes: 7 * 24 * 60 });
    }
  }
}

function nextOccurrence(day: number, time: string): number {
  const [h = 9, m = 0] = time.split(':').map(Number);
  const now = new Date();
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  const delta = (day - now.getDay() + 7) % 7;
  d.setDate(d.getDate() + delta);
  if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 7);
  return d.getTime();
}

export async function handleScheduleAlarm(name: string): Promise<void> {
  const taskId = name.slice(SCHEDULE_ALARM.length).split(':')[0] ?? '';
  const task = await db.tasks.get(taskId);
  if (!task?.schedule) return;
  // Forced read-only (§5.5) regardless of the task's own setting.
  await db.tasks.update(taskId, { readOnly: true });
  const { error } = await startRun(taskId);
  if (error) {
    await notify("Scheduled run couldn't start", `${task.title}: ${error}`);
  }
}

// On startup: any alarm whose scheduledTime passed while Chrome was closed
// becomes a visible miss, with the reason (§5.5, UI §7.5).
export async function detectMissedSchedules(): Promise<number> {
  const now = Date.now();
  const alarms = await chrome.alarms.getAll();
  let missed = 0;
  for (const alarm of alarms) {
    if (!alarm.name.startsWith(SCHEDULE_ALARM)) continue;
    if (alarm.scheduledTime < now - 60_000) {
      const taskId = alarm.name.slice(SCHEDULE_ALARM.length).split(':')[0] ?? '';
      await db.tasks.update(taskId, { missedReason: 'Chrome closed' });
      missed += 1;
    }
  }
  if (missed > 0) {
    await notify("A scheduled run didn't happen", `${missed} task${missed > 1 ? 's were' : ' was'} missed because Chrome was closed.`);
  }
  await refreshBadge();
  return missed;
}

// Tasks tab — the library, the launcher, and live status of every run
// (UI spec §7). Compose is the product's only free-text input (§8).
import { useEffect, useMemo, useState } from 'react';
import {
  db, useLiveQuery, useMeter, useRuns, useTasks,
  formatCredits, relTime, scheduleLabel, tasksLeftEstimate,
} from '../../src/ui/shared';
import { send } from '../../src/shared/messages';
import { getSetting } from '../../src/memory/db';
import { DEFAULT_GUARDRAILS, type GuardrailDefaults, type Run, type Task } from '../../src/shared/types';
import { isTerminal } from '../../src/shared/types';

export function App() {
  const tasks = useTasks();
  const runs = useRuns();
  const meter = useMeter();
  const hosted = useLiveQuery(() => db.settings.get('entitlement.creditsRemaining'), []);
  const [composing, setComposing] = useState(false);
  const [editing, setEditing] = useState<Task | undefined>(undefined);
  const [notice, setNotice] = useState<string | null>(null);

  const liveRuns = useMemo(
    () => (runs ?? []).filter((r) => !isTerminal(r.state)),
    [runs],
  );

  if (composing) {
    return (
      <Page>
        <Compose
          existing={editing}
          onDone={() => { setComposing(false); setEditing(undefined); }}
        />
      </Page>
    );
  }

  const activeRunFor = (taskId: string) => liveRuns.find((r) => r.taskId === taskId);
  const waiting = liveRuns.filter((r) => r.state === 'paused:gate').length;

  const play = async (task: Task) => {
    setNotice(null);
    if (liveRuns.length >= 3) {
      setNotice('Already 3 runs in progress — wait for one to finish.');
      return;
    }
    if (liveRuns.some((r) => r.origins.includes(new URL(task.site).origin))) {
      setNotice('A run is already active on this site — one per site at a time.');
      return;
    }
    // Open the viewer BEFORE starting the run. run:start awaits Dexie,
    // tabs.create, the debugger attach and the offscreen handshake, which can
    // outlast this page's ~5s transient activation — and sidePanel.open()
    // needs that activation.
    await openPanel();
    try {
      const out = await send<{ runId: string }>({ type: 'run:start', taskId: task.id });
      await send({ type: 'panel:watch', runId: out.runId });
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    }
  };

  const remaining = typeof hosted?.value === 'number' ? (hosted.value as number) : 500;

  return (
    <Page>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16 }}>
        <h3 className="h3">Tasks</h3>
        <span className="mono meta">
          {waiting > 0 ? `${waiting} waiting on you` : liveRuns.length > 0 ? `${liveRuns.length} running` : `${formatCredits(remaining)} of 500 trial credits`}
        </span>
      </div>
      {notice && <div className="alert" style={{ marginBottom: 14 }}>{notice}</div>}
      {(tasks ?? []).length === 0 && (
        <p className="prose" style={{ color: 'var(--ink-60)', margin: '0 0 20px' }}>
          Start with something you&rsquo;d otherwise do by hand twice a week. Reading and summarising is a safer first try than submitting.
        </p>
      )}
      <div className="grid-2">
        {(tasks ?? []).map((t) => (
          <TaskCard
            key={t.id}
            task={t}
            run={activeRunFor(t.id)}
            onPlay={() => void play(t)}
            onEdit={() => { setEditing(t); setComposing(true); }}
            onWatch={(runId) => {
              void openPanel();
              void send({ type: 'panel:watch', runId });
            }}
            onDelete={async () => {
              await db.gates.where('runId').anyOf((runs ?? []).filter((r) => r.taskId === t.id).map((r) => r.id)).delete().catch(() => {});
              await send({ type: 'task:delete', taskId: t.id });
            }}
          />
        ))}
        <button className="add-card" onClick={() => setComposing(true)} style={{ background: 'none', font: 'inherit' }}>
          <span aria-hidden style={{ fontSize: 21 }}>+</span>
          <span>New task</span>
        </button>
      </div>
      <div style={{ marginTop: 24 }}>
        <span className="mono meta">{tasksLeftEstimate(remaining, meter)}</span>
      </div>
    </Page>
  );
}

// sidePanel.open() requires a user gesture. Called from a page it sees Blink
// transient activation, which lasts ~5s and survives awaits; the copy forwarded
// into the service worker dies at the first yield, which is why this cannot
// live in the background router (UI §4.1).
async function openPanel(): Promise<void> {
  try {
    const win = await chrome.windows.getCurrent();
    if (win.id != null) await chrome.sidePanel.open({ windowId: win.id });
  } catch { /* not fatal — the panel is still reachable from the toolbar */ }
}

function Page({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '32px 24px' }}>
      <div className="page" style={{ borderRadius: 12 }}>{children}</div>
    </div>
  );
}

// Card border carries run state (UI §7.1): hairline idle, ink-60 running,
// 2px ink when it wants you. Trash is hidden while running, never disabled.
function TaskCard({
  task, run, onPlay, onEdit, onWatch, onDelete,
}: {
  task: Task;
  run: Run | undefined;
  onPlay: () => void;
  onEdit: () => void;
  onWatch: (runId: string) => void;
  onDelete: () => void;
}) {
  const needsYou = run?.state === 'paused:gate';
  const running = run && !isTerminal(run.state) && !needsYou;
  const cls = needsYou ? 'card card--attention' : running ? 'card card--running' : 'card';

  return (
    <div className={cls}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7 }}>
        <span className="card__title" style={{ flex: 1 }}>{task.title}</span>
        {task.missedReason && <span className="pill">Didn&rsquo;t run</span>}
      </div>
      {needsYou && <div style={{ marginTop: 10 }}><span className="pill" style={{ padding: '6px 9px' }}>Action awaiting your approval</span></div>}
      <div className="card__foot">
        <span className="card__meta">
          {running
            ? `step ${run.stepCount} of ${run.maxSteps} · ${run.creditsUsed} credits`
            : task.missedReason
              ? `${scheduleLabel(task)} · ${task.missedReason}`
              : `${relTime(task.lastRunAt)} · ${scheduleLabel(task)}`}
        </span>
        <span className="card__controls">
          {/* Controls are hidden while running, never disabled (UI §7.2) —
              a disabled control invites a click that does nothing. */}
          {!running && !needsYou && (
            <>
              <button aria-label="Delete task" className="icon-trash" style={iconBtn} onClick={() => {
                if (confirm(`Delete "${task.title}"? Its schedule and cached page memory go with it.`)) onDelete();
              }}>🗑</button>
              <button aria-label="Edit task" style={iconBtn} onClick={onEdit}>✎</button>
              <button aria-label="Run task" style={iconBtn} onClick={onPlay}>▶</button>
            </>
          )}
          {(running || needsYou) && (
            <button aria-label="Watch run" style={iconBtn} onClick={() => onWatch(run.id)}>◉</button>
          )}
        </span>
      </div>
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer', fontSize: 16,
  color: 'var(--ink-60)', padding: 2,
};

// Compose (UI §8): textarea + setting rows, Save returns to Tasks.
// Read-only defaults ON (§8.2); write-implying words surface a hint but
// never flip the default silently.
const WRITE_HINT = /\b(submit|send|pay|rename|upload|post|delete)\b/i;

// Parses one origin per line (or comma separated), tolerating a missing scheme.
function parseOrigins(raw: string): { origins: string[]; bad: string[] } {
  const origins: string[] = [];
  const bad: string[] = [];
  for (const piece of raw.split(/[\n,]/).map((s) => s.trim()).filter(Boolean)) {
    try {
      origins.push(new URL(piece.startsWith('http') ? piece : `https://${piece}`).origin);
    } catch {
      bad.push(piece);
    }
  }
  return { origins: [...new Set(origins)], bad };
}

function Compose({ existing, onDone }: { existing?: Task; onDone: () => void }) {
  const [defaults, setDefaults] = useState<GuardrailDefaults>(DEFAULT_GUARDRAILS);
  const [title, setTitle] = useState(existing?.title ?? '');
  const [site, setSite] = useState(existing?.site ?? '');
  const [extra, setExtra] = useState((existing?.extraSites ?? []).join('\n'));
  const [readOnly, setReadOnly] = useState(existing?.readOnly ?? DEFAULT_GUARDRAILS.readOnly);
  const [maxSteps, setMaxSteps] = useState(existing?.maxSteps ?? DEFAULT_GUARDRAILS.maxSteps);
  const [scheduled, setScheduled] = useState(existing?.schedule != null);
  const [day, setDay] = useState(existing?.schedule?.days[0] ?? 1);
  const [time, setTime] = useState(existing?.schedule?.time ?? '09:00');
  const [error, setError] = useState<string | null>(null);

  // New tasks inherit the saved Guardrails profile (Settings → Guardrails),
  // not the compile-time constants. Editing keeps whatever the task already had.
  useEffect(() => {
    void getSetting('guardrails', DEFAULT_GUARDRAILS).then((g) => {
      setDefaults(g);
      if (!existing) {
        setReadOnly(g.readOnly);
        setMaxSteps(g.maxSteps);
      }
    });
  }, [existing]);

  const writeHint = WRITE_HINT.test(title);

  const save = async () => {
    if (!title.trim()) return setError('Describe the task first.');
    let origin: string;
    try {
      const u = new URL(site.startsWith('http') ? site : `https://${site}`);
      origin = u.origin;
    } catch {
      return setError('The site needs to be a URL, like https://expenses.example.com');
    }
    const { origins: extraOrigins, bad } = parseOrigins(extra);
    if (bad.length > 0) {
      return setError(`These don't look like site URLs: ${bad.join(', ')}`);
    }
    const task: Task = {
      id: existing?.id ?? crypto.randomUUID(),
      title: title.trim(),
      site: origin,
      extraSites: extraOrigins.filter((o) => o !== origin),
      readOnly,
      maxSteps,
      allowNewTabs: existing?.allowNewTabs ?? defaults.allowNewTabs,
      allowOffOrigin: existing?.allowOffOrigin ?? defaults.allowOffOrigin,
      allowIframes: existing?.allowIframes ?? defaults.allowIframes,
      schedule: scheduled ? { days: [day], time } : null,
      createdAt: existing?.createdAt ?? Date.now(),
      lastRunAt: existing?.lastRunAt,
      missedReason: existing?.missedReason,
    };
    await send({ type: 'task:save', task });
    onDone();
  };

  return (
    <>
      <h3 className="h3" style={{ marginBottom: 18 }}>{existing ? 'Edit task' : 'New task'}</h3>
      <textarea
        className="textarea"
        style={{ marginBottom: 16 }}
        aria-label="Task description"
        placeholder="Download last month's invoices and rename them by vendor"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      {writeHint && readOnly && (
        <div className="alert" style={{ marginBottom: 14 }}>
          This description sounds like it changes something — it probably needs read only turned off. Your call; the default stays on.
        </div>
      )}
      <div className="setting-row">
        <span>Start on</span>
        <input className="input mono" style={{ width: 260, fontSize: 12 }} placeholder="https://" value={site} onChange={(e) => setSite(e.target.value)} aria-label="Start site URL" />
      </div>
      <div className="setting-row" style={{ alignItems: 'flex-start' }}>
        <span style={{ paddingTop: 8 }}>
          Also allowed
          <span className="meta" style={{ display: 'block', color: 'var(--ink-60)', maxWidth: '30ch' }}>
            Other sites this task may use. One per line.
          </span>
        </span>
        <textarea
          className="input mono"
          style={{ width: 260, fontSize: 12, height: 62, resize: 'vertical', padding: '8px 10px' }}
          placeholder="https://another.example.com"
          value={extra}
          onChange={(e) => setExtra(e.target.value)}
          aria-label="Additional allowed sites"
        />
      </div>
      <div className="setting-row">
        <span>Read only</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span className="mono meta">{readOnly ? 'on' : 'off'}</span>
          <button
            className={`toggle${readOnly ? ' toggle--on' : ''}`}
            aria-label={`Read only — ${readOnly ? 'on' : 'off'}`}
            onClick={() => setReadOnly(!readOnly)}
            style={{ border: 'none' }}
          ><span className="toggle__knob" /></button>
        </span>
      </div>
      <div className="setting-row">
        <span>Max steps</span>
        <span className="stepper">
          <input
            className="mono" aria-label="Max steps" type="number" min={1} max={200}
            value={maxSteps} onChange={(e) => setMaxSteps(Number(e.target.value))}
            style={{ border: 'none', background: 'none', width: 48, font: 'inherit' }}
          />
        </span>
      </div>
      <div className="setting-row" style={{ borderBottom: '1px solid var(--rule)', marginBottom: 20 }}>
        <span>Run automatically</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span className="mono meta">{scheduled ? 'on' : 'off'}</span>
          <button
            className={`toggle${scheduled ? ' toggle--on' : ''}`}
            aria-label={`Run automatically — ${scheduled ? 'on' : 'off'}`}
            onClick={() => setScheduled(!scheduled)}
            style={{ border: 'none' }}
          ><span className="toggle__knob" /></button>
        </span>
      </div>
      {scheduled && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
            <select className="input" value={day} onChange={(e) => setDay(Number(e.target.value))} aria-label="Day of week">
              {['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays']
                .map((d, i) => <option key={d} value={i}>{d}</option>)}
            </select>
            <input className="input mono" style={{ width: 120 }} type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time" />
          </div>
          <div style={{ background: 'var(--wash)', borderRadius: 'var(--r-ctrl)', padding: '12px 13px' }}>
            <p className="prose" style={{ color: 'var(--ink-60)', margin: '0 0 10px' }}>
              Scheduled tasks only run while Chrome is open. If Chrome is closed at the time, the task is marked as missed and waits for you.
            </p>
            <p className="prose" style={{ color: 'var(--ink-60)', margin: 0 }}>
              Because nobody is watching, scheduled runs stay read only. Anything needing approval pauses and notifies you instead.
            </p>
          </div>
        </div>
      )}
      {error && <div className="alert" style={{ marginBottom: 14 }}>{error}</div>}
      <button className="btn btn--solid" style={{ padding: '0 18px' }} onClick={() => void save()}>Save</button>
      <button className="btn btn--ghost" style={{ marginLeft: 8 }} onClick={onDone}>Cancel</button>
    </>
  );
}

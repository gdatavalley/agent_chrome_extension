// Side panel — a run viewer, nothing else (UI spec §9). The header is always
// the current task name. All state renders from Dexie via liveQuery; the
// ledger is aria-live and each step is a list item (§13 accessibility).
import { useEffect, useRef, useState } from 'react';
import { db, useLiveQuery, useMeter, useRun, useRunSteps, clockTime, duration, formatCredits, tasksLeftEstimate } from '../../src/ui/shared';
import { send } from '../../src/shared/messages';
import type { Gate, Run, Step } from '../../src/shared/types';

function useCurrentRunId(): string | undefined {
  const [runId, setRunId] = useState<string | undefined>();
  useEffect(() => {
    void chrome.storage.session.get('panel.currentRunId').then((v) => {
      if (v['panel.currentRunId']) setRunId(v['panel.currentRunId'] as string);
    });
    const sub = (changes: Record<string, chrome.storage.StorageChange>) => {
      const c = changes['panel.currentRunId'];
      if (c?.newValue) setRunId(c.newValue as string);
    };
    chrome.storage.session.onChanged.addListener(sub);
    return () => chrome.storage.session.onChanged.removeListener(sub);
  }, []);
  // Fall back to the most recent non-terminal run.
  const latestActive = useLiveQuery(async () => {
    if (runId) return undefined;
    const runs = await db.runs.toArray();
    return runs.sort((a, b) => b.startedAt - a.startedAt)[0]?.id;
  }, [runId]);
  return runId ?? latestActive;
}

export function App() {
  const runId = useCurrentRunId();
  const run = useRun(runId);
  const steps = useRunSteps(runId);
  const gates = useLiveQuery(
    async () => (runId ? db.gates.where('runId').equals(runId).toArray() : []),
    [runId],
  );

  if (!run) {
    return (
      <div className="panel" style={{ minHeight: '100vh', border: 'none', borderRadius: 0 }}>
        <div className="panel__body">
          <p className="prose" style={{ color: 'var(--ink-60)' }}>No run to show yet.</p>
        </div>
      </div>
    );
  }

  const pendingGate = gates?.find((g) => g.status === 'pending');

  return (
    <div className="panel" style={{ minHeight: '100vh', border: 'none', borderRadius: 0 }}>
      <div className="panel__header">
        <span className="panel__title">{run.taskTitle}</span>
        <a
          href={chrome.runtime.getURL('options.html')}
          target="_blank"
          rel="noreferrer"
          aria-label="Settings"
          style={{ color: 'var(--ink-60)', textDecoration: 'none', fontSize: 16 }}
        >⚙</a>
      </div>
      <div className="panel__body">
        {run.error?.startsWith('no-access:') ? (
          <Blocked run={run} origin={run.error.slice('no-access:'.length)} />
        ) : (
          <Body run={run} steps={steps ?? []} gate={pendingGate} />
        )}
      </div>
      <Footer run={run} />
    </div>
  );
}

function Body({ run, steps, gate }: { run: Run; steps: Step[]; gate?: Gate }) {
  switch (run.state) {
    case 'planning':
    case 'running':
    case 'queued':
      return (
        <>
          {run.state !== 'running' && <div className="lead" style={{ marginBottom: 18 }}>Reading the page…</div>}
          <Ledger steps={steps} activeN={run.stepCount} />
          {gate && <ConfirmGate gate={gate} />}
        </>
      );
    case 'paused:gate':
      return (
        <>
          <Ledger steps={steps} activeN={run.stepCount} />
          {gate && <ConfirmGate gate={gate} />}
        </>
      );
    case 'paused:detached':
      return (
        <>
          <Ledger steps={steps} activeN={run.stepCount} />
          <div className="lead" style={{ marginBottom: 12 }}>Paused</div>
          <div className="alert" style={{ marginBottom: 18 }}>
            <p style={{ margin: 0, lineHeight: 1.55 }}>
              {run.detachReason === 'replaced_with_devtools'
                ? 'DevTools took over this tab, so the agent lost control.'
                : run.detachReason === 'target_closed'
                  ? 'The tab was closed, so the agent lost control.'
                  : 'The debugging bar was dismissed, so the agent lost control.'}
              {' '}Nothing was lost — it can pick up from step {run.stepCount}.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn--solid" onClick={() => void send({ type: 'run:resume', runId: run.id })}>Resume</button>
            <button className="btn btn--outline" onClick={() => void send({ type: 'run:stop', runId: run.id })}>Stop</button>
          </div>
        </>
      );
    case 'paused:credits':
      return <OutOfCredits run={run} />;
    case 'paused:auth':
      return (
        <>
          <Ledger steps={steps} activeN={run.stepCount} />
          <div className="lead" style={{ marginBottom: 12 }}>Sign-in needed</div>
          <p className="prose" style={{ color: 'var(--ink-60)', margin: '0 0 16px' }}>
            Your session expired. The run is paused at step {run.stepCount} and resumes once you sign in again.
          </p>
          <a className="btn btn--solid" href={chrome.runtime.getURL('options.html') + '#account'} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>Sign in</a>
        </>
      );
    case 'stopped:stuck':
      return <Stuck run={run} steps={steps} />;
    case 'complete':
      return <Complete run={run} />;
    default:
      return (
        <>
          <Ledger steps={steps} activeN={run.stepCount} />
          <div className="lead" style={{ margin: '12px 0 8px' }}>Stopped after {run.stepCount} steps</div>
          {run.error && <p className="prose" style={{ color: 'var(--ink-60)', margin: 0 }}>{run.error}</p>}
        </>
      );
  }
}

// The ledger (UI §9.2): gutter, mono indices/timestamps, tier dots, failures
// as first-class rows. aria-live polite; auto-scroll unless the user scrolled up.
function Ledger({ steps, activeN }: { steps: Step[]; activeN: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  useEffect(() => {
    if (pinned.current) ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [steps.length]);
  const [newBelow, setNewBelow] = useState(0);

  return (
    <div
      ref={ref}
      style={{ maxHeight: '60vh', overflowY: 'auto' }}
      onScroll={(e) => {
        const el = e.currentTarget;
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        if (pinned.current) setNewBelow(0);
      }}
    >
      <ul className="ledger" aria-live="polite">
        {steps.map((s) => (
          <li key={s.id} className={`step${s.n === activeN ? ' step--active' : ''} step--new`}>
            <div className="step__gutter" />
            <div className="step__content">
              {s.n > 0 && (
                <div className="step__head">
                  <span>{String(s.n).padStart(2, '0')}</span>
                  <span>{clockTime(s.ts)} {'·'.repeat(Math.min(Math.max(s.tier - 1, 1), 3))}</span>
                </div>
              )}
              <div className="step__action">
                {s.kind === 'action' ? <b>{s.verb}</b> : s.verb}
                {s.target ? ` ${s.target}` : ''}
              </div>
              {s.ref && <div className="step__ref">{s.ref}</div>}
              {s.note && <div className="step__note">{s.note}</div>}
            </div>
          </li>
        ))}
      </ul>
      {newBelow > 0 && <div className="mono meta">↓ {newBelow} new steps</div>}
    </div>
  );
}

// Confirm gate (UI §9.3): inline in the ledger, role=alertdialog, names the
// literal element, --alarm rule + "This can't be undone.", outcome-named
// buttons, no timeout, no default action. Enforced in code — this UI only
// renders what loop.ts already decided.
function ConfirmGate({ gate }: { gate: Gate }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector('button')?.focus();
  }, []);
  const resolve = (approved: boolean) => void send({ type: 'gate:resolve', gateId: gate.id, approved });

  return (
    <div className="gate" role="alertdialog" aria-label="Needs your approval" ref={ref}>
      <div className="gate__title">
        <span aria-hidden>⚠</span>
        <span>Needs your approval</span>
      </div>
      <div className="gate__detail">{gate.detail}</div>
      <div className="gate__ref">{gate.ref}</div>
      {gate.irreversible && <div className="gate__detail" style={{ marginBottom: 0 }}>This can&rsquo;t be undone.</div>}
      <div className="gate__rule" />
      <div className="gate__actions">
        <button className="btn btn--outline" style={{ flex: 1 }} onClick={() => resolve(true)}>{gate.approveLabel}</button>
        <button className="btn btn--ghost" style={{ flex: 1 }} onClick={() => resolve(false)}>{gate.stopLabel}</button>
      </div>
    </div>
  );
}

function Stuck({ run, steps }: { run: Run; steps: Step[] }) {
  const last = [...steps].reverse().find((s) => s.kind === 'failure');
  return (
    <>
      <Ledger steps={steps} activeN={run.stepCount} />
      <div className="lead" style={{ margin: '14px 0' }}>Stopped after {run.stepCount} steps</div>
      <div className="meta" style={{ marginBottom: 7 }}>What I tried</div>
      <div style={{ borderLeft: '2px solid var(--rule)', paddingLeft: 10, color: 'var(--ink-60)', lineHeight: 1.55, marginBottom: 16 }}>
        {last?.note ?? 'Looked for the element the task needs'}<br />
        Waited and retried
      </div>
      <div className="meta" style={{ marginBottom: 7 }}>What would help</div>
      <div style={{ lineHeight: 1.55, marginBottom: 18 }}>Show me where to click, or describe it differently.</div>
      <div style={{ display: 'flex', gap: 7 }}>
        <button className="btn btn--solid" onClick={() => void send({ type: 'run:show-me', runId: run.id }).catch(() => {})}>Show me</button>
        <button className="btn btn--outline" onClick={() => void send({ type: 'run:resume', runId: run.id }).catch(() => {})}>Rephrase</button>
        <button className="btn btn--ghost" onClick={() => window.close()}>Done</button>
      </div>
    </>
  );
}

function OutOfCredits({ run }: { run: Run }) {
  return (
    <>
      <div className="lead" style={{ marginBottom: 12 }}>You&rsquo;re out of credits</div>
      <p style={{ color: 'var(--ink-60)', lineHeight: 1.55, margin: '0 0 16px' }}>
        This run stopped at step {run.stepCount}. Nothing was lost — it resumes from there once you top up.
      </p>
      <a className="btn btn--solid btn--block" style={{ marginBottom: 8, textDecoration: 'none' }}
         href={chrome.runtime.getURL('options.html') + '#spending'} target="_blank" rel="noreferrer">Top up — 3,000 for $5</a>
      <a className="btn btn--outline btn--block" style={{ marginBottom: 16, textDecoration: 'none' }}
         href={chrome.runtime.getURL('options.html') + '#spending'} target="_blank" rel="noreferrer">Upgrade to Pro — 14,000/mo</a>
      <p style={{ color: 'var(--ink-60)', lineHeight: 1.55, margin: 0, paddingTop: 14, borderTop: '1px solid var(--rule)' }}>
        Or <b style={{ color: 'var(--ink)', fontWeight: 500 }}>use your own API key</b> and run without credits.
      </p>
    </>
  );
}

function Complete({ run }: { run: Run }) {
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span aria-hidden>✓</span>
        <span className="lead">Done</span>
      </div>
      <div className="mono meta" style={{ color: 'var(--ink-60)', marginBottom: 14 }}>
        {run.stepCount} steps · {duration(run.startedAt, run.endedAt)} · {run.creditsUsed} credits
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
        <a className="btn btn--outline btn--block" style={{ textDecoration: 'none' }}
           href={chrome.runtime.getURL('options.html') + '#runs'} target="_blank" rel="noreferrer">View full log</a>
      </div>
    </>
  );
}

// Blocked (UI §9.7): names the origin, notes it's revocable, lists what's
// already granted.
function Blocked({ run, origin }: { run: Run; origin: string }) {
  const [granted, setGranted] = useState<string[]>([]);
  useEffect(() => {
    void chrome.permissions.getAll().then((p) => setGranted(p.origins ?? []));
  }, []);
  const host = origin.replace(/^https?:\/\//, '').replace(/\/.*$/, '');

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span aria-hidden>🔒</span>
        <span className="lead">No access to this site</span>
      </div>
      <p style={{ lineHeight: 1.55, margin: '0 0 12px' }}>
        This task needs permission for <span className="mono" style={{ fontSize: 12 }}>{host}</span> before it can run.
      </p>
      <p style={{ color: 'var(--ink-60)', lineHeight: 1.55, margin: '0 0 18px' }}>You can revoke it any time in Settings.</p>
      <button
        className="btn btn--solid btn--block"
        style={{ marginBottom: 20 }}
        onClick={() => {
          void send<{ granted: boolean }>({ type: 'permissions:request', origin }).then((r) => {
            if (r.granted) void send({ type: 'run:resume', runId: run.id });
          });
        }}
      >Grant access</button>
      {granted.length > 0 && (
        <>
          <div className="meta" style={{ paddingTop: 14, borderTop: '1px solid var(--rule)', marginBottom: 8 }}>Already granted</div>
          <div className="mono meta" style={{ color: 'var(--ink-60)', lineHeight: 1.8 }}>
            {granted.map((o) => <div key={o}>{o.replace(/^https?:\/\//, '').replace(/\/$/, '')}</div>)}
          </div>
        </>
      )}
    </>
  );
}

function Footer({ run }: { run: Run }) {
  const meter = useMeter();
  const live = run.state === 'running' || run.state === 'planning';
  if (live) {
    return (
      <div className="panel__footer" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className="btn btn--solid" style={{ padding: '0 18px' }}
                onClick={() => void send({ type: 'run:stop', runId: run.id })}>Stop</button>
        <span className="mono meta">
          {run.stepCount === 0 ? 'not started' : `step ${run.stepCount} of ${run.maxSteps} · ${run.creditsUsed} credits`}
        </span>
      </div>
    );
  }
  return (
    <div className="panel__footer">
      <MeterStrip meter={meter} />
    </div>
  );
}

function MeterStrip({ meter }: { meter: ReturnType<typeof useMeter> }) {
  // Hosted credit balance is advisory from the entitlement (§8.1b); the
  // ledger server-side is authoritative. BYOK shows tokens + dollars, no bar.
  const mode = useLiveQuery(() => db.settings.get('llm.mode'), []);
  const hosted = useLiveQuery(() => db.settings.get('entitlement.creditsRemaining'), []);
  if (mode?.value === 'byok' && meter) {
    return (
      <div className="meter__label">
        {Math.round(meter.byokTokens / 1000)}K tokens · ${meter.byokCostUsd.toFixed(2)} this month<br />your key
      </div>
    );
  }
  const remaining = typeof hosted?.value === 'number' ? (hosted.value as number) : 500;
  return (
    <>
      <div className="meter__track"><div className="meter__fill" style={{ width: `${Math.min(100, (remaining / 500) * 100)}%` }} /></div>
      <div className="meter__label">
        {formatCredits(remaining)} of 500 trial credits<br />{tasksLeftEstimate(remaining, meter)}
      </div>
    </>
  );
}

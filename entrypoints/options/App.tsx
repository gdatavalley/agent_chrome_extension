// Options tab — nav + content capped 720px (UI §10). Eight sections mapping
// 1:1 to general spec §11, content inventories per UI §10.1.
// "Your data" is the flagship screen.
import { useEffect, useState } from 'react';
import {
  db, useLiveQuery, useMeter, useRunSteps, useBilling,
  duration, clockTime, creditHeadline, creditSubline,
} from '../../src/ui/shared';
import { send } from '../../src/shared/messages';
import {
  DEFAULT_GUARDRAILS, DEFAULT_MODEL, planLabel,
  type GuardrailDefaults, type KeyRecord, type ModelConfig,
} from '../../src/shared/types';
import { getSetting, setSetting } from '../../src/memory/db';
import { setLlmMode, type LlmMode } from '../../src/llm/resolve';

const SECTIONS = ['Runs', 'Guardrails', 'Sites', 'Keys', 'Models', 'Your data', 'Spending', 'Account'] as const;
type Section = (typeof SECTIONS)[number];

export function App() {
  // Hash is `#section` or `#runs:<runId>` — the panel's "View full log" deep
  // links straight to the ledger of the run you were watching.
  const [rawHash] = useState(() => location.hash.replace('#', ''));
  const [hashSection, deepLinkRunId] = rawHash.split(':');
  const [section, setSection] = useState<Section>(() => {
    const found = SECTIONS.find((s) => s.toLowerCase().replace(' ', '-') === hashSection);
    return found ?? 'Your data';
  });

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '32px 24px' }}>
      {/* The two full-tab surfaces only navigated one way, which is part of
          why Settings read as a dead end. */}
      <a
        href={chrome.runtime.getURL('tasks.html')}
        style={{ color: 'var(--ink-60)', textDecoration: 'none', display: 'inline-block', marginBottom: 18 }}
      >&larr; Tasks</a>
      <div className="options">
        <div className="nav">
          {SECTIONS.map((s) => (
            <div
              key={s}
              className={`nav__item${s === section ? ' nav__item--active' : ''}`}
              onClick={() => { setSection(s); history.replaceState(null, '', `#${s.toLowerCase().replace(' ', '-')}`); }}
            >{s}</div>
          ))}
        </div>
        <div className="options__content">
          {section === 'Runs' && <Runs initialRunId={deepLinkRunId} />}
          {section === 'Guardrails' && <Guardrails />}
          {section === 'Sites' && <Sites />}
          {section === 'Keys' && <Keys />}
          {section === 'Models' && <Models />}
          {section === 'Your data' && <YourData />}
          {section === 'Spending' && <Spending />}
          {section === 'Account' && <Account />}
        </div>
      </div>
    </div>
  );
}

// UI §10.1: "Row opens the full ledger." Viewable, never replayable — re-running
// a task lives in the Tasks tab.
function Runs({ initialRunId }: { initialRunId?: string }) {
  const runs = useLiveQuery(() => db.runs.toArray(), []);
  const tasks = useLiveQuery(() => db.tasks.toArray(), []);
  const [openId, setOpenId] = useState<string | undefined>(initialRunId);
  const [outcome, setOutcome] = useState<'all' | 'complete' | 'stopped' | 'paused'>('all');
  const titleFor = (taskId: string) => tasks?.find((t) => t.id === taskId)?.title ?? '(deleted task)';

  const shown = (runs ?? [])
    .filter((r) => outcome === 'all'
      || (outcome === 'complete' && r.state === 'complete')
      || (outcome === 'stopped' && r.state.startsWith('stopped:'))
      || (outcome === 'paused' && r.state.startsWith('paused:')))
    .sort((a, b) => b.startedAt - a.startedAt);

  return (
    <>
      <h3 className="h3" style={{ marginBottom: 10 }}>Runs</h3>
      <p className="prose" style={{ color: 'var(--ink-60)', margin: '0 0 14px' }}>
        Every run, viewable. Select one to read its full ledger. Re-running a task lives in the Tasks tab.
      </p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        {(['all', 'complete', 'stopped', 'paused'] as const).map((o) => (
          <button
            key={o}
            className={`btn ${outcome === o ? 'btn--outline' : 'btn--ghost'}`}
            onClick={() => setOutcome(o)}
          >{o}</button>
        ))}
      </div>
      {shown.length === 0 && (
        <p className="prose" style={{ color: 'var(--ink-60)' }}>
          {(runs ?? []).length === 0 ? 'No runs yet. They appear here after the first one.' : 'No runs match that filter.'}
        </p>
      )}
      {shown.map((r) => (
        <div key={r.id}>
          <div
            className="setting-row"
            style={{ gap: 12, cursor: 'pointer' }}
            role="button"
            tabIndex={0}
            aria-expanded={openId === r.id}
            onClick={() => setOpenId(openId === r.id ? undefined : r.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setOpenId(openId === r.id ? undefined : r.id);
              }
            }}
          >
            <span className="mono meta" aria-hidden>{openId === r.id ? '−' : '+'}</span>
            <span style={{ flex: 1 }}>{titleFor(r.taskId)}</span>
            <span className="mono meta">{new Date(r.startedAt).toLocaleDateString()}</span>
            <span className="mono meta">{r.stepCount} steps</span>
            <span className="mono meta">{r.creditsUsed} cr</span>
            <span className="mono meta">{r.state.replace('stopped:', '').replace('paused:', '')}</span>
          </div>
          {openId === r.id && <RunLedger runId={r.id} />}
        </div>
      ))}
    </>
  );
}

function RunLedger({ runId }: { runId: string }) {
  const steps = useRunSteps(runId);
  const run = useLiveQuery(() => db.runs.get(runId), [runId]);
  if (!steps) return null;
  if (steps.length === 0) {
    return <p className="prose" style={{ color: 'var(--ink-60)', padding: '10px 0' }}>This run recorded no steps.</p>;
  }
  return (
    <div style={{ padding: '10px 0 18px' }}>
      <ul className="ledger">
        {steps.map((s) => (
          <li key={s.id} className="step">
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
      {run && (
        <div className="mono meta" style={{ color: 'var(--ink-60)', marginTop: 10 }}>
          {run.stepCount} steps · {duration(run.startedAt, run.endedAt)} · {run.creditsUsed} credits
          {run.error ? ` · ${run.error}` : ''}
        </div>
      )}
    </div>
  );
}

function Guardrails() {
  const [g, setG] = useState<GuardrailDefaults | null>(null);
  useEffect(() => { void getSetting('guardrails', DEFAULT_GUARDRAILS).then(setG); }, []);
  if (!g) return null;
  const update = async (patch: Partial<GuardrailDefaults>) => {
    const next = { ...g, ...patch };
    setG(next);
    await setSetting('guardrails', next);
  };
  return (
    <>
      <h3 className="h3" style={{ marginBottom: 10 }}>Guardrails</h3>
      <p className="prose" style={{ color: 'var(--ink-60)', margin: '0 0 18px' }}>The default profile for new tasks.</p>
      <Row label="Read only" value={g.readOnly ? 'on' : 'off'} on={() => void update({ readOnly: !g.readOnly })} onState={g.readOnly} />
      <div className="setting-row">
        <span>Max steps</span>
        <span className="stepper">
          <input
            className="mono" aria-label="Max steps" type="number" min={1} max={200}
            value={g.maxSteps}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n) && n >= 1 && n <= 200) void update({ maxSteps: n });
            }}
            style={{ border: 'none', background: 'none', width: 48, font: 'inherit', color: 'inherit' }}
          />
        </span>
      </div>
      <Row label="New tabs" value={g.allowNewTabs ? 'on' : 'off'} on={() => void update({ allowNewTabs: !g.allowNewTabs })} onState={g.allowNewTabs} />
      <Row label="Navigate off-origin" value={g.allowOffOrigin ? 'on' : 'off'} on={() => void update({ allowOffOrigin: !g.allowOffOrigin })} onState={g.allowOffOrigin} />
      <Row label="Enter iframes" value={g.allowIframes ? 'on' : 'off'} on={() => void update({ allowIframes: !g.allowIframes })} onState={g.allowIframes} />
    </>
  );
}

function Row({ label, value, on, onState }: { label: string; value: string; on: () => void; onState: boolean }) {
  return (
    <div className="setting-row">
      <span>{label}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span className="mono meta">{value}</span>
        <button className={`toggle${onState ? ' toggle--on' : ''}`} style={{ border: 'none' }} onClick={on} aria-label={`${label} — ${value}`}>
          <span className="toggle__knob" />
        </button>
      </span>
    </div>
  );
}

// Sites must mirror chrome.permissions live — re-read on focus (UI §10.1).
function Sites() {
  const [origins, setOrigins] = useState<string[]>([]);
  const refresh = () => void chrome.permissions.getAll().then((p) => setOrigins(p.origins ?? []));
  useEffect(() => {
    refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);
  return (
    <>
      <h3 className="h3" style={{ marginBottom: 10 }}>Sites</h3>
      <p className="prose" style={{ color: 'var(--ink-60)', margin: '0 0 18px' }}>Origins the agent may work on. Revoking takes effect immediately.</p>
      {origins.length === 0 && <p className="prose" style={{ color: 'var(--ink-60)' }}>Nothing granted yet. The agent asks per site, the first time a task needs it.</p>}
      {origins.map((o) => (
        <div key={o} className="setting-row">
          <span className="mono" style={{ fontSize: 12 }}>{o.replace(/^https?:\/\//, '').replace(/\/$/, '')}</span>
          <button className="btn btn--danger" onClick={() => void send({ type: 'permissions:revoke', origin: o }).then(refresh)}>Revoke</button>
        </div>
      ))}
    </>
  );
}

function Keys() {
  const keys = useLiveQuery(() => db.keys.toArray(), []);
  return (
    <>
      <h3 className="h3" style={{ marginBottom: 10 }}>Keys</h3>
      <p className="prose" style={{ color: 'var(--ink-60)', margin: '0 0 18px' }}>
        Stored keys are never shown back. To rotate, add the new key and delete the old one.
      </p>
      {(keys ?? []).map((k) => <KeyRow key={k.id} rec={k} />)}
      <AddKey />
      <p className="prose" style={{ color: 'var(--ink-60)', marginTop: 18 }}>
        Mode: <ModeSwitcher />
      </p>
    </>
  );
}

function KeyRow({ rec }: { rec: KeyRecord }) {
  const [state, setState] = useState<'idle' | 'testing' | 'ok'>('idle');
  const [error, setError] = useState<string | null>(null);

  const test = () => {
    setState('testing');
    setError(null);
    void send({ type: 'keys:test', keyId: rec.id })
      .then(() => setState('ok'))
      .catch((err) => {
        setState('idle');
        setError(err instanceof Error ? err.message : String(err));
      });
  };

  return (
    <>
      <div className="setting-row">
        <span style={{ flex: 1 }}>{rec.provider}</span>
        <span className="mono meta">{rec.label}</span>
        <span className="mono meta">
          {rec.lastVerifiedAt ? `verified ${new Date(rec.lastVerifiedAt).toLocaleDateString()}` : 'unverified'}
        </span>
        <button className="btn btn--outline" onClick={test}>
          {state === 'testing' ? 'Testing…' : state === 'ok' ? 'Works' : 'Test'}
        </button>
        <button
          className="btn btn--danger"
          onClick={() => void send({ type: 'keys:delete', keyId: rec.id }).catch(() => db.keys.delete(rec.id))}
        >Delete</button>
      </div>
      {error && <div className="alert" style={{ marginBottom: 14 }}>{error}</div>}
    </>
  );
}

// Adding a key requests the provider's host permission inside the keys:add
// route, and that grant only sees this click's gesture while nothing has
// awaited yet — so send() is the first statement here, and the result is
// handled with .then rather than await to keep it that way.
function AddKey() {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    setBusy(true);
    setError(null);
    void send({ type: 'keys:add', provider: 'openai', key })
      .then(() => setKey(''))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  };

  return (
    <div style={{ borderTop: '1px solid var(--rule)', paddingTop: 16 }}>
      <div className="lead" style={{ fontSize: 13, marginBottom: 9 }}>Add an OpenAI key</div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <input
          className="input" type="password" aria-label="OpenAI API key" placeholder="sk-…"
          value={key} onChange={(e) => { setKey(e.target.value); setError(null); }}
        />
        <button className="btn btn--outline" style={{ flex: 'none' }} onClick={add}>
          {busy ? 'Verifying…' : 'Add'}
        </button>
      </div>
      <p className="prose" style={{ color: 'var(--ink-60)', margin: 0, fontSize: 13, maxWidth: '58ch' }}>
        The key is verified with a real one-token call before it&rsquo;s stored, encrypted on this
        machine with Web Crypto. Adding the first key switches the agent to your own key. Gemini
        keys aren&rsquo;t wired up yet.
      </p>
      {error && <div className="alert" style={{ marginTop: 12 }}>{error}</div>}
    </div>
  );
}

function ModeSwitcher() {
  const mode = useLiveQuery(async () => (await getSetting<LlmMode>('llm.mode', 'mock')), []);
  return (
    <select
      className="input" style={{ width: 220, display: 'inline-block' }}
      value={mode ?? 'mock'}
      onChange={(e) => void setLlmMode(e.target.value as LlmMode)}
      aria-label="LLM mode"
    >
      <option value="mock">mock (dev, no key)</option>
      <option value="byok">your own key</option>
      <option value="hosted">hosted credits</option>
    </select>
  );
}

function Models() {
  const [m, setM] = useState<ModelConfig | null>(null);
  useEffect(() => { void getSetting('model.config', DEFAULT_MODEL).then(setM); }, []);
  if (!m) return null;
  const update = async (patch: Partial<ModelConfig>) => {
    const next = { ...m, ...patch };
    setM(next);
    await setSetting('model.config', next);
  };
  return (
    <>
      <h3 className="h3" style={{ marginBottom: 10 }}>Models</h3>
      <p className="prose" style={{ color: 'var(--ink-60)', margin: '0 0 18px', maxWidth: '58ch' }}>
        One model serves every escalation tier. Set an id your provider account can reach — a key
        that tests as rejected is usually a model id the account can&rsquo;t use.
      </p>
      <div className="setting-row">
        <span>Model</span>
        <input
          className="input mono" style={{ width: 260, fontSize: 12 }} aria-label="Model id"
          value={m.model} onChange={(e) => void update({ model: e.target.value })}
        />
      </div>
      <div className="setting-row">
        <span>Reasoning effort</span>
        <select
          className="input" style={{ width: 130 }} aria-label="Reasoning effort"
          value={m.reasoningEffort}
          onChange={(e) => void update({ reasoningEffort: e.target.value as ModelConfig['reasoningEffort'] })}
        >
          <option value="low">low</option>
          <option value="medium">medium</option>
          <option value="high">high</option>
          <option value="off">off — don&rsquo;t send</option>
        </select>
      </div>
      <div className="setting-row"><span>Input / 1M</span><span className="mono meta">${m.inputPer1M.toFixed(2)}</span></div>
      <div className="setting-row"><span>Cached input / 1M</span><span className="mono meta">${m.cachedInputPer1M.toFixed(2)}</span></div>
      <div className="setting-row"><span>Output / 1M</span><span className="mono meta">${m.outputPer1M.toFixed(2)}</span></div>
      <p className="prose" style={{ color: 'var(--ink-60)', marginTop: 14, maxWidth: '58ch' }}>
        Output costs about 6x input and reasoning tokens bill as output, so anything above low
        multiplies what a run spends. Pick <span className="mono" style={{ fontSize: 12 }}>off</span> for
        models that reject the parameter.
      </p>
    </>
  );
}

// Your data — the flagship screen (UI §10). Per-site counts, per-site delete,
// full export, delete-all, and an explicit statement of what is never stored.
function YourData() {
  const memory = useLiveQuery(() => db.pageMemory.toArray(), []);
  const bySite = new Map<string, number>();
  for (const m of memory ?? []) bySite.set(m.origin, (bySite.get(m.origin) ?? 0) + 1);

  return (
    <>
      <h3 className="h3" style={{ marginBottom: 10 }}>Your data</h3>
      <p className="prose" style={{ color: 'var(--ink-60)', margin: '0 0 18px', maxWidth: '58ch' }}>
        The agent remembers the shape of pages it has used, so it works faster next time. This stays on your machine.
      </p>
      <div className="mono meta" style={{ color: 'var(--ink-60)', paddingBottom: 12, borderBottom: '1px solid var(--rule)' }}>
        {(memory ?? []).length} pages · {bySite.size} sites
      </div>
      {[...bySite.entries()].map(([origin, count]) => (
        <div key={origin} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--rule)' }}>
          <span>{origin.replace(/^https?:\/\//, '')}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span className="mono meta">{count}</span>
            <button className="btn btn--danger" onClick={() => void db.pageMemory.where('origin').equals(origin).delete()}>Forget</button>
          </span>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 9, margin: '18px 0 24px' }}>
        <button className="btn btn--outline" onClick={() => {
          void (async () => {
            const data = JSON.stringify(await db.pageMemory.toArray(), null, 2);
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
            a.download = 'page-memory.json';
            a.click();
          })();
        }}>Export everything</button>
        <button className="btn btn--danger" onClick={() => {
          if (confirm('Delete all remembered pages? The agent re-learns them on the next runs.')) {
            void db.pageMemory.clear();
          }
        }}>Delete all remembered pages</button>
      </div>
      <div style={{ borderTop: '1px solid var(--rule)', paddingTop: 14 }}>
        <div className="lead" style={{ fontSize: 13, marginBottom: 8 }}>What&rsquo;s never stored</div>
        <p className="prose" style={{ color: 'var(--ink-60)', margin: 0, maxWidth: '58ch' }}>
          Page text, form values, passwords, and anything matching a card or ID number. Only page structure and the steps that worked.
        </p>
      </div>
      <Telemetry />
    </>
  );
}

function Telemetry() {
  const [on, setOn] = useState(false);
  useEffect(() => { void getSetting('telemetry.optIn', false).then(setOn); }, []);
  return (
    <div style={{ borderTop: '1px solid var(--rule)', paddingTop: 14, marginTop: 24 }}>
      <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', cursor: 'pointer' }}>
        <input type="checkbox" checked={on} onChange={(e) => { setOn(e.target.checked); void setSetting('telemetry.optIn', e.target.checked); }} style={{ marginTop: 3 }} />
        <span>
          Share anonymous usage stats — run counts and credit totals, never page content, task text, or URLs.
        </span>
      </label>
    </div>
  );
}

// UI §5: credits users see credits; BYOK users see tokens and dollars, and get
// no bar because there is no cap to draw.
function Spending() {
  const meter = useMeter();
  const { mode, plan, remaining, allowance } = useBilling();

  if (mode === 'byok') {
    return (
      <>
        <h3 className="h3" style={{ marginBottom: 10 }}>Spending</h3>
        <p className="prose" style={{ color: 'var(--ink-60)', margin: '0 0 18px' }}>Your key, your bill with the provider. No cap from us, so no bar.</p>
        <div className="setting-row"><span>Tokens this month</span><span className="mono meta">{Math.round((meter?.byokTokens ?? 0) / 1000)}K</span></div>
        <div className="setting-row"><span>Estimated cost</span><span className="mono meta">${(meter?.byokCostUsd ?? 0).toFixed(2)}</span></div>
        <p className="prose" style={{ color: 'var(--ink-60)', marginTop: 14, maxWidth: '58ch' }}>
          Estimated from the token counts your provider returns, priced with the rates in Models.
          Your provider&rsquo;s own dashboard is the authority.
        </p>
      </>
    );
  }

  if (mode === 'mock') {
    return (
      <>
        <h3 className="h3" style={{ marginBottom: 10 }}>Spending</h3>
        <p className="prose" style={{ color: 'var(--ink-60)', margin: '0 0 18px', maxWidth: '58ch' }}>
          The agent is running against the built-in mock provider, so nothing is being spent. Add a
          key in Keys, or sign in for hosted credits.
        </p>
      </>
    );
  }

  return (
    <>
      <h3 className="h3" style={{ marginBottom: 10 }}>Spending</h3>
      <p className="prose" style={{ color: 'var(--ink-60)', margin: '0 0 18px' }}>Credit balance and history.</p>
      <div className="setting-row"><span>Plan</span><span className="mono meta">{plan}</span></div>
      <div className="setting-row">
        <span>Balance</span>
        <span className="mono meta">{creditHeadline(remaining, allowance)}</span>
      </div>
      <div className="setting-row">
        <span>Estimate</span>
        <span className="mono meta">{creditSubline(remaining, allowance, meter)}</span>
      </div>
      <div style={{ display: 'flex', gap: 9, marginTop: 18 }}>
        <button className="btn btn--solid" onClick={() => window.open('https://example.com/checkout?plan=topup', '_blank')}>Top up — 3,000 for $5</button>
        <button className="btn btn--outline" onClick={() => window.open('https://example.com/checkout?plan=pro', '_blank')}>Upgrade to Pro</button>
      </div>
    </>
  );
}

function Account() {
  const { mode, plan } = useBilling();
  return (
    <>
      <h3 className="h3" style={{ marginBottom: 10 }}>Account</h3>
      <p className="prose" style={{ color: 'var(--ink-60)', margin: '0 0 18px' }}>Subscription, top-ups, cancellation, and account deletion.</p>
      <div className="setting-row"><span>Plan</span><span className="mono meta">{planLabel(mode, plan)}</span></div>
      {mode === 'byok' && (
        <p className="prose" style={{ color: 'var(--ink-60)', margin: '12px 0 0', maxWidth: '58ch' }}>
          You&rsquo;re running on your own provider key, so there&rsquo;s no subscription here and
          nothing to cancel. Billing is between you and your provider.
        </p>
      )}
      <div style={{ borderTop: '1px solid var(--rule)', paddingTop: 18, marginTop: 18 }}>
        <div className="lead" style={{ fontSize: 13, marginBottom: 8 }}>Delete account</div>
        <p className="prose" style={{ color: 'var(--ink-60)', margin: '0 0 14px', maxWidth: '58ch' }}>
          Deletes your sign-in, runs history, page memory, keys, and credits. Credits are forfeit — that&rsquo;s stated here before you confirm, not after.
        </p>
        <button className="btn btn--danger" onClick={() => {
          if (confirm('Delete your account and everything on this machine? Credits are forfeit.')) {
            void (async () => {
              await Promise.all([db.runs.clear(), db.steps.clear(), db.gates.clear(), db.pageMemory.clear(), db.keys.clear(), db.audit.clear()]);
            })();
          }
        }}>Delete account</button>
      </div>
    </>
  );
}

// Options tab — nav + content capped 720px (UI §10). Eight sections mapping
// 1:1 to general spec §11, content inventories per UI §10.1.
// "Your data" is the flagship screen.
import { useEffect, useState } from 'react';
import { db, useLiveQuery, useMeter, duration } from '../../src/ui/shared';
import { send } from '../../src/shared/messages';
import { DEFAULT_GUARDRAILS, DEFAULT_MODEL, type GuardrailDefaults, type ModelConfig } from '../../src/shared/types';
import { getSetting, setSetting } from '../../src/memory/db';
import { setLlmMode, type LlmMode } from '../../src/llm/resolve';

const SECTIONS = ['Runs', 'Guardrails', 'Sites', 'Keys', 'Models', 'Your data', 'Spending', 'Account'] as const;
type Section = (typeof SECTIONS)[number];

export function App() {
  const [section, setSection] = useState<Section>(() => {
    const h = location.hash.replace('#', '');
    const found = SECTIONS.find((s) => s.toLowerCase().replace(' ', '-') === h);
    return found ?? 'Your data';
  });

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '32px 24px' }}>
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
          {section === 'Runs' && <Runs />}
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

function Runs() {
  const runs = useLiveQuery(() => db.runs.toArray(), []);
  const tasks = useLiveQuery(() => db.tasks.toArray(), []);
  const titleFor = (taskId: string) => tasks?.find((t) => t.id === taskId)?.title ?? '(deleted task)';
  return (
    <>
      <h3 className="h3" style={{ marginBottom: 10 }}>Runs</h3>
      <p className="prose" style={{ color: 'var(--ink-60)', margin: '0 0 18px' }}>Every run, viewable. Re-running a task lives in the Tasks tab.</p>
      {(runs ?? []).length === 0 && <p className="prose" style={{ color: 'var(--ink-60)' }}>No runs yet. They appear here after the first one.</p>}
      {(runs ?? []).sort((a, b) => b.startedAt - a.startedAt).map((r) => (
        <div key={r.id} className="setting-row" style={{ gap: 12 }}>
          <span style={{ flex: 1 }}>{titleFor(r.taskId)}</span>
          <span className="mono meta">{new Date(r.startedAt).toLocaleDateString()}</span>
          <span className="mono meta">{r.stepCount} steps</span>
          <span className="mono meta">{r.creditsUsed} cr</span>
          <span className="mono meta">{r.state.replace('stopped:', '').replace('paused:', '')}</span>
        </div>
      ))}
    </>
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
      <div className="setting-row"><span>Max steps</span><span className="stepper">{g.maxSteps}</span></div>
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
        Stored keys are never shown back. Add or rotate them from onboarding, or below.
      </p>
      {(keys ?? []).map((k) => (
        <div key={k.id} className="setting-row">
          <span>{k.provider}</span>
          <span className="mono meta">{k.label}</span>
          <span className="mono meta">{k.lastVerifiedAt ? `verified ${new Date(k.lastVerifiedAt).toLocaleDateString()}` : 'unverified'}</span>
          <button className="btn btn--danger" onClick={() => void send({ type: 'keys:delete', keyId: k.id }).catch(() => db.keys.delete(k.id))}>Delete</button>
        </div>
      ))}
      <p className="prose" style={{ color: 'var(--ink-60)', marginTop: 18 }}>
        Mode: <ModeSwitcher />
      </p>
    </>
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
  return (
    <>
      <h3 className="h3" style={{ marginBottom: 10 }}>Models</h3>
      <p className="prose" style={{ color: 'var(--ink-60)', margin: '0 0 18px' }}>
        One model serves every escalation tier. Mapping comes from remote config; override is advanced.
      </p>
      <div className="setting-row"><span>Model</span><span className="mono" style={{ fontSize: 12 }}>{m.model}</span></div>
      <div className="setting-row"><span>Input / 1M</span><span className="mono meta">${m.inputPer1M.toFixed(2)}</span></div>
      <div className="setting-row"><span>Cached input / 1M</span><span className="mono meta">${m.cachedInputPer1M.toFixed(2)}</span></div>
      <div className="setting-row"><span>Output / 1M</span><span className="mono meta">${m.outputPer1M.toFixed(2)}</span></div>
      <div className="setting-row"><span>Reasoning effort</span><span className="mono meta">{m.reasoningEffort}</span></div>
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

function Spending() {
  const meter = useMeter();
  const mode = useLiveQuery(() => getSetting<LlmMode>('llm.mode', 'mock'), []);
  const hosted = useLiveQuery(() => db.settings.get('entitlement.creditsRemaining'), []);
  if (mode === 'byok') {
    return (
      <>
        <h3 className="h3" style={{ marginBottom: 10 }}>Spending</h3>
        <p className="prose" style={{ color: 'var(--ink-60)', margin: '0 0 18px' }}>Your key, your bill with the provider. No cap from us, so no bar.</p>
        <div className="setting-row"><span>Tokens this month</span><span className="mono meta">{Math.round((meter?.byokTokens ?? 0) / 1000)}K</span></div>
        <div className="setting-row"><span>Estimated cost</span><span className="mono meta">${(meter?.byokCostUsd ?? 0).toFixed(2)}</span></div>
      </>
    );
  }
  const remaining = typeof hosted?.value === 'number' ? (hosted.value as number) : 500;
  return (
    <>
      <h3 className="h3" style={{ marginBottom: 10 }}>Spending</h3>
      <p className="prose" style={{ color: 'var(--ink-60)', margin: '0 0 18px' }}>Credit balance and history.</p>
      <div className="setting-row"><span>Balance</span><span className="mono meta">{remaining} of 500 trial credits</span></div>
      <div style={{ display: 'flex', gap: 9, marginTop: 18 }}>
        <button className="btn btn--solid" onClick={() => window.open('https://example.com/checkout?plan=topup', '_blank')}>Top up — 3,000 for $5</button>
        <button className="btn btn--outline" onClick={() => window.open('https://example.com/checkout?plan=pro', '_blank')}>Upgrade to Pro</button>
      </div>
    </>
  );
}

function Account() {
  return (
    <>
      <h3 className="h3" style={{ marginBottom: 10 }}>Account</h3>
      <p className="prose" style={{ color: 'var(--ink-60)', margin: '0 0 18px' }}>Subscription, top-ups, cancellation, and account deletion.</p>
      <div className="setting-row"><span>Plan</span><span className="mono meta">trial</span></div>
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

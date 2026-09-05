// Onboarding (UI spec §6): six steps, full tab, progress as plain `2 of 6`.
// Hosted path = device-code flow (spec §8.1b, UI §6.2c); BYOK = key entry
// with a real one-token test round trip and the mandatory Gemini free-tier
// warning (§6.2b, suppressed for EEA/CH/UK per spec §7.7).
import { useEffect, useState } from 'react';
import { send } from '../../src/shared/messages';
import { isEeaChUk } from '../../src/shared/crypto';
import { getSetting } from '../../src/memory/db';

type Path = 'hosted' | 'byok' | null;

export function App() {
  const [step, setStep] = useState(1);
  const [path, setPath] = useState<Path>(null);

  return (
    <div style={{ maxWidth: 560, margin: '48px auto', padding: '0 24px' }}>
      <div className="page page--onboarding" style={{ margin: '0 auto' }}>
        <div className="step-count mono">{step} of 6</div>
        {step === 1 && <Welcome onNext={() => setStep(2)} />}
        {step === 2 && <ProviderChoice onPick={(p) => { setPath(p); setStep(3); }} />}
        {step === 3 && path === 'hosted' && <HostedSignIn onDone={() => setStep(4)} />}
        {step === 3 && path === 'byok' && <KeyEntry onDone={() => setStep(4)} />}
        {step === 4 && <PermissionExplainer onNext={() => setStep(5)} />}
        {step === 5 && <FirstSite onNext={() => setStep(6)} />}
        {step === 6 && <Handoff />}
      </div>
    </div>
  );
}

function Welcome({ onNext }: { onNext: () => void }) {
  return (
    <>
      <h1 className="h1" style={{ margin: '20px 0 18px' }}>Your browser, working on its own</h1>
      <p className="prose" style={{ color: 'var(--ink-60)', fontSize: 15, margin: '0 0 12px' }}>
        Describe a task. The agent works through it in your own browser, using the accounts you&rsquo;re already signed in to.
      </p>
      <p className="prose" style={{ color: 'var(--ink-60)', fontSize: 15, margin: '0 0 24px' }}>
        It shows you every step and stops before anything it can&rsquo;t undo.
      </p>
      <button className="btn btn--solid" style={{ padding: '0 22px' }} onClick={onNext}>Get started</button>
    </>
  );
}

function ProviderChoice({ onPick }: { onPick: (p: 'hosted' | 'byok') => void }) {
  return (
    <>
      <h2 className="h2" style={{ margin: '18px 0 20px' }}>How should the agent get its intelligence?</h2>
      <div style={{ border: '1px solid var(--ink-35)', borderRadius: 'var(--r-card)', padding: 18, marginBottom: 16 }}>
        <div className="lead" style={{ marginBottom: 9 }}>We handle it</div>
        <p className="prose" style={{ color: 'var(--ink-60)', margin: '0 0 16px' }}>
          Nothing to set up, and 500 free credits to start — about six typical tasks. Page content passes through our servers to OpenAI, which doesn&rsquo;t train on API data.
        </p>
        <button className="btn btn--solid" style={{ padding: '0 22px' }} onClick={() => onPick('hosted')}>Continue</button>
      </div>
      <p className="prose" style={{ color: 'var(--ink-60)', margin: 0 }}>
        Already have an API key?{' '}
        <b style={{ color: 'var(--ink)', fontWeight: 500, cursor: 'pointer' }} onClick={() => onPick('byok')}>
          Use your own key instead
        </b>{' '}
        — free, and nothing passes through us.
      </p>
    </>
  );
}

// Hosted: device-code confirmation screen (UI §6.2c). The code is the hero;
// success advances without a button press — the poll resolving IS the confirmation.
function HostedSignIn({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState<string | null>(null);
  const [status, setStatus] = useState('Waiting for confirmation…');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const workerUrl = await getSetting('backend.workerUrl', 'http://localhost:8787');
        const res = await fetch(`${workerUrl}/auth/device`, { method: 'POST' });
        if (!res.ok) throw new Error(`server returned ${res.status}`);
        const { device_code, user_code, verify_url, interval, expires_in } = await res.json();
        if (cancelled) return;
        setCode(user_code);
        window.open(verify_url, '_blank');

        const deadline = Date.now() + expires_in * 1000;
        while (!cancelled && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, Math.max(2, interval) * 1000));
          const tok = await fetch(`${workerUrl}/auth/device/token`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ device_code }),
          });
          if (tok.status === 428) continue; // pending
          if (!tok.ok) throw new Error(`sign-in failed (${tok.status})`);
          const body = await tok.json();
          await send({ type: 'dev:report', payload: null }).catch(() => {}); // no-op keep-alive
          const { setSetting } = await import('../../src/memory/db');
          await setSetting('entitlement.accessToken', body.access_token);
          await setSetting('entitlement.refreshToken', body.refresh_token);
          await setSetting('entitlement.creditsRemaining', body.credits_remaining ?? 500);
          const { setLlmMode } = await import('../../src/llm/resolve');
          await setLlmMode('hosted');
          if (!cancelled) onDone();
          return;
        }
        if (!cancelled) setError('The code expired. Get a new one to try again.');
      } catch (err) {
        if (!cancelled) setError(`Couldn't reach the sign-in server — ${err instanceof Error ? err.message : String(err)}`);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <>
      <h2 className="h2" style={{ margin: '18px 0 20px' }}>Confirm your sign-in</h2>
      {error ? (
        <>
          <div className="alert" style={{ marginBottom: 16 }}>{error}</div>
          <button className="btn btn--solid" onClick={() => location.reload()}>Get a new code</button>
        </>
      ) : (
        <>
          <p className="prose" style={{ color: 'var(--ink-60)', fontSize: 15, margin: '0 0 20px' }}>
            A tab just opened — sign in there and enter this code.
          </p>
          <div className="mono" style={{ fontSize: 22, letterSpacing: 2, marginBottom: 16, userSelect: 'all' }}>
            {code ?? '········'}
          </div>
          <div className="mono meta" style={{ marginBottom: 20 }}>{status}</div>
          <button className="btn btn--ghost" onClick={() => window.open('https://example.com/verify', '_blank')}>Open the tab again</button>
        </>
      )}
    </>
  );
}

// BYOK: Test does a real one-token round trip; never accept an unverified key.
// Gemini selection adds the mandatory billing-enabled confirmation (§6.2b).
function KeyEntry({ onDone }: { onDone: () => void }) {
  const [provider, setProvider] = useState<'openai' | 'gemini'>('openai');
  const [key, setKey] = useState('');
  const [billingConfirmed, setBillingConfirmed] = useState(false);
  const [warned, setWarned] = useState(false);
  const [testing, setTesting] = useState(false);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eea = isEeaChUk();

  const needsGeminiConfirm = provider === 'gemini' && !eea;

  const test = async () => {
    setTesting(true);
    setError(null);
    try {
      await send({ type: 'keys:add', provider, key, billingEnabledConfirmed: billingConfirmed });
      setVerified(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTesting(false);
    }
  };

  const cont = () => {
    if (needsGeminiConfirm && !billingConfirmed && !warned) {
      setWarned(true); // re-surface the warning; the button never disables (§11)
      return;
    }
    onDone();
  };

  return (
    <>
      <h2 className="h2" style={{ margin: '18px 0 20px' }}>Your API key</h2>
      <div className="setting-row" style={{ borderTop: 'none' }}>
        <span>Provider</span>
        <select className="input" style={{ width: 180 }} value={provider} onChange={(e) => setProvider(e.target.value as 'openai' | 'gemini')} aria-label="Provider">
          <option value="openai">OpenAI</option>
          <option value="gemini">Google Gemini</option>
        </select>
      </div>
      <div style={{ display: 'flex', gap: 8, margin: '12px 0 16px' }}>
        <input className="input" type="password" aria-label="API key" value={key} onChange={(e) => { setKey(e.target.value); setVerified(false); }} placeholder="sk-…" />
        <button className="btn btn--outline" style={{ flex: 'none' }} disabled={testing || key.length < 8} onClick={() => void test()}>
          {testing ? 'Testing…' : verified ? 'Works' : 'Test'}
        </button>
      </div>
      {needsGeminiConfirm && (
        <>
          <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', marginBottom: 14, cursor: 'pointer' }}>
            <input type="checkbox" checked={billingConfirmed} onChange={(e) => setBillingConfirmed(e.target.checked)} style={{ marginTop: 3 }} />
            <span>This is a billing-enabled Google Cloud project</span>
          </label>
          {(warned || !billingConfirmed) && (
            <div className="alert" style={{ marginBottom: 20 }}>
              <div className="lead" style={{ fontSize: 13, marginBottom: 6 }}>Free Gemini keys aren&rsquo;t private</div>
              <p className="prose" style={{ color: 'var(--ink-60)', margin: 0 }}>
                On Google&rsquo;s free tier, page content the agent reads may be used to train Google&rsquo;s models, and reviewers may read it. Use a billing-enabled project.
              </p>
            </div>
          )}
        </>
      )}
      {error && <div className="alert" style={{ marginBottom: 16 }}>{error}</div>}
      <div style={{ background: 'var(--wash)', borderRadius: 'var(--r-ctrl)', padding: '12px 13px', marginBottom: 20 }}>
        <div className="lead" style={{ fontSize: 13, marginBottom: 6 }}>Where this is stored</div>
        <p className="prose" style={{ color: 'var(--ink-60)', margin: 0, fontSize: 13 }}>
          Encrypted on this machine with Web Crypto and never sent anywhere except the provider you chose. Clearing browser data removes it.
        </p>
      </div>
      <button className="btn btn--solid" style={{ padding: '0 22px' }} onClick={cont}>Continue</button>
      <button className="btn btn--ghost" style={{ marginLeft: 8 }} onClick={onDone}>Skip for now</button>
    </>
  );
}

function PermissionExplainer({ onNext }: { onNext: () => void }) {
  return (
    <>
      <h2 className="h2" style={{ margin: '18px 0 24px' }}>Two things Chrome will ask you about</h2>
      <div style={{ borderTop: '1px solid var(--rule)', paddingTop: 14, marginBottom: 22 }}>
        <div className="lead" style={{ marginBottom: 8 }}>Site access</div>
        <p className="prose" style={{ color: 'var(--ink-60)', margin: 0 }}>
          The agent needs permission for each site you use it on. You grant them one at a time, and you can revoke any of them later. We never ask for access to all sites.
        </p>
      </div>
      <div style={{ borderTop: '1px solid var(--rule)', paddingTop: 14, marginBottom: 24 }}>
        <div className="lead" style={{ marginBottom: 12 }}>The debugging banner</div>
        <div style={{ background: 'var(--wash)', border: '1px solid var(--rule)', borderRadius: 'var(--r-ctrl)', padding: '9px 12px', display: 'flex', alignItems: 'center', gap: 9, marginBottom: 13 }}>
          <span aria-hidden>ℹ</span>
          <span style={{ flex: 1 }}>Browser Agent started debugging this browser</span>
          <span className="muted">Cancel</span>
        </div>
        <p className="prose" style={{ color: 'var(--ink-60)', margin: 0 }}>
          Chrome shows this bar whenever the agent is controlling a page. It&rsquo;s how Chrome tells you something has real control — we can&rsquo;t hide it, and you shouldn&rsquo;t want us to. It disappears when the run ends.
        </p>
      </div>
      <button className="btn btn--solid" style={{ padding: '0 20px' }} onClick={onNext}>Makes sense</button>
    </>
  );
}

function FirstSite({ onNext }: { onNext: () => void }) {
  const [site, setSite] = useState('');
  const [currentOrigin, setCurrentOrigin] = useState<string | null>(null);
  const [useCurrent, setUseCurrent] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      const url = tabs[0]?.url;
      if (url && /^https?:/.test(url)) setCurrentOrigin(new URL(url).origin);
    });
  }, []);

  const grant = async () => {
    const raw = useCurrent && currentOrigin ? currentOrigin : site;
    let origin: string;
    try {
      origin = new URL(raw.startsWith('http') ? raw : `https://${raw}`).origin;
    } catch {
      setError('That doesn&rsquo;t look like a site URL.');
      return;
    }
    const pattern = `${origin}/*`;
    const r = await send<{ granted: boolean }>({ type: 'permissions:request', origin: pattern });
    if (r.granted) onNext();
    else setError('Chrome turned that down. You can grant it later from a task instead.');
  };

  return (
    <>
      <h2 className="h2" style={{ margin: '18px 0 18px' }}>Which site first?</h2>
      <input className="input" placeholder="https://" style={{ marginBottom: 12 }} aria-label="Site URL"
             value={site} onChange={(e) => { setSite(e.target.value); setUseCurrent(false); }} />
      {currentOrigin && (
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 20, cursor: 'pointer' }}>
          <input type="radio" name="site" checked={useCurrent} onChange={() => setUseCurrent(true)} />
          <span className="mono" style={{ fontSize: 12 }}>{currentOrigin.replace(/^https?:\/\//, '')}</span>
          <span className="meta">(this tab)</span>
        </label>
      )}
      {error && <div className="alert" style={{ marginBottom: 14 }}>{error}</div>}
      <button className="btn btn--solid" style={{ padding: '0 20px' }} onClick={() => void grant()}>Grant access</button>
      <button className="btn btn--ghost" style={{ marginLeft: 8 }} onClick={onNext}>Skip for now</button>
    </>
  );
}

function Handoff() {
  return (
    <>
      <h2 className="h2" style={{ margin: '18px 0 18px' }}>Ready</h2>
      <p className="prose" style={{ color: 'var(--ink-60)', margin: '0 0 12px' }}>
        Create your first task, then run it whenever you like.
      </p>
      <p className="prose" style={{ color: 'var(--ink-60)', margin: '0 0 24px' }}>
        Start with something small and reversible — reading and summarising rather than submitting.
      </p>
      <button
        className="btn btn--solid" style={{ padding: '0 20px' }}
        onClick={() => {
          void chrome.tabs.create({ url: chrome.runtime.getURL('tasks.html') });
          window.close();
        }}
      >Create a task</button>
    </>
  );
}

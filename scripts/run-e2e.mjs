// E2E orchestrator. Self-contained: starts the harness server if needed,
// launches the WXT dev runner, pushes scenario commands to the extension
// over CDP (no SW polling — MV3 kills idle service workers), and asserts on
// the extension's reports from the offscreen loop host.
//
//   default   read-write task completes: dismiss → click → paginate → done
//   stuck     [stuck] task hands off at tier 5 → stopped:stuck
//   gate      [gate] task parks on a confirm gate → approved → completes
//   readonly  [type] task in read-only mode → typing blocked → stuck
//
// Usage: node scripts/run-e2e.mjs [scenario|all]
import { spawn } from 'node:child_process';
import { existsSync, rmSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'node:net';

const RESULTS = resolve('spike-results.json');
const HARNESS = 'http://localhost:8899';
const SCENARIO = process.argv[2] ?? 'all';

// A free CDP port per run — fixed ports get squatted by zombie browsers.
const CDP_PORT = await new Promise((resolvePort) => {
  const srv = createServer();
  srv.listen(0, '127.0.0.1', () => {
    const port = srv.address().port;
    srv.close(() => resolvePort(port));
  });
});
const CDP = `http://127.0.0.1:${CDP_PORT}`;

const SCENARIOS = {
  default: {
    command: { kind: 'start', task: { title: 'Download invoices', site: `${HARNESS}/spike.html`, readOnly: false } },
    expect: (r) => r.run.state === 'complete' && r.run.creditsUsed > 0 && r.steps.some((s) => s.verb === 'Done'),
  },
  // Runs after "default" in the same browser session: the second run of the
  // same task replays the remembered path (tier 1) with zero model calls.
  replay: {
    command: { kind: 'start', task: { title: 'Download invoices', site: `${HARNESS}/spike.html`, readOnly: false } },
    expect: (r) =>
      r.run.state === 'complete' &&
      r.run.creditsUsed === 0 &&
      r.steps.some((s) => s.tier === 1) &&
      r.steps.some((s) => /Replaying a remembered path/.test(s.verb)),
  },
  escalate: {
    command: { kind: 'start', task: { title: '[escalate] Download invoices', site: `${HARNESS}/spike.html`, readOnly: false } },
    expect: (r) =>
      r.run.state === 'complete' &&
      r.steps.some((s) => s.tier === 3) &&
      r.steps.some((s) => /Escalated to a screenshot/.test(s.verb)),
  },
  stuck: {
    command: { kind: 'start', task: { title: '[stuck] Export the vendor list', site: `${HARNESS}/spike.html`, readOnly: false } },
    expect: (r) => r.run.state === 'stopped:stuck',
  },
  gate: {
    command: { kind: 'start', task: { title: '[gate] Delete old invoices', site: `${HARNESS}/spike.html`, readOnly: false } },
    waitFor: (r) => r.run.state === 'paused:gate' && r.gates.some((g) => g.status === 'pending'),
    then: { kind: 'approveGates' },
    expect: (r) => r.run.state === 'complete' && r.gates.some((g) => g.status === 'approved'),
  },
  readonly: {
    command: { kind: 'start', task: { title: '[type] Search vendor', site: `${HARNESS}/spike.html`, readOnly: true } },
    expect: (r) =>
      r.run.state === 'stopped:stuck' &&
      r.steps.some((s) => s.kind === 'failure' && /read-only/.test(s.note ?? '')),
  },
  // Real-model run against the OpenAI API (BYOK via WXT_OPENAI_API_KEY in
  // .env). Nondeterministic by nature: pass if the loop completes or hands
  // off cleanly, having spent real credits through the real usage path.
  // Gates are approved whenever they appear (they're the product working as
  // designed — "Apply filters" matches the form-submit pattern).
  real: {
    command: { kind: 'start', mode: 'byok', task: { title: 'Dismiss the cookie banner, then apply the filters', site: `${HARNESS}/spike.html`, readOnly: false } },
    waitFor: (r) => r.run.state === 'paused:gate' && r.gates.some((g) => g.status === 'pending'),
    then: { kind: 'approveGates' },
    expect: (r) =>
      (r.run.state === 'complete' || r.run.state === 'stopped:stuck') &&
      r.run.creditsUsed > 0 &&
      r.steps.some((s) => s.kind === 'action'),
  },
  // Marker — the hosted flow is bespoke (runHosted), not declarative.
  hosted: { command: { kind: 'stopAll' }, expect: () => true },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const killTree = (pid) => spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { shell: true });

// ---------------------------------------------------------------- server ---
let server = null;
async function ensureServer() {
  let health = await fetch(`${HARNESS}/health`).catch(() => null);
  if (health?.ok) return;
  server = spawn('node', ['scripts/serve.mjs']);
  for (let i = 0; i < 20 && !health?.ok; i++) {
    await sleep(250);
    health = await fetch(`${HARNESS}/health`).catch(() => null);
  }
  if (!health?.ok) throw new Error('could not start the harness server');
}

// ------------------------------------------------------------------- CDP ---
async function waitForCdp() {
  for (let i = 0; i < 60; i++) {
    const ok = await fetch(`${CDP}/json/version`).then((r) => r.ok).catch(() => false);
    if (ok) return;
    await sleep(500);
  }
  throw new Error(`CDP endpoint never came up on ${CDP_PORT}`);
}

// Stream console + exceptions from every extension target (SW, offscreen)
// so silent failures inside the extension are visible in the log.
const watchedTargets = new Set();
async function watchConsoles() {
  const attach = async (t) => {
    const key = t.id;
    if (watchedTargets.has(key)) return;
    watchedTargets.add(key);
    try {
      const ws = new WebSocket(t.webSocketDebuggerUrl);
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.method === 'Runtime.consoleAPICalled') {
          const text = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
          console.log(`[ext:${t.type === 'service_worker' ? 'sw' : 'off'}]`, text);
        } else if (msg.method === 'Runtime.exceptionThrown') {
          console.log(`[ext:${t.type === 'service_worker' ? 'sw' : 'off'}] EXCEPTION`,
            JSON.stringify(msg.params.exceptionDetails).slice(0, 600));
        }
      };
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));
    } catch { /* target gone */ }
  };
  const scan = async () => {
    try {
      const targets = await (await fetch(`${CDP}/json/list`)).json();
      for (const t of targets) {
        if (t.url?.startsWith('chrome-extension://')) await attach(t);
      }
    } catch { /* browser not up yet */ }
  };
  await scan();
  const timer = setInterval(scan, 3000);
  return () => clearInterval(timer);
}

// Push a command into the extension. In the SW we call the dev hook directly
// (runtime.sendMessage from the SW never loops back to its own listener);
// from any extension page, sendMessage wakes the SW and delivers normally.
async function pushCommand(command) {
  const targets = await (await fetch(`${CDP}/json/list`)).json();
  const ext = targets.filter((t) => t.url?.startsWith('chrome-extension://'));
  const sw = ext.find((t) => t.type === 'service_worker');
  const page = ext.find((t) => t.type === 'page');
  const target = sw ?? page;
  if (!target) throw new Error('no extension target to receive the command');

  const expression = sw
    ? `globalThis.__devCommand(${JSON.stringify(command)})`
    : `chrome.runtime.sendMessage({type:'dev:command', command:${JSON.stringify(command)}})`;

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  try {
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const result = await new Promise((resolveWs) => {
      const id = 1;
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id === id) resolveWs(msg.result ?? msg.error);
      };
      ws.send(JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true },
      }));
    });
    console.log('[e2e] pushCommand result:', JSON.stringify(result).slice(0, 500));
    return result;
  } finally {
    ws.close();
  }
}

// -------------------------------------------------------------- scenarios ---
async function runScenario(name) {
  const sc = SCENARIOS[name];
  if (!sc) throw new Error(`unknown scenario ${name}`);
  if (existsSync(RESULTS)) rmSync(RESULTS);

  await pushCommand(sc.command);
  console.log(`[e2e] scenario "${name}" started`);

  const deadline = Date.now() + 90_000;
  let approved = !sc.then;
  while (Date.now() < deadline) {
    if (existsSync(RESULTS)) {
      const report = JSON.parse(readFileSync(RESULTS, 'utf8'));
      if (report.run) {
        if (sc.then && sc.waitFor?.(report)) {
          await pushCommand(sc.then);
          console.log('[e2e] gate pending as expected — approving through gate:resolve');
          rmSync(RESULTS);
          approved = true;
          continue;
        }
        if (approved) {
          const pass = sc.expect(report);
          console.log(`[e2e] scenario "${name}": ${pass ? 'PASS' : 'FAIL'} (state=${report.run.state}, steps=${report.run.stepCount}, credits=${report.run.creditsUsed})`);
          if (!pass) console.log(JSON.stringify(report, null, 2).slice(0, 3000));
          return pass;
        }
      }
    }
    await sleep(700);
  }
  console.error(`[e2e] scenario "${name}": TIMEOUT`);
  return false;
}

// ---------------------------------------------------------- hosted flow ---
// Full M6 path against the local backend: device-code sign-in → hosted proxy
// run → exact debit → out-of-credits → top-up → resume → complete.
function unwrap(res) {
  return res?.result?.value?.result ?? res?.result?.value;
}

async function waitForReport(predicate, timeoutMs = 90_000, autoApprove = false) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(RESULTS)) {
      const report = JSON.parse(readFileSync(RESULTS, 'utf8'));
      if (report.run) {
        if (autoApprove && report.run.state === 'paused:gate' && report.gates.some((g) => g.status === 'pending')) {
          await pushCommand({ kind: 'approveGates' });
          rmSync(RESULTS);
          continue;
        }
        if (predicate(report)) return report;
      }
    }
    await sleep(700);
  }
  return null;
}

async function runHosted() {
  const backend = spawn('npx', ['tsx', 'src/dev.ts'], { cwd: resolve('backend'), shell: true });
  backend.stdout.on('data', (d) => process.stdout.write(String(d).replace(/^/gm, '[api] ')));
  backend.stderr.on('data', (d) => process.stdout.write(String(d).replace(/^/gm, '[api!] ')));
  let pass = true;
  try {
    let up = false;
    for (let i = 0; i < 40 && !up; i++) {
      up = await fetch('http://localhost:8787/health').then((r) => r.ok).catch(() => false);
      if (!up) await sleep(250);
    }
    if (!up) throw new Error('backend never came up on 8787');

    const signin = unwrap(await pushCommand({ kind: 'hostedSignin' }));
    const userId = signin.userId;
    console.log(`[e2e] hosted sign-in ok — trial balance ${signin.credits}`);

    // 1. A hosted run completes and the server debits exactly what the run metered.
    if (existsSync(RESULTS)) rmSync(RESULTS);
    await pushCommand({ kind: 'start', mode: 'hosted', task: { title: 'Dismiss the cookie banner, then apply the filters', site: `${HARNESS}/spike.html`, readOnly: false } });
    const done = await waitForReport((r) => ['complete', 'stopped:stuck'].includes(r.run.state), 120_000, true);
    const balance = await (await fetch(`http://localhost:8787/test/balance/${userId}`)).json();
    const debited = 500 - balance.balance;
    pass = pass && !!done && done.run.state === 'complete' && debited === done.run.creditsUsed;
    console.log(`[e2e] hosted run: state=${done?.run.state}, creditsUsed=${done?.run.creditsUsed}, serverDebit=${debited}`);

    // 2. Out of credits → paused:credits → top up → resume → completes (§9.7).
    await fetch('http://localhost:8787/test/credits', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user_id: userId, amount: -(balance.balance - 1) }),
    });
    rmSync(RESULTS);
    await pushCommand({ kind: 'start', mode: 'hosted', task: { title: 'Apply the filters', site: `${HARNESS}/spike.html`, readOnly: false } });
    const paused = await waitForReport((r) => r.run.state === 'paused:credits', 120_000, true);
    pass = pass && !!paused;
    console.log(`[e2e] out-of-credits pause: ${paused ? 'paused:credits as expected' : 'FAILED — never paused'}`);
    if (paused) {
      await fetch('http://localhost:8787/test/credits', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ user_id: userId, amount: 1000 }),
      });
      rmSync(RESULTS);
      await pushCommand({ kind: 'resumeLatest' });
      const resumed = await waitForReport((r) => r.run.state === 'complete', 120_000, true);
      pass = pass && !!resumed;
      console.log(`[e2e] top-up → resume: ${resumed ? 'complete' : 'FAILED'}`);
    }
  } catch (err) {
    console.error('[e2e] hosted scenario error:', String(err));
    pass = false;
  } finally {
    killTree(backend.pid);
  }
  console.log(`[e2e] scenario "hosted": ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

await ensureServer();

const wxt = spawn('npx', ['wxt'], {
  shell: true,
  env: { ...process.env, SPIKE_CDP_PORT: String(CDP_PORT) },
});
wxt.stdout.on('data', (d) => process.stdout.write(String(d).replace(/^/gm, '[wxt] ')));
wxt.stderr.on('data', (d) => process.stdout.write(String(d).replace(/^/gm, '[wxt!] ')));

await waitForCdp();
const stopWatching = await watchConsoles();
await sleep(4000); // SW + first paint settle

const names = SCENARIO === 'all' ? Object.keys(SCENARIOS) : [SCENARIO];
let allPass = true;
for (const name of names) {
  if (name === 'hosted') {
    allPass = (await runHosted()) && allPass;
  } else {
    allPass = (await runScenario(name)) && allPass;
  }
}

killTree(wxt.pid);
if (server) killTree(server.pid);
stopWatching();
console.log(`\n[e2e] ${allPass ? 'ALL SCENARIOS PASS' : 'FAILURES PRESENT'}`);
setTimeout(() => process.exit(allPass ? 0 : 1), 1500);

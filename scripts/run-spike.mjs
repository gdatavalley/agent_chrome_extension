// Spike orchestrator, fully self-contained: starts the report server if it
// isn't running, starts the WXT dev runner (which opens a managed browser
// with the extension loaded — the loading mechanism that works on Chrome 152
// stable, where --load-extension is ignored and CDP Extensions.loadUnpacked
// leaves MV3 service workers pending), waits for the extension's report,
// then tears everything down.
import { spawn } from 'node:child_process';
import { existsSync, rmSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const RESULTS = resolve('spike-results.json');
const TIMEOUT_MS = 120_000;

const killTree = (pid) =>
  spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { shell: true });

let server = null;
let health = await fetch('http://localhost:8899/health').catch(() => null);
if (!health?.ok) {
  server = spawn('node', ['scripts/serve.mjs']);
  server.stdout.on('data', (d) => process.stdout.write(String(d).replace(/^/gm, '[serve] ')));
  for (let i = 0; i < 20 && !health?.ok; i++) {
    await new Promise((r) => setTimeout(r, 250));
    health = await fetch('http://localhost:8899/health').catch(() => null);
  }
  if (!health?.ok) {
    console.error('could not start the report server');
    process.exit(1);
  }
}
if (existsSync(RESULTS)) rmSync(RESULTS);

const child = spawn('npx', ['wxt'], { shell: true });
const teardown = (code) => {
  killTree(child.pid);
  if (server) killTree(server.pid);
  setTimeout(() => process.exit(code), 1500);
};

child.stdout.on('data', (d) =>
  process.stdout.write(String(d).replace(/^/gm, '[wxt] ')),
);
child.stderr.on('data', (d) =>
  process.stdout.write(String(d).replace(/^/gm, '[wxt!] ')),
);

const deadline = Date.now() + TIMEOUT_MS;
while (Date.now() < deadline) {
  if (existsSync(RESULTS)) {
    console.log(readFileSync(RESULTS, 'utf8'));
    const ok = JSON.parse(readFileSync(RESULTS, 'utf8')).ok === true;
    teardown(ok ? 0 : 1);
    break;
  }
  await new Promise((r) => setTimeout(r, 1000));
}

if (!existsSync(RESULTS)) {
  console.error('timed out waiting for the extension report');
  teardown(1);
}

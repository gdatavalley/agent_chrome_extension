// Attach to the extension's service worker over CDP and stream its console.
// Usage: node scripts/sw-console.mjs [seconds] [expression-to-evaluate]
const PORT = 9223;

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const sw = list.find((t) => t.type === 'service_worker' && t.url.includes('background.js'));
if (!sw) {
  console.error('no service worker target found. Targets:', list.map((t) => `${t.type}:${t.url}`).join(', '));
  process.exit(1);
}
console.log('attached to', sw.url);

const ws = new WebSocket(sw.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const sendWs = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id).resolve(msg.result ?? msg.error);
    pending.delete(msg.id);
  } else if (msg.method === 'Runtime.consoleAPICalled') {
    const text = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
    console.log('[sw]', text);
  } else if (msg.method === 'Runtime.exceptionThrown') {
    console.log('[sw] EXCEPTION', msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
  }
};

await new Promise((r) => { ws.onopen = r; });
await sendWs('Runtime.enable');

const expr = process.argv[3];
if (expr) {
  const res = await sendWs('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  console.log('[eval]', JSON.stringify(res?.result?.value ?? res, null, 2));
}

const secs = Number(process.argv[2] ?? 20);
console.log(`listening for ${secs}s…`);
await new Promise((r) => setTimeout(r, secs * 1000));
ws.close();

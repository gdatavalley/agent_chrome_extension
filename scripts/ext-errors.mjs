// Open chrome://extensions in the runner browser and dump its text
// (shadow-pierced) to read extension load errors.
const list = await (await fetch('http://127.0.0.1:9223/json/list')).json();
const pageTarget = list.find((t) => t.type === 'page');
if (!pageTarget) {
  console.error('no page target');
  process.exit(1);
}
const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const sendWs = (method, params = {}) =>
  new Promise((resolve) => {
    const mid = ++id;
    pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg.result ?? msg.error);
    pending.delete(msg.id);
  }
};
await new Promise((r) => { ws.onopen = r; });
await sendWs('Page.enable');
await sendWs('Page.navigate', { url: 'chrome://extensions/' });
await new Promise((r) => setTimeout(r, 3000));

const res = await sendWs('Runtime.evaluate', {
  expression: `
    (function dump(root, out) {
      const els = root.querySelectorAll ? root.querySelectorAll('*') : [];
      for (const el of els) {
        if (el.shadowRoot) dump(el.shadowRoot, out);
        if (el.id === 'name' || el.id === 'errors-button' || el.id === 'error' || el.className === 'extension-errors' || el.id === 'icon') {
          const t = (el.textContent || '').trim().replace(/\\s+/g, ' ');
          if (t) out.push(el.id || el.className, '::', t.slice(0, 300));
        }
      }
      return out;
    })(document, []).join('\\n')
  `,
  returnByValue: true,
});
console.log(res?.result?.value ?? JSON.stringify(res).slice(0, 800));
ws.close();

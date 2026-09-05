import { defineConfig } from 'wxt';
import { readFileSync } from 'node:fs';

// Bridge a plain OPENAI_API_KEY in .env into the WXT_* channel Vite exposes
// to the bundle. DEV BUILDS ONLY — Vite inlines env vars, and a production
// bundle must never carry the key (keys belong in the encrypted store, §10.5).
if (process.env.NODE_ENV === 'development' && !process.env.WXT_OPENAI_API_KEY) {
  try {
    const m = readFileSync('.env', 'utf8').match(/^OPENAI_API_KEY=["']?([^"'\r\n]+)["']?\s*$/m)
      ?? readFileSync('.env', 'utf8').match(/^WXT_OPENAI_API_KEY=["']?([^"'\r\n]+)["']?\s*$/m);
    if (m?.[1]) process.env.WXT_OPENAI_API_KEY = m[1];
  } catch { /* no .env — mock mode still works */ }
}

// Manifest per spec §6.1. optional_host_permissions are requested per-site at
// runtime; host_permissions stays empty in production. Dev builds (wxt serve,
// NODE_ENV=development) get http://localhost/* so the E2E harness works.
const isDev = process.env.NODE_ENV === 'development';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  webExt: {
    chromiumArgs: [`--remote-debugging-port=${process.env.SPIKE_CDP_PORT ?? '9223'}`],
  },
  manifest: {
    name: 'Browser Agent (dev)',
    description: 'An AI agent that works through tasks in your own browser, showing every step.',
    minimum_chrome_version: '116',
    permissions: [
      'debugger', 'sidePanel', 'storage', 'unlimitedStorage',
      'tabs', 'scripting', 'offscreen', 'alarms', 'notifications',
    ],
    host_permissions: isDev ? ['http://localhost/*', 'https://api.openai.com/*'] : [],
    optional_host_permissions: ['https://*/*', 'http://localhost/*'],
    action: { default_title: 'Open tasks' },
    options_ui: { page: 'options.html', open_in_tab: true },
    commands: {
      'halt-agent': {
        suggested_key: { default: 'Ctrl+Shift+Period', mac: 'Command+Shift+Period' },
        description: 'Stop the agent immediately',
      },
    },
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
  },
});

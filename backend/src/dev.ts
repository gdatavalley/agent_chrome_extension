// Local dev server: the same hono app that runs on the Worker, backed by the
// in-memory store. OPENAI_API_KEY is read from the repo-root .env (never
// printed). Usage: npm run dev (in backend/).
import { serve } from '@hono/node-server';
import { readFileSync } from 'node:fs';
import { createApp } from './app';
import { MemoryStore } from './store';

function envKey(name: string): string {
  if (process.env[name]) return process.env[name]!;
  try {
    const m = readFileSync(new URL('../../.env', import.meta.url), 'utf8')
      .match(new RegExp(`^(?:WXT_)?${name}=["']?([^"'\\r\\n]+)["']?\\s*$`, 'm'));
    if (m?.[1]) return m[1];
  } catch { /* no .env */ }
  return '';
}

const app = createApp({
  store: new MemoryStore(),
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
  openAiKey: envKey('OPENAI_API_KEY'),
  verifyUrl: 'http://localhost:8787',
  environment: 'development',
});

serve({ fetch: app.fetch, port: 8787 }, (info) => {
  console.log(`[backend] dev server on http://localhost:${info.port}`);
});

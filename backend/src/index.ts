// Cloudflare Worker entry. Secrets come from bindings (wrangler secret put).
// The Supabase-backed store lands with deployment; until then this entry is
// for `wrangler dev` parity checks.
import { createApp } from './app';
import { MemoryStore } from './store';

interface Env {
  OPENAI_API_KEY: string;
  JWT_SECRET: string;
  ENVIRONMENT?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const app = createApp({
      store: new MemoryStore(), // TODO(deploy): Supabase store adapter
      jwtSecret: env.JWT_SECRET,
      openAiKey: env.OPENAI_API_KEY,
      environment: env.ENVIRONMENT === 'development' ? 'development' : 'production',
    });
    return app.fetch(request);
  },
};

// The hosted-tier backend (spec §8). One hono app, three runtimes:
// local dev server (dev.ts), vitest, and the Cloudflare Worker (index.ts).
//
// Routes:
//   POST /auth/device          — device-code start (§8.1b)
//   POST /auth/device/token    — extension polling (428 pending)
//   POST /auth/device/confirm  — web-app confirmation after sign-in
//   POST /auth/refresh         — rotating refresh
//   GET  /v1/me                — entitlement snapshot for the extension
//   POST /v1/chat/completions  — OpenAI proxy with atomic debit (§8.3)
//   GET  /config               — remote model/price config (§7.6)
//   POST /test/*               — dev-only helpers (ENVIRONMENT !== production)
//
// Logging discipline (§8.4): metadata only. Prompt content is NEVER logged.
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import type { Store } from './store';
import { issueTokenPair, rotateRefreshToken, verifyAccessToken } from './auth';
import { creditsFor, DEFAULT_PRICE, type PriceConfig, type UsageObject } from './meter';
import { RateLimiter, DEFAULT_QUOTA, type QuotaConfig } from './ratelimit';

export interface BackendConfig {
  store: Store;
  jwtSecret: string;
  openAiKey: string;
  openAiUrl?: string;
  verifyUrl?: string;
  price?: PriceConfig;
  quota?: QuotaConfig;
  environment?: 'development' | 'production';
  trialCredits?: number;
}

const DEVICE_CODE_TTL_MS = 10 * 60 * 1000;
const POLL_INTERVAL_S = 3;

function userCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const raw = [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

export function createApp(cfg: BackendConfig) {
  const app = new Hono();
  const limiter = new RateLimiter(cfg.quota ?? DEFAULT_QUOTA);
  const price = cfg.price ?? DEFAULT_PRICE;
  const openAiUrl = cfg.openAiUrl ?? 'https://api.openai.com/v1/chat/completions';
  const isDev = cfg.environment !== 'production';

  app.use('*', cors());

  app.get('/health', (c) => c.text('ok'));

  // ------------------------------------------------------------ auth ---
  app.post('/auth/device', async (c) => {
    const code = userCode();
    const row = await cfg.store.createDeviceCode(code, DEVICE_CODE_TTL_MS);
    return c.json({
      device_code: row.deviceCode,
      user_code: code,
      verify_url: `${cfg.verifyUrl ?? 'http://localhost:8787'}/verify?code=${code}`,
      interval: POLL_INTERVAL_S,
      expires_in: DEVICE_CODE_TTL_MS / 1000,
    });
  });

  app.post('/auth/device/token', async (c) => {
    const { device_code } = await c.req.json().catch(() => ({}));
    if (!device_code) return c.json({ error: 'device_code required' }, 400);
    const row = await cfg.store.getDeviceCode(device_code);
    if (!row || row.expiresAt < Date.now()) return c.json({ error: 'expired_token' }, 410);
    if (row.status === 'pending') return c.json({ error: 'authorization_pending' }, 428);
    if (row.status === 'consumed') return c.json({ error: 'invalid_grant' }, 400);

    await cfg.store.updateDeviceCode(device_code, { status: 'consumed' });
    const user = await cfg.store.getUser(row.userId!);
    if (!user) return c.json({ error: 'invalid_grant' }, 400);
    const balance = await cfg.store.getBalance(user.id);
    return c.json(await issueTokenPair(cfg.store, user, balance, cfg.jwtSecret));
  });

  // The web app's confirmation step. Production: after Supabase magic-link
  // sign-in. Local dev: email is accepted directly.
  app.post('/auth/device/confirm', async (c) => {
    const { user_code, email } = await c.req.json().catch(() => ({}));
    if (!user_code || !email) return c.json({ error: 'user_code and email required' }, 400);
    const row = await cfg.store.getDeviceCodeByUserCode(user_code);
    if (!row || row.expiresAt < Date.now() || row.status !== 'pending') {
      return c.json({ error: 'invalid or expired code' }, 400);
    }
    const user = await cfg.store.createUser(String(email));
    await cfg.store.updateDeviceCode(row.deviceCode, { status: 'confirmed', userId: user.id });
    return c.json({ confirmed: true });
  });

  app.post('/auth/refresh', async (c) => {
    const { refresh_token } = await c.req.json().catch(() => ({}));
    if (!refresh_token) return c.json({ error: 'refresh_token required' }, 400);
    const pair = await rotateRefreshToken(cfg.store, refresh_token, cfg.jwtSecret);
    if (!pair) return c.json({ error: 'invalid_grant' }, 401);
    return c.json(pair);
  });

  // --------------------------------------------------------- entitlement ---
  async function authed(c: Context) {
    const header = c.req.header('authorization') ?? '';
    const token = header.replace(/^Bearer\s+/i, '');
    if (!token) return null;
    return verifyAccessToken(token, cfg.jwtSecret);
  }

  app.get('/v1/me', async (c) => {
    const auth = await authed(c);
    if (!auth) return c.json({ error: 'unauthorized' }, 401);
    const balance = await cfg.store.getBalance(auth.sub);
    return c.json({ user_id: auth.sub, plan: balance.plan, credits_remaining: balance.balance });
  });

  app.get('/config', (c) => c.json(price));

  // ------------------------------------------------------------- proxy ---
  app.post('/v1/chat/completions', async (c) => {
    const auth = await authed(c);
    if (!auth) return c.json({ error: 'unauthorized' }, 401);

    const quota = limiter.checkRequest(auth.sub);
    if (!quota.allowed) return c.json({ error: quota.reason }, 429);

    const balance = await cfg.store.getBalance(auth.sub);
    if (balance.balance <= 0) {
      return c.json({ error: 'insufficient_credits', credits_remaining: 0 }, 402);
    }

    const body = await c.req.json();
    // The model string comes from remote config (§7.6), never the client.
    const upstream = { ...body, model: price.model, reasoning_effort: price.reasoningEffort };

    const t0 = Date.now();
    console.log('[proxy] → upstream call for user', auth.sub.slice(0, 8));
    const res = await fetch(openAiUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.openAiKey}` },
      body: JSON.stringify(upstream),
    });
    const latencyMs = Date.now() - t0;
    console.log('[proxy] ← upstream', res.status, 'in', latencyMs, 'ms');

    if (!res.ok) {
      // Upstream errors pass through with status but without our internals.
      return c.json({ error: `upstream ${res.status}` }, res.status === 401 ? 502 : res.status as 400);
    }

    const data = await res.json();
    const usage = (data.usage ?? { prompt_tokens: 0, completion_tokens: 0 }) as UsageObject;
    const credits = creditsFor(usage, price);

    // Atomic conditional debit (§8.3) — the only gate that matters.
    const newBalance = await cfg.store.debit(auth.sub, credits);
    if (newBalance === -1) {
      // Race between the balance pre-check and the debit: the inference is
      // spent but unpayable. Bill it to zero and stop the run honestly.
      await cfg.store.debit(auth.sub, balance.balance);
      return c.json({ error: 'insufficient_credits', credits_remaining: 0 }, 402);
    }

    const ceiling = limiter.recordCredits(auth.sub, credits);
    if (!ceiling.allowed) console.warn('daily ceiling tripped', { user: auth.sub });

    // Metadata only (§8.4) — never prompt content.
    await cfg.store.addLedger({
      userId: auth.sub, ts: Date.now(), model: price.model,
      promptTokens: usage.prompt_tokens,
      cachedTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
      completionTokens: usage.completion_tokens,
      credits, latencyMs,
    });

    return c.json(data);
  });

  // ------------------------------------------------------------ dev-only ---
  if (isDev) {
    // Instantly confirm a device code (skips the web-app round trip in E2E).
    app.post('/test/confirm', async (c) => {
      const { user_code } = await c.req.json().catch(() => ({}));
      const row = await cfg.store.getDeviceCodeByUserCode(user_code ?? '');
      if (!row || row.status !== 'pending') return c.json({ error: 'no pending code' }, 400);
      const user = await cfg.store.createUser('e2e@localhost.dev');
      await cfg.store.updateDeviceCode(row.deviceCode, { status: 'confirmed', userId: user.id });
      return c.json({ confirmed: true, user_id: user.id });
    });

    app.post('/test/credits', async (c) => {
      const { user_id, amount } = await c.req.json().catch(() => ({}));
      if (!user_id || typeof amount !== 'number') return c.json({ error: 'user_id and amount required' }, 400);
      const balance = await cfg.store.topUp(user_id, amount, 'test');
      return c.json({ balance });
    });

    app.get('/test/balance/:userId', async (c) => {
      const balance = await cfg.store.getBalance(c.req.param('userId'));
      return c.json(balance);
    });
  }

  return app;
}

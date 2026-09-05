// End-to-end app test: device-code sign-in → token → entitled proxy call →
// atomic debit → out-of-credits. The upstream OpenAI is a local stub.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createApp } from './app';
import { MemoryStore } from './store';

const FAKE_COMPLETION = {
  id: 'chatcmpl-test',
  choices: [{ message: { role: 'assistant', content: '{"action":"done","outcome":"ok"}' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 9000, completion_tokens: 60, prompt_tokens_details: { cached_tokens: 2000 } },
};

let upstream: Server;
let upstreamCalls: Array<Record<string, unknown>>;
let app: ReturnType<typeof createApp>;
let store: MemoryStore;

beforeAll(async () => {
  upstreamCalls = [];
  upstream = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      upstreamCalls.push(JSON.parse(body));
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(FAKE_COMPLETION));
    });
  });
  await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));

  store = new MemoryStore();
  app = createApp({
    store,
    jwtSecret: 'test-secret',
    openAiKey: 'fake-upstream-key',
    openAiUrl: `http://127.0.0.1:${(upstream.address() as { port: number }).port}/v1/chat/completions`,
    environment: 'development',
  });
});

afterAll(() => upstream.close());

async function signIn(): Promise<{ access: string; refresh: string; userId: string }> {
  const device = await (await app.request('http://x/auth/device', { method: 'POST' })).json();
  expect(device.user_code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);

  // Polling while pending returns 428.
  const pending = await app.request('http://x/auth/device/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ device_code: device.device_code }),
  });
  expect(pending.status).toBe(428);

  await app.request('http://x/test/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ user_code: device.user_code }),
  });

  const tokenRes = await app.request('http://x/auth/device/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ device_code: device.device_code }),
  });
  expect(tokenRes.status).toBe(200);
  const tokens = await tokenRes.json();
  const me = await (await app.request('http://x/v1/me', {
    headers: { authorization: `Bearer ${tokens.access_token}` },
  })).json();
  return { access: tokens.access_token, refresh: tokens.refresh_token, userId: me.user_id };
}

describe('hosted backend, end to end', () => {
  it('device-code sign-in issues tokens and trial balance', async () => {
    const { userId } = await signIn();
    const me = await store.getBalance(userId);
    expect(me.balance).toBe(500);
  });

  it('proxies a chat completion, pins the model server-side, and debits atomically', async () => {
    const { access, userId } = await signIn();
    const res = await app.request('http://x/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${access}` },
      body: JSON.stringify({ model: 'gpt-5.6', messages: [] }), // client model is ignored (§7.4)
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.choices[0].message.content).toContain('done');

    // The upstream received OUR pinned model, not the client's (§7.4 alias trap).
    expect(upstreamCalls[0]?.model).toBe('gpt-5.6-luna');
    expect(upstreamCalls[0]?.reasoning_effort).toBe('low');

    // 9000 in (2000 cached) + 60 out → ceil($0.001472*1000) = 2 credits.
    expect((await store.getBalance(userId)).balance).toBe(498);
    expect(store.ledgerRows).toHaveLength(1);
    expect(store.ledgerRows[0]?.credits).toBe(2);
  });

  it('returns 402 when the balance is exhausted', async () => {
    const { access, userId } = await signIn();
    const current = (await store.getBalance(userId)).balance;
    expect(await store.debit(userId, current)).toBe(0); // drain to zero
    const res = await app.request('http://x/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${access}` },
      body: JSON.stringify({ messages: [] }),
    });
    expect(res.status).toBe(402);
  });

  it('refresh rotates and the old refresh token is rejected on replay', async () => {
    const { refresh } = await signIn();
    const rotated = await app.request('http://x/auth/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: refresh }),
    });
    expect(rotated.status).toBe(200);

    const replay = await app.request('http://x/auth/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: refresh }),
    });
    expect(replay.status).toBe(401);
  });
});

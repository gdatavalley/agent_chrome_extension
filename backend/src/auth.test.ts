import { describe, it, expect } from 'vitest';
import { issueTokenPair, rotateRefreshToken, verifyAccessToken } from './auth';
import { MemoryStore } from './store';

const SECRET = 'test-secret';

async function setup() {
  const store = new MemoryStore();
  const user = await store.createUser('t@example.com');
  const balance = await store.getBalance(user.id);
  return { store, user, balance };
}

describe('entitlement tokens (§8.1b)', () => {
  it('issues a verifiable access token with the contract claims', async () => {
    const { store, user, balance } = await setup();
    const pair = await issueTokenPair(store, user, balance, SECRET);
    const claims = await verifyAccessToken(pair.access_token, SECRET);
    expect(claims?.sub).toBe(user.id);
    expect(pair.expires_in).toBe(900);
    expect(pair.credits_remaining).toBe(500);
  });

  it('rejects a token signed with a different secret', async () => {
    const { store, user, balance } = await setup();
    const pair = await issueTokenPair(store, user, balance, SECRET);
    expect(await verifyAccessToken(pair.access_token, 'wrong-secret')).toBeNull();
  });

  it('rotates refresh tokens — the presented token is consumed, the old one dies', async () => {
    const { store, user, balance } = await setup();
    const pair = await issueTokenPair(store, user, balance, SECRET);
    const rotated = await rotateRefreshToken(store, pair.refresh_token, SECRET);
    expect(rotated).not.toBeNull();
    expect(rotated!.refresh_token).not.toBe(pair.refresh_token);
    // Replay of the consumed token must fail.
    expect(await rotateRefreshToken(store, pair.refresh_token, SECRET)).toBeNull();
  });
});

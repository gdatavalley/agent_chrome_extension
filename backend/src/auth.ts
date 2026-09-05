// Entitlement tokens (spec §8.1b): 15-minute HS256 access JWT (memory-only
// on the client), 30-day rotating refresh token (hashed at rest here).
// Access-token claims: sub, plan, credits_remaining (advisory), exp, iat.
import { sign, verify } from 'hono/jwt';
import type { BalanceRow, Store, UserRow } from './store';

const ACCESS_TTL_S = 15 * 60;
const REFRESH_TTL_MS = 30 * 24 * 3600 * 1000;

export interface TokenPair {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  credits_remaining: number;
}

async function sha256hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function issueTokenPair(
  store: Store,
  user: UserRow,
  balance: BalanceRow,
  secret: string,
): Promise<TokenPair> {
  const now = Math.floor(Date.now() / 1000);
  const access = await sign(
    {
      sub: user.id,
      plan: balance.plan,
      credits_remaining: balance.balance, // advisory for UI — the ledger is authoritative
      iat: now,
      exp: now + ACCESS_TTL_S,
    },
    secret,
  );
  const refreshToken = crypto.randomUUID() + crypto.randomUUID();
  await store.createRefreshToken(user.id, await sha256hex(refreshToken), REFRESH_TTL_MS);
  return {
    access_token: access,
    token_type: 'Bearer',
    expires_in: ACCESS_TTL_S,
    refresh_token: refreshToken,
    credits_remaining: balance.balance,
  };
}

export async function rotateRefreshToken(
  store: Store,
  presented: string,
  secret: string,
): Promise<TokenPair | null> {
  const row = await store.consumeRefreshToken(await sha256hex(presented));
  if (!row) return null;
  const user = await store.getUser(row.userId);
  if (!user) return null;
  const balance = await store.getBalance(user.id);
  return issueTokenPair(store, user, balance, secret);
}

export async function verifyAccessToken(
  token: string,
  secret: string,
): Promise<{ sub: string; plan: string } | null> {
  try {
    const payload = await verify(token, secret, 'HS256');
    if (typeof payload.sub !== 'string') return null;
    return { sub: payload.sub, plan: typeof payload.plan === 'string' ? payload.plan : 'trial' };
  } catch {
    return null;
  }
}

// Hosted-tier entitlement (spec §8.1b). Access JWT lives in memory-backed
// settings with silent refresh; an expired refresh parks runs as paused:auth
// (§3.5), never discards a checkpoint.
import { getSetting, setSetting } from '../memory/db';
import { PausedError } from './router';

const REFRESH_MARGIN_MS = 30_000;

export async function workerUrl(): Promise<string> {
  return getSetting('backend.workerUrl', 'http://localhost:8787');
}

export async function ensureAccessToken(): Promise<string> {
  const access = await getSetting<string | null>('entitlement.accessToken', null);
  const expiresAt = await getSetting<number>('entitlement.expiresAt', 0);
  if (access && expiresAt > Date.now() + REFRESH_MARGIN_MS) return access;

  const refresh = await getSetting<string | null>('entitlement.refreshToken', null);
  if (!refresh) throw new PausedError('auth', 'not signed in');

  const res = await fetch(`${await workerUrl()}/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refresh_token: refresh }),
  });
  if (!res.ok) throw new PausedError('auth', 'session expired — sign in again');

  const body = await res.json();
  await storeTokenPair(body);
  return body.access_token as string;
}

export async function storeTokenPair(body: {
  access_token: string; refresh_token: string; expires_in: number; credits_remaining?: number;
}): Promise<void> {
  await setSetting('entitlement.accessToken', body.access_token);
  await setSetting('entitlement.refreshToken', body.refresh_token);
  await setSetting('entitlement.expiresAt', Date.now() + body.expires_in * 1000);
  if (typeof body.credits_remaining === 'number') {
    await setSetting('entitlement.creditsRemaining', body.credits_remaining);
  }
}

// Advisory snapshot for the meter (§8.1b: the server ledger is authoritative).
export async function refreshEntitlementSnapshot(): Promise<void> {
  const token = await ensureAccessToken();
  const res = await fetch(`${await workerUrl()}/v1/me`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.ok) {
    const me = await res.json();
    await setSetting('entitlement.creditsRemaining', me.credits_remaining);
  }
}

// Remote model/price config (§7.6) — a provider price change must not
// require a Web Store review cycle.
export async function fetchRemoteConfig(): Promise<void> {
  try {
    const res = await fetch(`${await workerUrl()}/config`);
    if (res.ok) await setSetting('model.config', await res.json());
  } catch { /* offline — defaults apply */ }
}

// Web Crypto key encryption (spec §10.5, §6.2 shared/crypto.ts).
// AES-GCM under a random 256-bit key that is generated non-extractable and
// persisted in IndexedDB via structured clone — the raw key material never
// touches disk as bytes and cannot be exported by casual inspection. This
// matches the onboarding copy: "Encrypted on this machine with Web Crypto."
import { db } from '../memory/db';

const SETTINGS_KEY = 'crypto:data-key';

async function dataKey(): Promise<CryptoKey> {
  const existing = await db.settings.get(SETTINGS_KEY);
  if (existing?.value) return existing.value as CryptoKey;
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  await db.settings.put({ key: SETTINGS_KEY, value: key });
  return key;
}

export async function encryptText(plaintext: string): Promise<{ ciphertext: number[]; iv: number[] }> {
  const key = await dataKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const buf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  return { ciphertext: [...new Uint8Array(buf)], iv: [...iv] };
}

export async function decryptText(ciphertext: number[], iv: number[]): Promise<string> {
  const key = await dataKey();
  const buf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(iv) },
    key,
    new Uint8Array(ciphertext),
  );
  return new TextDecoder().decode(buf);
}

// EEA/CH/UK detection for the Gemini free-tier warning (spec §7.7).
// Client-side and fail-safe: suppress only when BOTH timezone and locale
// region indicate EEA/CH/UK; on any doubt, show the warning.
const EEA_CH_UK_TIMEZONES = /^(Europe\/(London|Dublin|Lisbon|Madrid|Paris|Brussels|Amsterdam|Luxembourg|Berlin|Rome|Vienna|Zurich|Geneva|Stockholm|Oslo|Copenhagen|Helsinki|Warsaw|Prague|Bratislava|Budapest|Ljubljana|Zagreb|Vilnius|Riga|Tallinn|Athens|Nicosia|Valletta|Sofia|Bucharest|Reykjavik)|Atlantic\/(Canary|Faroe|Reykjavik))/i;
const EEA_CH_UK_REGIONS = new Set([
  'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IS','IE',
  'IT','LV','LI','LT','LU','MT','NL','NO','PL','PT','RO','SK','SI','ES','SE',
  'CH','GB',
]);

export function isEeaChUk(): boolean {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
    const region = (navigator.language.split('-')[1] ?? '').toUpperCase();
    return EEA_CH_UK_TIMEZONES.test(tz.replace(/\s/g, '')) && EEA_CH_UK_REGIONS.has(region);
  } catch {
    return false; // fail-safe toward showing
  }
}

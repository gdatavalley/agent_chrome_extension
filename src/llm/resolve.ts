// LLM provider resolution, shared by the offscreen loop host.
// Mode lives in settings: 'mock' (dev/harness, no key), 'byok' (direct to
// provider, §8.1), 'hosted' (via our Worker, §8.1). Model IDs and prices
// come from remote config with DEFAULT_MODEL as fallback (§7.6).
import { db, getSetting, setSetting } from '../memory/db';
import { decryptText } from '../shared/crypto';
import { DEFAULT_MODEL, type LLMProviderId, type ModelConfig } from '../shared/types';
import { mockProvider } from './providers/mock';
import { hostedProvider, openAiProvider, PausedError, type Provider } from './router';

export type LlmMode = 'mock' | 'byok' | 'hosted';

export interface ResolvedLlm {
  provider: Provider;
  model: ModelConfig;
  mode: LlmMode;
}

export async function resolveLlm(): Promise<ResolvedLlm> {
  const mode = await getSetting<LlmMode>('llm.mode', 'mock');
  const model = await getSetting<ModelConfig>('model.config', DEFAULT_MODEL);

  if (mode === 'mock') return { provider: mockProvider(), model, mode };

  if (mode === 'byok') {
    const rec = (await db.keys.toArray()).find((k) => k.provider === 'openai' || k.provider === 'gemini');
    const key = rec
      ? await decryptText(rec.ciphertext, rec.iv)
      : (import.meta.env.WXT_OPENAI_API_KEY as string | undefined);
    if (!key) throw new PausedError('auth', 'no API key stored (set one in Settings or WXT_OPENAI_API_KEY in .env)');
    return { provider: openAiProvider(key), model, mode };
  }

  // hosted
  try {
    const { ensureAccessToken } = await import('./entitlement');
    const token = await ensureAccessToken();
    const worker = await getSetting<string>('backend.workerUrl', 'http://localhost:8787');
    return { provider: hostedProvider(worker, token), model, mode };
  } catch (err) {
    if (err instanceof PausedError) throw err;
    throw new PausedError('auth', 'not signed in');
  }
}

export async function setLlmMode(mode: LlmMode): Promise<void> {
  await setSetting('llm.mode', mode);
}

export type { LLMProviderId };

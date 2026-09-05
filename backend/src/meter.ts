// Credit metering, mirroring the extension's creditsFor (spec §9.2).
// 1 credit = $0.001 of provider cost. Prices come from remote config (§7.6).
export interface PriceConfig {
  model: string;
  inputPer1M: number;
  cachedInputPer1M: number;
  outputPer1M: number;
  reasoningEffort: 'low' | 'medium' | 'high';
}

export const DEFAULT_PRICE: PriceConfig = {
  model: 'gpt-5.6-luna',
  inputPer1M: 0.2,
  cachedInputPer1M: 0.02,
  outputPer1M: 1.2,
  reasoningEffort: 'low',
};

export interface UsageObject {
  prompt_tokens: number;
  completion_tokens: number;
  prompt_tokens_details?: { cached_tokens?: number };
}

export function creditsFor(usage: UsageObject, price: PriceConfig = DEFAULT_PRICE): number {
  const cachedIn = usage.prompt_tokens_details?.cached_tokens ?? 0;
  const uncachedIn = usage.prompt_tokens - cachedIn;
  const costUsd =
    (uncachedIn / 1e6) * price.inputPer1M +
    (cachedIn / 1e6) * price.cachedInputPer1M +
    (usage.completion_tokens / 1e6) * price.outputPer1M;
  return Math.ceil(costUsd * 1000);
}

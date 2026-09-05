// The credit formula, verbatim from spec §9.2. 1 credit = $0.001 of provider
// cost. Prices come from remote config, never hard-coded (§7.6).
import type { ModelConfig, UsageObject } from './types';

export function creditsFor(usage: UsageObject, price: Pick<ModelConfig, 'inputPer1M' | 'cachedInputPer1M' | 'outputPer1M'>): number {
  const cachedIn = usage.prompt_tokens_details?.cached_tokens ?? 0;
  const uncachedIn = usage.prompt_tokens - cachedIn;

  const costUsd =
    (uncachedIn / 1e6) * price.inputPer1M +
    (cachedIn / 1e6) * price.cachedInputPer1M +
    (usage.completion_tokens / 1e6) * price.outputPer1M;

  return Math.ceil(costUsd * 1000);
}

export function usdFor(usage: UsageObject, price: Pick<ModelConfig, 'inputPer1M' | 'cachedInputPer1M' | 'outputPer1M'>): number {
  const cachedIn = usage.prompt_tokens_details?.cached_tokens ?? 0;
  const uncachedIn = usage.prompt_tokens - cachedIn;
  return (
    (uncachedIn / 1e6) * price.inputPer1M +
    (cachedIn / 1e6) * price.cachedInputPer1M +
    (usage.completion_tokens / 1e6) * price.outputPer1M
  );
}

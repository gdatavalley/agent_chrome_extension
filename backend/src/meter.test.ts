import { describe, it, expect } from 'vitest';
import { creditsFor, DEFAULT_PRICE } from './meter';

describe('creditsFor (spec §9.2)', () => {
  it('weights uncached input, cached input and output correctly', () => {
    // 1M uncached in ($0.20) + 1M cached in ($0.02) + 1M out ($1.20) = $1.42 → 1420 credits
    expect(creditsFor({
      prompt_tokens: 2_000_000,
      completion_tokens: 1_000_000,
      prompt_tokens_details: { cached_tokens: 1_000_000 },
    })).toBe(1420);
  });

  it('rounds up — partial cents always bill (a killed run pays for what it used)', () => {
    // 9000 in uncached ($0.0018) + 60 out ($0.000072) = $0.001872 → 2 credits
    expect(creditsFor({ prompt_tokens: 9000, completion_tokens: 60 })).toBe(2);
  });

  it('treats missing cached_tokens as zero', () => {
    expect(creditsFor({ prompt_tokens: 1_000_000, completion_tokens: 0 })).toBe(200);
  });

  it('is linear in output tokens (6x input rate)', () => {
    const one = creditsFor({ prompt_tokens: 0, completion_tokens: 1_000_000 });
    expect(one).toBe(1200);
  });

  it('respects price overrides from remote config (§7.6)', () => {
    expect(creditsFor(
      { prompt_tokens: 1_000_000, completion_tokens: 0 },
      { ...DEFAULT_PRICE, inputPer1M: 5.0 },
    )).toBe(5000);
  });
});

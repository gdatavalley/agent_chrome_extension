import { describe, it, expect } from 'vitest';
import { creditsFor, usdFor } from '../src/shared/meter';
import { DEFAULT_MODEL } from '../src/shared/types';

const price = DEFAULT_MODEL;

describe('creditsFor (extension copy, spec §9.2)', () => {
  it('weights uncached input, cached input and output correctly', () => {
    expect(creditsFor({
      prompt_tokens: 2_000_000,
      completion_tokens: 1_000_000,
      prompt_tokens_details: { cached_tokens: 1_000_000 },
    }, price)).toBe(1420);
  });

  it('rounds up — a killed run has already been billed for what it used', () => {
    expect(creditsFor({ prompt_tokens: 9000, completion_tokens: 60 }, price)).toBe(2);
  });

  it('treats missing cached_tokens as zero', () => {
    expect(creditsFor({ prompt_tokens: 1_000_000, completion_tokens: 0 }, price)).toBe(200);
  });

  it('usdFor and creditsFor agree (1 credit = $0.001)', () => {
    const usage = { prompt_tokens: 9000, completion_tokens: 60 };
    expect(Math.ceil(usdFor(usage, price) * 1000)).toBe(creditsFor(usage, price));
  });
});

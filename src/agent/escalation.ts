// The escalation ladder (spec §3). One perception layer with a verbosity
// dial — the model never changes between tiers, only how much we send.
// Tiers 3 and 1 land in Milestone 8; this module owns the state and the
// failure record, which is the most valuable thing in the retry prompt.

export type Tier = 1 | 2 | 3 | 4;

export interface FailureRecord {
  stepN: number;
  summary: string; // "tried 7, then 12, modal did not close"
}

export class Escalation {
  tier: Tier = 2;
  readonly failures: FailureRecord[] = [];
  private consecutiveMisses = 0;

  get misses(): number {
    return this.consecutiveMisses;
  }

  // Element not found / action had no effect at this tier.
  noteMiss(stepN: number, summary: string): void {
    this.failures.push({ stepN, summary });
    this.consecutiveMisses += 1;
  }

  noteSuccess(): void {
    this.consecutiveMisses = 0;
  }

  // Tier 2 → 3 after the first miss (M8): same element index, more signal.
  shouldEscalateToScreenshot(): boolean {
    return this.consecutiveMisses >= 1 && this.tier === 2;
  }

  // Hand off after two consecutive misses at the highest built tier.
  shouldHandOff(maxTier: Tier): boolean {
    return this.consecutiveMisses >= 2 && this.tier >= maxTier;
  }

  escalateTo(tier: Tier): void {
    this.tier = tier;
    this.consecutiveMisses = 0;
  }

  failurePrompt(): string {
    if (this.failures.length === 0) return '';
    const recent = this.failures.slice(-5).map((f) => `- step ${f.stepN}: ${f.summary}`).join('\n');
    return `Previous attempts that did not work:\n${recent}`;
  }
}

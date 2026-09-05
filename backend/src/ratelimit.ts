// Windowed per-user quotas (spec §8.3): independent of the monthly balance,
// plus a hard daily spend ceiling. In-memory sliding windows — for a single
// Worker isolate this is approximate by design; the balance debit is the
// authoritative limit, these are blast-radius caps.
export interface QuotaConfig {
  requestsPerHour: number;
  requestsPerDay: number;
  dailyCreditCeiling: number;
}

export const DEFAULT_QUOTA: QuotaConfig = {
  requestsPerHour: 500,
  requestsPerDay: 3000,
  dailyCreditCeiling: 5000,
};

interface Window { count: number; resetAt: number }

export class RateLimiter {
  private hourly = new Map<string, Window>();
  private daily = new Map<string, Window>();
  private dailyCredits = new Map<string, { credits: number; resetAt: number }>();

  constructor(private config: QuotaConfig = DEFAULT_QUOTA) {}

  private bump(map: Map<string, Window>, key: string, windowMs: number): number {
    const now = Date.now();
    const w = map.get(key);
    if (!w || w.resetAt < now) {
      map.set(key, { count: 1, resetAt: now + windowMs });
      return 1;
    }
    w.count += 1;
    return w.count;
  }

  checkRequest(userId: string): { allowed: boolean; reason?: string } {
    if (this.bump(this.hourly, userId, 3600_000) > this.config.requestsPerHour) {
      return { allowed: false, reason: 'hourly request quota exceeded' };
    }
    if (this.bump(this.daily, userId, 24 * 3600_000) > this.config.requestsPerDay) {
      return { allowed: false, reason: 'daily request quota exceeded' };
    }
    return { allowed: true };
  }

  recordCredits(userId: string, credits: number): { allowed: boolean; reason?: string } {
    const now = Date.now();
    const w = this.dailyCredits.get(userId);
    const next = !w || w.resetAt < now
      ? { credits, resetAt: now + 24 * 3600_000 }
      : { credits: w.credits + credits, resetAt: w.resetAt };
    this.dailyCredits.set(userId, next);
    if (next.credits > this.config.dailyCreditCeiling) {
      return { allowed: false, reason: 'daily spend ceiling reached' };
    }
    return { allowed: true };
  }
}

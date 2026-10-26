/**
 * Keeps each model under its requests-per-minute limit (Cerebras' free tier
 * allows about 5 per minute per model). Callers wait for a free slot instead
 * of being rejected, so jobs slow down rather than fail.
 */
export class RateLimiter {
  private readonly calls = new Map<string, number[]>();
  private readonly perMinute: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    perMinute: number,
    clock: { now?: () => number; sleep?: (ms: number) => Promise<void> } = {},
  ) {
    this.perMinute = perMinute;
    this.now = clock.now ?? Date.now;
    this.sleep = clock.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async acquire(key: string): Promise<void> {
    for (;;) {
      const now = this.now();
      const recent = (this.calls.get(key) ?? []).filter((t) => now - t < 60_000);
      if (recent.length < this.perMinute) {
        recent.push(now);
        this.calls.set(key, recent);
        return;
      }
      this.calls.set(key, recent);
      await this.sleep(60_000 - (now - (recent[0] ?? now)) + 50);
    }
  }
}

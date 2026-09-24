// Simple per-provider token-bucket rate limiter for AI calls.

class RateLimiter {
  private tokens: number;
  private lastRefill = Date.now();

  constructor(
    private readonly capacity: number,
    private readonly refillPerMinute: number,
  ) {
    this.tokens = capacity;
  }

  async acquire(): Promise<void> {
    for (;;) {
      const now = Date.now();
      const elapsed = now - this.lastRefill;
      this.tokens = Math.min(this.capacity, this.tokens + (elapsed * this.refillPerMinute) / 60_000);
      this.lastRefill = now;
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const waitMs = ((1 - this.tokens) / this.refillPerMinute) * 60_000;
      await new Promise((r) => setTimeout(r, Math.min(waitMs, 10_000)));
    }
  }
}

const limiters = new Map<string, RateLimiter>();

/** Per-provider limiter: 10 burst, 6/min sustained. */
export function getRateLimiter(providerId: string): RateLimiter {
  let l = limiters.get(providerId);
  if (!l) {
    l = new RateLimiter(10, 6);
    limiters.set(providerId, l);
  }
  return l;
}

// In-memory sliding window. DoS/noise hygiene only — NOT the security
// boundary (that's token entropy); resets on redeploy, per-instance.
export class SlidingWindowLimiter {
  // Insertion order doubles as touch-recency order: every `allow()` call
  // deletes-then-reinserts its key, so the first key in iteration order is
  // always the least-recently-touched — cheap LRU eviction via Map order.
  private hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys: number = 10_000,
  ) {}

  // Exposed for tests to assert the bound; not otherwise consumed.
  get size(): number {
    return this.hits.size;
  }

  allow(key: string, now: number = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    if (!this.hits.has(key) && this.hits.size >= this.maxKeys) {
      this.sweepAgedOut(cutoff);
      if (this.hits.size >= this.maxKeys) this.evictOldestTouched();
    }

    const kept = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    const allowed = kept.length < this.limit;
    if (allowed) kept.push(now);
    // Re-set (after delete, for keys that already existed) so this key
    // becomes the most-recently-touched for eviction purposes.
    this.hits.delete(key);
    this.hits.set(key, kept);
    return allowed;
  }

  // Drops every key whose hits are all outside the window as of `cutoff`.
  private sweepAgedOut(cutoff: number): void {
    for (const [k, timestamps] of this.hits) {
      if (timestamps.every((t) => t <= cutoff)) this.hits.delete(k);
    }
  }

  private evictOldestTouched(): void {
    const oldestKey = this.hits.keys().next().value;
    if (oldestKey !== undefined) this.hits.delete(oldestKey);
  }
}

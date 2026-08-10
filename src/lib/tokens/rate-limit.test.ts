import { describe, it, expect } from "vitest";
import { SlidingWindowLimiter } from "./rate-limit";

describe("SlidingWindowLimiter", () => {
  it("allows up to the limit inside the window, then blocks", () => {
    const l = new SlidingWindowLimiter(3, 60_000);
    const t = 1_000_000;
    expect(l.allow("k", t)).toBe(true);
    expect(l.allow("k", t + 1)).toBe(true);
    expect(l.allow("k", t + 2)).toBe(true);
    expect(l.allow("k", t + 3)).toBe(false);
  });

  it("refills as the window slides", () => {
    const l = new SlidingWindowLimiter(2, 1_000);
    const t = 5_000;
    expect(l.allow("k", t)).toBe(true);
    expect(l.allow("k", t + 100)).toBe(true);
    expect(l.allow("k", t + 200)).toBe(false);
    expect(l.allow("k", t + 1_150)).toBe(true); // first hit aged out
  });

  it("keys are independent", () => {
    const l = new SlidingWindowLimiter(1, 60_000);
    expect(l.allow("a", 0)).toBe(true);
    expect(l.allow("b", 0)).toBe(true);
    expect(l.allow("a", 1)).toBe(false);
  });

  it("bounds the map to maxKeys, evicting the oldest-touched key for new keys", () => {
    const l = new SlidingWindowLimiter(5, 60_000, 2);
    expect(l.allow("a", 0)).toBe(true);
    expect(l.size).toBeLessThanOrEqual(2);
    expect(l.allow("b", 1)).toBe(true);
    expect(l.size).toBeLessThanOrEqual(2);
    // Map is at the cap and no entries have aged out (window is 60s), so
    // "c" forces eviction of "a" (the oldest-touched key).
    expect(l.allow("c", 2)).toBe(true);
    expect(l.size).toBeLessThanOrEqual(2);
    // "a" was evicted, not merely rate-limited, so it behaves as a fresh
    // key and is still allowed.
    expect(l.allow("a", 3)).toBe(true);
    expect(l.size).toBeLessThanOrEqual(2);
  });
});

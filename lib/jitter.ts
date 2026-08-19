// SSI ask (2026-08-18): 20-30% jitter on refresh intervals so instances
// don't align their upstream calls on the same second. One-sided (only
// lengthens) so invariants like `redis TTL > freshness window` keep holding.

/** Returns `seconds` stretched by a random factor in [1, 1 + ratio]. */
export function withJitter(seconds: number, ratio = 0.25): number {
  return seconds * (1 + Math.random() * ratio);
}

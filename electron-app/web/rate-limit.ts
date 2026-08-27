/**
 * Tiny per-key sliding-window rate limiter (no external deps). Used on the
 * unauthenticated auth endpoints, keyed by client IP: brute force and account
 * enumeration get slow, normal users never notice. In-memory on purpose —
 * a restart resetting counters is harmless here.
 */
export type Limiter = (key: string) => boolean;

export function makeLimiter(max: number, windowMs: number): Limiter {
  const hits = new Map<string, number[]>();
  return (key) => {
    const now = Date.now();
    // Occasional sweep so idle keys don't accumulate forever.
    if (hits.size > 1000) {
      for (const [k, times] of hits) {
        if (times.every((t) => t <= now - windowMs)) hits.delete(k);
      }
    }
    const recent = (hits.get(key) ?? []).filter((t) => t > now - windowMs);
    if (recent.length >= max) {
      hits.set(key, recent);
      return false;
    }
    recent.push(now);
    hits.set(key, recent);
    return true;
  };
}

import type { Clock } from "../../lib/clock";

export interface PriceCache {
  /** Return the cached total for `key` if fresh, else run `compute` and cache its result. */
  get(key: string, compute: () => Promise<number>): Promise<number>;
}

interface CacheEntry {
  readonly value: number;
  readonly expiresAt: number;
}

const DEFAULT_TTL_MS = 60_000;

export function createPriceCache(clock: Clock, ttlMs: number = DEFAULT_TTL_MS): PriceCache {
  const entries = new Map<string, CacheEntry>();
  return {
    async get(key: string, compute: () => Promise<number>): Promise<number> {
      const hit = entries.get(key);
      if (hit !== undefined && hit.expiresAt > clock.now()) {
        return hit.value;
      }
      const value = await compute();
      entries.set(key, { value, expiresAt: clock.now() + ttlMs });
      return value;
    },
  };
}

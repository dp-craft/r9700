# Task: createLruCache (generic, TTL, LRU eviction)

Implement a generic LRU cache with per-entry TTL:

`createLruCache<K, V>(capacity: number, ttlMs: number, clock: Clock): LruCache<K, V>`

where the returned object satisfies:
```
interface LruCache<K, V> {
  get(key: K): V | undefined;   // undefined if absent OR expired; a live get() refreshes recency
  set(key: K, value: V): void;  // inserting beyond capacity evicts the least-recently-used live entry
  has(key: K): boolean;         // false for expired entries (must not resurrect them)
  readonly size: number;        // count of live (non-expired) entries
}
```
Semantics: an entry expires when `clock.now()` ≥ its insertion time + `ttlMs`. Expired entries must not
count toward `size`, must not be returned by `get`, and must not block eviction decisions.

Reuse the existing `Clock` interface from the codebase (`lib/clock`) — do NOT redefine a clock or call
`Date.now()` directly. Output exactly two files with `// FILE:` markers: `impl.ts` then `impl.test.ts`.

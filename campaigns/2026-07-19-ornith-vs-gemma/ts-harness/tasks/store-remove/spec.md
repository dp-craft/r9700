# Task: add Store.remove (keep the cached total consistent)

`createStore()` (see `store.ts`) keeps a list of entries AND a cached `Map` of per-key totals that `add`
maintains; `total(key)` reads the cache, `all()` returns the entries.

Add a `remove(key: string): void` method to the `Store` interface and its implementation: it deletes ALL
entries with the given key. It MUST keep everything consistent — after `remove(key)`, `total(key)` is 0,
the entries returned by `all()` no longer contain that key, and OTHER keys' totals are unchanged. Removing
a key that has no entries is a no-op.

Output the full new `// FILE: store.ts` and a `// FILE: store.test.ts` with tests for remove.

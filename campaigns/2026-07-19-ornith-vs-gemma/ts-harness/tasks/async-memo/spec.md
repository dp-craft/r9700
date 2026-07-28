# Task: fix createAsyncMemo (async dedup + don't cache failures)

The following async memoizer is buggy:
```ts
export function createAsyncMemo<K, V>(fn: (key: K) => Promise<V>): (key: K) => Promise<V> {
  const cache = new Map<K, Promise<V>>();
  return (key: K): Promise<V> => {
    if (cache.has(key)) return cache.get(key)!;
    const p = fn(key);
    cache.set(key, p);
    return p;
  };
}
```
Fix it so ALL of the following hold:
1. **Dedup:** concurrent calls for the same key share ONE in-flight computation — `fn` runs once.
2. **Don't cache failures:** if the computation REJECTS, it must not be cached — a later call retries `fn`.
3. **Cache successes:** once resolved, the value is reused — `fn` is not called again for that key.

Output exactly two files with `// FILE:` markers: `impl.ts` (the fixed `createAsyncMemo`) then `impl.test.ts`.

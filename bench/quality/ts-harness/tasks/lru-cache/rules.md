Rules (graded — from code-logic-writer.md):
- Reuse `Clock` from `../../lib/clock`; never call `Date.now()` in the logic.
- Strict generics; explicit return types on exported fns; `readonly` on the public `size`; NO `any`, no `!`.
- Keep every function under 20 lines — split eviction / expiry / recency into helpers.
- vitest tests only (no `jest.*`); BDD names `should <behavior> when <condition>`; inject a FAKE clock to
  drive TTL deterministically; cover eviction order, expiry, recency-refresh, and a capacity edge.

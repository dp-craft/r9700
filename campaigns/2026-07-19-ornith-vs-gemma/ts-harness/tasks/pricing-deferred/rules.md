Rules (graded — from code-logic-writer.md):
- Reuse `Clock` from `../../lib/clock`; never call `Date.now()` in the logic.
- `readonly` on interface/variant fields; NO `any`, no `!`; explicit return types; named constants (no magic numbers).
- Keep every function/method under 20 lines.
- Keep the exported names and the cached totals consistent — the pipeline must give the SAME answer with or without the cache (this is the point).
- vitest tests only (no `jest.*`); BDD names `should <behavior> when <condition>`; drive TTL with a FAKE clock, never real time.

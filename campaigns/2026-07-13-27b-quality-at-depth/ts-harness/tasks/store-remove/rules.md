Rules (graded — from code-logic-writer.md):
- `readonly` on interface fields; NO `any`, no `!`; explicit return types.
- Keep every function/method under 20 lines.
- Do not leave the cached totals stale — the entry list and the cache must stay in sync (this is the point).
- vitest tests only (no `jest.*`); BDD names `should <behavior> when <condition>`.

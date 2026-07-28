Rules (graded — from code-logic-writer.md):
- NO non-null `!` (the bug hint uses one — remove it); NO `any`; explicit return types on every function/arrow.
- Keep every function under 20 lines.
- vitest tests only (no `jest.*`); BDD names `should <behavior> when <condition>`; async tests must cover
  concurrent dedup, retry-after-rejection, and cache-hit-after-success.

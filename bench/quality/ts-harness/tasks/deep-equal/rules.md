Rules (graded — from code-logic-writer.md):
- NO `any` (inputs are `unknown` — use type guards); no non-null `!`; explicit return types.
- Keep every function under 20 lines.
- vitest tests only (no `jest.*`); BDD names `should <behavior> when <condition>`; cover NaN, nested
  structures, a key-count mismatch, and array-vs-object.

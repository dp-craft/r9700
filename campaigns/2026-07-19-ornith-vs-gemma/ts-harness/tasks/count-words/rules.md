Rules (from code-logic-writer.md — all checked by the grader):
- Reuse `normalizeToken` from lib/tokenize; do NOT reinvent normalization.
- Explicit return type on the exported function; `readonly`/`ReadonlyMap` output.
- No `any` (use `unknown` + guards); no non-null `!`.
- Keep the function under 20 lines.
- Tests: vitest only (no `jest.*`); BDD names `should <behavior> when <condition>`; AAA.

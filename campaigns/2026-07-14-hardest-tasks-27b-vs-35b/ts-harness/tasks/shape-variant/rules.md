Rules (graded — from code-logic-writer.md):
- Reuse the existing `assertNever` from `./shape`; keep every exhaustiveness `default`.
- NO `any`, no `!`; explicit return types; `readonly` on the new variant's fields.
- No magic numbers — name the `0.5` triangle-area factor as a `const`.
- Keep every function under 20 lines.
- vitest tests only (no `jest.*`); BDD names `should <behavior> when <condition>`.

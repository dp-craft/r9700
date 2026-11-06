Rules (graded — from code-logic-writer.md):
- NO `any`, no non-null `!`; explicit return types; `readonly` on the Result fields.
- Do NOT throw to the caller — return a Result. (Internal throw+catch is fine if it never escapes.)
- Keep every function under 20 lines — split tokenizing / expr / term / factor.
- No magic numbers beyond indices.
- vitest tests only (no `jest.*`); BDD names `should <behavior> when <condition>`; cover precedence,
  left-associativity, parentheses, and at least one error case.

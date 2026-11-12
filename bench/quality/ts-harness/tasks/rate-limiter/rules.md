Rules (graded — from code-logic-writer.md):
- Reuse `Clock` from `../../lib/clock`; never call `Date.now()`.
- Explicit return types; `readonly` where applicable; NO `any`, no `!`; named constants (no magic numbers).
- Keep every function under 20 lines — split refill from acquire.
- vitest only (no `jest.*`); BDD names `should <behavior> when <condition>`; inject a FAKE clock to drive
  refill deterministically; cover first-burst, lazy refill over time, empty-bucket rejection, and per-key isolation.

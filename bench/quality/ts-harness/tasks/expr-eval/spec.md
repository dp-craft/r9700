# Task: evaluate — a safe arithmetic expression evaluator

Implement `evaluate(expr: string): Result` where

```
type Result =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly error: string };
```

It evaluates integer arithmetic with `+ - * /`, parentheses, and arbitrary whitespace, using the usual
precedence (`*`/`/` bind tighter than `+`/`-`) and LEFT associativity (`10-3-2` is `5`, `8/2/2` is `2`).
On ANY malformed input — unbalanced parentheses, a missing operand, an unexpected character, or division
by zero — it must return `{ ok: false, error }` rather than throwing to the caller.

Output exactly two files with `// FILE:` markers: `impl.ts` (exporting `Result` and `evaluate`) then
`impl.test.ts`.

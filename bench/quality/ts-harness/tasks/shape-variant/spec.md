# Task: add a `triangle` variant to the Shape union (type propagation + a cross-cutting rule)

The codebase defines a discriminated union `Shape` (`shape.ts`) consumed by `area.ts`, `format.ts`, and
`scale.ts`, each of which switches on `shape.kind` with an exhaustiveness `default: assertNever(shape)`.

Make TWO changes:
1. Add a new variant `{ readonly kind: "triangle"; readonly base: number; readonly height: number }` to
   `Shape`, and handle it everywhere:
   - `area`  → `0.5 * base * height`
   - `format` → a string containing the word `triangle`
   - `scale` → scale `base` and `height` by the factor (return a triangle)
2. Add a cross-cutting rule to `scale` for ALL variants: if `factor` is negative, return the shape
   UNCHANGED (do not scale).

Every exhaustiveness check must stay satisfied so `tsc --strict` is clean, ALL existing tests must keep
passing, and the lint rules (below) must hold. Output the full new content of every file you change with
`// FILE: <name>` markers (`shape.ts`, `area.ts`, `format.ts`, `scale.ts`), plus a new `// FILE: shape.test.ts`
with tests for the triangle and the negative-factor rule.

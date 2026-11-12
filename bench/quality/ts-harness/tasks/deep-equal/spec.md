# Task: deepEqual — structural equality

Implement `deepEqual(a: unknown, b: unknown): boolean` — true iff `a` and `b` are structurally equal:
- primitives compare by value, and `NaN` equals `NaN`;
- objects/arrays compare recursively (same keys, deeply-equal values; same length for arrays);
- an array is NOT equal to a plain object even with matching indices;
- `null` is not equal to `{}`.

Inputs are `unknown` — you must narrow with type guards, not `any`. Output exactly two files with
`// FILE:` markers: `impl.ts` (exporting `deepEqual`) then `impl.test.ts`.

/**
 * Test serializer registry — see `docs/adrs/ADR-018-layered-test-strategy.md`.
 *
 * - `class-strip` is registered globally via `vite.config.ts`. It applies to
 *   every `toMatchSnapshot` / `toMatchInlineSnapshot` call on a DOM root.
 * - `ariaTree` is an opt-in helper for L2 container snapshots. Wrap the
 *   element in `ariaTree(...)` before asserting.
 */

export { ariaTree } from './aria-tree';
export { default as classStripSerializer } from './class-strip';

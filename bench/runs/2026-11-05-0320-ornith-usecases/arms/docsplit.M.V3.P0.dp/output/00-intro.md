<!-- meta
date: 2026-07-27
takeaway: runner-simplify harness change is **outcome-neutral** (119 runs); **between-block variance** outweighs every model/arm difference. Local default: `Brian6145/27B-Q4_K_M` for statement-driven work, `unsloth/35B-A3B-UD-Q4_K_M` for contract-/test-bearing work — complementary, not ranked. `ThinkingCap-27B-Q6_K_L` posted the best attempts/wall yet silently overwrote translations: **gate-green is not a quality proxy**.
-->

# runner-simplify validation + multi-model benchmark

Frozen 2026-07-27. One campaign, three questions: (a) did the three transferred `runner-simplify` commits change anything, (b) how do five local models compare on the same two workloads, and (c) how does any of it compare to the production Claude path.

**119 runner runs**: 10 × phase-1 (9 tasks each = 90) + 9 × T010 (n=3 = 27) + 2 salvaged T010 iterations. Plus **two Claude arms** on the same phase-1 task set (9 tasks each = 18 task-runs).

---


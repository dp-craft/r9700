# 2026-10-31-0000-agentic-thinking-volume

Campaign type `agentic`. README written by the 2026-11-06 repo restructure from the campaign's own files and its write-up; nothing here is reconstructed.

**Takeaway** (from the write-up): Q4_K_XL did not think less per step. Thinking per tool call was 3.0-3.6k chars in all four W2-08 arms (Q4 3,453; RedHat 1.8.1+sharp 3,043; 1.9.1+sharp 3,641; old template 3,154). Q4 took fewer steps (70 vs 80/100 tool calls) and read fewer distinct files (15 vs 18/25), and the two near-identical RedHat δ 0 runs already differ by 20% in steps, so at n = 1 no parameter can be blamed (W4 quantization does not lengthen reasoning, T1). Every run auto-compacted at 136-143k (Claude Code window 180000 × 85%, servers accept 260-262k), costing 327-614 s per run (10-22% of the window) and 109-122k tokens of context per event. Best levers: move the compaction window (speed + quality), spend the speed headroom on a second independent review (union +2…+5 weighted points, 3 runs → 29/38 vs best single 23), and fix three findings no config ever found in the review protocol. δ 0.3 decodes +51% (84.2 vs 55.8 tok/s), but its only run skipped the blind review (its 15.8% repeated-line signal is repeated import lines, not a loop; corrected 17:45).

- **Write-up:** [`2026-10-31-1640-agentic-thinking-volume-and-levers.md`](../../../docs/findings/agentic/2026-10-31-1640-agentic-thinking-volume-and-levers.md) · [`2026-10-31-1745-reasoning-replay-sharp-template-cactus-loops.md`](../../../docs/findings/agentic/2026-10-31-1745-reasoning-replay-sharp-template-cactus-loops.md)
- **Recipe (as run):** `loop_onset.py`, `thinking_digest.py`, `thinking_reuse.py`. The write-up's method section has the commands.
- **`results/`** — rows, summaries, charts (committed): `loop_onset.jsonl`, `thinking_digest.jsonl`, `thinking_reuse.jsonl`
- **Migrated from:** `bench/runs/2026-10-31-agentic-thinking-volume/`

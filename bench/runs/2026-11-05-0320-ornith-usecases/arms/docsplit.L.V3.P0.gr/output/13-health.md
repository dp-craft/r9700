## Health — GTT spill in all 14 cells, and the Q5 f16 question settled

**MEASURED (`vram_sampler.py` → `out/gpu_*.csv`, peaks reported by the digest):**

- **Peak VRAM: 27081–31918 MiB** of 32624 available. **Peak GTT: 1551–2841 MiB.**
- ⚠ **The digest flags GTT spill (>500 MiB) in all 14 cells** — including the lightest (the 35B-A3B at 27081 MiB VRAM, with 5.4 GiB of headroom, still spilling 1551 MiB). **It is therefore not simply "out of VRAM"**, and it is unexplained. On a 31 GB host with **no swap**, sustained GTT traffic is a freeze risk. **OPEN — this blocks unattended use of every configuration in this report.**
- **`Q5_K_M` at KV f16 and ctx 163840 fits — MEASURED, question settled.** `q5-d128-f16-rb16384` peaked at **31918 MiB** (97.8% of 32624) with **0 failures, 0 runaways, 0 grade errors**, and it is also the campaign's **steadiest cell** (rep sd 4.8). It was run deliberately without a pre-flight guard as a fail-fast probe (`README` §5b) and it did not fail. It confirms `CLAUDE.md` rule 13 with a measurement. It is also the **highest-GTT cell (2841 MiB)** — the fit is real, but it has no margin.
- **Runaway/truncation > 0 in exactly one cell:** `a3b-d128-f16-rbmax`, at 7% — the single 31,093-token reply discussed in Axis 2. Every other cell: 0%.
- **No failures and no `grade_error`/HARNESS rows anywhere.** The grader fix from `README` §3 (vitest single-process, fail-loud, pre-grade self-check) held across all 210 replies, so `tests` 0.84 and `edge` 0.87 are real numbers, not the previous campaign's harness artifact.

![Memory, power and thermal](charts/memory_power.svg)

> All 14 cells. MEASURED. Note the GTT bar is non-zero everywhere.

---


<!-- meta
date: 2026-07-16 09:27
takeaway: **Refutes the 27b-vs-35b campaign's `presence_penalty × MTP` mechanism.** Enabling ANY penalty sampler (presence/frequency/repeat) costs a **fixed ~2 ms/token of host work** — MEASURED at +1.95/+2.07/+1.97 ms/tok across 35B-MTP-on, 35B-MTP-off and 27B-dense — while draft acceptance is **unchanged** (`pp=0.01` emits a **sha1-identical** reply with identical 585/404 draft counts and still loses 29% decode). It is not a rejection effect and not an MTP interaction: MTP shortens the step (6.2 ms) so the same fixed tax eats −29% there vs −8% on the 27B's 17 ms step — **Amdahl, not interaction**. `min_p` is free; `top_k 40`/`top_p 1.0` are ~free. Also: `--spec-draft-n-max 3` (llama.cpp's default) is already optimal (n-max 8 → 80 t/s, *worse than MTP off*), **MTP is not output-preserving** (MTP on/off diverge at a fixed seed), and **MTP costs ~84 MiB GTT** — a lead on the campaign's unattributed spill.
-->

# Analysis: the penalty-sampler tax — what actually costs `presence_penalty` its 30% (and what MTP has to do with it) — R9700 (gfx1201)

- **Date:** 2026-07-16 09:27 · **Track:** engine-bench scouting probe (hand-driven; see *Tool gap* below)
- **GPU/Host:** AMD Radeon AI PRO R9700, 32624 MiB · `HSA_OVERRIDE_GFX_VERSION=12.0.1` · ROCm-SMI 7.8.0 · **Ryzen 5 3600 (6c/12t)**, 31 GB RAM, no swap
- **Runtime:** llama.cpp **b9950-961e4b26a** — Vulkan/RADV · `-ub 2048 -b 4096 -fa on -ngl 99 -np 1` · ctx **4096** · KV **f16** · seed **42**
- **Models:** `Qwen3.6-27B-MTP-Q4_K_M.gguf` (dense) · `Qwen3.6-35B-A3B-UD-Q4_K_M.gguf` (MoE) — **both carry an MTP head**
- **Data:** `bench/runs/2026-07-16-0927-mtp-sampler-probe/` — `results.jsonl` (26 rows), `meta.txt`, per-cell `gpu_*.csv`, regenerate with `./probe.sh`
- **Refutes:** `campaigns/2026-07-14-hardest-tasks-27b-vs-35b/analysis.md` § *The presence_penalty × MTP interaction — the sharpest unexplained result*

> ## ⚠ These are OTHER measurements — not reproducible within the 27b-vs-35b test set
> This is a **scouting probe at ctx 4096 on a ~24-token prompt with n=1** on most cells. The campaign
> ran at **~132.9k tokens, n=15/cell**. **Nothing here is a like-for-like re-measurement of a campaign
> cell, and no number here may be substituted into a campaign table.** What this probe *can* do —
> and does — is settle a **mechanism**, because its decisive cell (`pp=0.01`) emits a **byte-identical
> reply**, an outcome noise cannot manufacture. Magnitudes do **not** transfer: see *What this does not settle*.

---

## Summary — the answer in one table

The campaign published: *"`presence_penalty` re-weights logits after the draft was produced, so it systematically rejects draft tokens; rejection means the speculation is wasted."* **That mechanism is refuted.** Set `presence_penalty` to **0.01** — a value too small to change any token — and the model emits a **sha1-identical reply** from **identical draft counts**, and still loses **29% of decode**.

| cell (35B MoE, MTP on) | decode t/s | draft_n / accepted | acceptance | reply sha1 | verdict |
|---|--:|---|--:|---|---|
| `presence_penalty 0.0` (repA) | **161.1** | 585 / 404 | 69.06% | `30303b0c79da` | baseline |
| `presence_penalty 0.01` (repA) | **115.1** | **585 / 404** | **69.06%** | **`30303b0c79da`** | **identical output, −28.6%** |
| `presence_penalty 0.0` (repB) | 159.9 | 585 / 404 | 69.06% | `30303b0c79da` | noise ≈ 0.5% |
| `presence_penalty 0.01` (repB) | 115.1 | **585 / 404** | **69.06%** | **`30303b0c79da`** | replicates |
| `min_p 0.05` (control: non-penalty, also inert) | **161.2** | 585 / 404 | 68.5% | **`30303b0c79da`** | **identical output, free** |

Same tokens out. Same drafts accepted. 29% slower. Rejection cannot explain a cost incurred while **nothing was rejected** — and `min_p`, the control that is equally inert on the output, costs **nothing**. The discriminator is not "does the sampler perturb logits", it is **"is the penalties sampler switched on at all"**.

**MEASURED, the mechanism:** the penalties branch adds a **fixed ~2 ms/token of host work**, invariant across architecture and MTP.

| config | step time (pp off → on) | **Δ step** | **Δ host CPU** | decode | damage |
|---|---|--:|--:|---|--:|
| **27B dense**, MTP on | 16.97 → 18.43 ms | **+1.46 ms/tok** | **+1.97 ms/tok** | 58.9 → 54.2 | **−7.9%** |
| **35B MoE**, MTP **off** | 9.30 → 11.17 ms | **+1.88 ms/tok** | **+2.07 ms/tok** | 107.6 → 89.5 | **−16.8%** |
| **35B MoE**, MTP **on** | 6.21 → 8.69 ms | **+2.48 ms/tok** | **+1.95 ms/tok** | 161.1 → 115.1 | **−28.6%** |

**The Δ host CPU column is the finding: +1.97, +2.07, +1.95 ms/token.** One constant, three architectures.

### The consequence: it is Amdahl's law, not an MTP interaction

The campaign filed this under *"the presence_penalty × MTP interaction — the best hypothesis in the campaign"*. **There is no interaction.** A fixed ~2 ms tax lands on every token regardless of MTP. MTP's only role is to make the step *short* (6.2 ms), so the same constant eats a bigger fraction of it. The 27B looks immune (−8%) purely because its step is 17 ms. **The faster the decode, the worse `presence_penalty` looks — that is the whole effect.**

This inverts the campaign's generalization. It wrote: *"any sampler that perturbs logits silently taxes every MTP deployment."* The accurate statement is:

> **Enabling any penalty sampler adds a fixed per-token cost of host work. Its damage is proportional to how fast your step already is — so it is worst on fast GPUs, fast models, and speculative decoding, and it shrinks on faster host CPUs.** It is not about speculation and not about logit perturbation.

---

## What the GPU counters say — and what they do *not* say

The campaign's `gpu_*.csv` shows the pp cells at ~58% clock / ~62% power and this probe reproduces the pattern (sclk 3162 → 2084, power 220 → 146 W on the decisive pair). A natural reading is *"the decode loop goes CPU-bound and starves the GPU"*. **The CPU-bound half of that is wrong, and this probe can say so** because the extended sampler now records GPU busy% and the probe charges CPU-seconds to the request:

| cell | server CPU cores used | wall | GPU busy% | sclk | power |
|---|--:|--:|--:|--:|--:|
| `pp 0.0` (repA) | **0.64** | 3.86 s | 93.4% | 3162 | 220 W |
| `pp 0.01` (repA) | **0.69** | 5.27 s | 80.6% | 2084 | 146 W |

**The CPU is nowhere near saturated** — 0.69 of 12 threads. So this is not a CPU-bound host. The host work sits on the **critical path of a serial loop** (GPU forward → host sample → GPU forward), so ~2 ms of single-threaded sampler time lands directly on wall-clock even at 6% CPU utilization. The GPU then idle-waits, and the DPM governor drops sclk and power because **there is no work queued**. **The low clock is a consequence of the stall, not its cause** — which is exactly the ambiguity `sclk` alone could never resolve, and precisely why the sampler now records `gpu_busy_pct` (see *Tool changes*).

**This also excludes the session-degradation confound.** The campaign's two pp>0 cells were the last of a ~5-hour session, so "the box was just tired" was live. This probe ran them **fresh and interleaved** (`repA`, `repB` alternating with their controls) and reproduces the tax at full magnitude. Session degradation is **not** the explanation. *(It remains a candidate for part of the campaign's* larger *deep-context magnitude — see below.)*

---

## The two campaign claims that do not survive

**1. "The two presence_penalty presets are the campaign's floor — on quality."** Both pp>0 cells also run **temperature 1.0**, and `unsloth-reason` additionally moves `top_p 0.95→1.0` and `top_k 20→40`. Re-running the campaign's own paired tests against `t10` (temp 1.0, pp 0.0) — the single-variable control that was sitting in the data unused — splits it (MEASURED, `aggregate.py --baseline`, re-analysis, no GPU time):

| contrast | isolates | meanΔ | t | verdict |
|---|---|--:|--:|---|
| `qwen-gen` vs `t10` | **pp alone** | −6.3 | −0.54 | **ns** (sd 25.8) |
| `t10` vs `t06` | **temp alone** | −9.1 | −1.11 | **ns** |
| `qwen-gen` vs `t06` | temp + pp | −15.4 | −3.41 | **SIGNIFICANT** |

The **preset as a whole** is significantly worse than the coding recipe, but it splits ~−9 temp / ~−6 pp and **neither component is resolvable**. The actionable advice ("use Qwen's task-specific coding recipe") survives intact; the causal attribution to `presence_penalty` does not.

**2. "`unsloth-reason` is slower because pp 2.0 > pp 1.5."** Not supported. Sampler *width* is nearly free at this depth (MEASURED, 35B, MTP on, pp 0): `top_k 40` **160.8 t/s**, `top_p 1.0` **156.7**, both **156.5** — versus 161.1 baseline. And the pp ladder is **not monotone** (pp 0.5 → 114.0, pp 1.0 → 105.7, pp 1.5 → 109.1, pp 2.0 → 113.5, spread ≈ noise). The tax is a **step function at pp≠0**, not a dial. The campaign's 78.1-vs-72.6 gap between its two preset cells is **not** a penalty-magnitude effect.

**What survives untouched:** the *decode* finding itself (pp>0 really does cost ~30% on the fast MoE), and the top-line recommendation to use Qwen's documented coding recipe. Only the **mechanism** and the **causal attribution** change.

---

## `--spec-draft-n-max` — the headline MTP knob, first measurement on this box

MEASURED, 35B MoE, pp 0, ctx 4096, n=1:

| `--spec-draft-n-max` | decode t/s | acceptance | reply sha1 |
|--:|--:|--:|---|
| 1 | 134.7 | **86.0%** | `30303b0c79da` |
| 2 | 155.0 | 77.2% | `30303b0c79da` |
| **3 (llama.cpp default)** | **159.6** | 69.1% | `30303b0c79da` |
| 4 | 151.6 | 57.5% | `da766d274fa5` |
| 6 | 128.9 | 42.0% | `76134e4fa453` |
| 8 | **80.2** | 37.3% | `183430599685` |

- **The default is already optimal** at this depth. Acceptance falls monotonically with draft width, throughput peaks at 3, and **n-max 8 (80.2 t/s) is *worse than turning MTP off*** (107.6). Cheap insurance against "tuning" it upward.
- **`k = 3.00` draft tokens/pass, exactly, in all 14 campaign cells** (MEASURED, `outputs.jsonl`) — the MTP geometry model is clean and validates this reading.
- ⚠ **MTP is NOT output-preserving.** At a fixed seed, MTP off (`e40c532d`) and MTP on (`30303b0c`) emit **different text**, and n-max ≥ 4 diverges again per setting. Expected — speculation changes batch shape, and floating-point non-associativity under a changed reduction order is the known mechanism for inference non-determinism (CLAIMED, vLLM [#27433](https://github.com/vllm-project/vllm/issues/27433), **open**) — the same issue the campaign already cites. **Consequence: MTP is a quality-relevant knob, not a free speed knob.** All 14 campaign cells are MTP-on, so nothing *within* the campaign is confounded by this; but "MTP is free" is false in principle, and an MTP-off arm would not reproduce the campaign's replies.

---

## Memory — MEASURED (mandatory column)

Per-cell means over the active window, `bench/lib/vram_sampler.py`. **Idle GTT baseline on this box = 79 MiB.**

| config | GTT used (MiB, mean) | Δ vs idle | note |
|---|--:|--:|---|
| 35B MoE, **MTP off** | 144 – 146 | +66 | — |
| 35B MoE, **MTP on** | 224 – 234 | +150 | **+84 MiB attributable to MTP** |
| 27B dense, MTP on | 365 – 374 | +291 | — |

**This is a lead on the campaign's unattributed GTT spill** (its further-test #5 asks precisely for an "MTP on/off" bisect): **MTP costs ~84 MiB of GTT on the 35B** — the draft head's own buffers/KV. ⚠ But these are **ctx 4096** figures of a few hundred MiB; the campaign's spill is at **ctx 163840** and is a different magnitude. This narrows the suspect list; it does not close the item. VRAM is invariant across the sampler axis by construction (identical model/ctx/KV), so it carries no signal here and is omitted.

---

## What this does NOT settle

- **Magnitude at depth.** This probe measures **+2.0 ms/tok**; the campaign's deep cells imply **+4.16 ms/tok** (t10 115.7 → qwen-gen 78.1 t/s = 8.64 → 12.80 ms). Same sign, same order, **~2× apart**. Either depth roughly doubles the tax, or part of the campaign's gap is the session-degradation confound after all. **Unresolved — this is the reason to run the 133k depth-confirm.**
- **n=1 on most cells.** The mechanism rests on the sha1-identical pair (n=2, replicated), which is qualitative and safe. Every *magnitude* here is a single sample.
- **Host generality.** The ~2 ms/token is a **Ryzen 5 3600** number. It should shrink on a faster host and grow relative to a faster GPU. Untested — one data point, one box.
- **Why the penalties branch costs ~2 ms.** Inferred to be the per-position scan the penalties sampler performs over the 151k-token vocabulary (llama.cpp skips the branch entirely when all penalties are neutral). **Not verified** — that needs a profiler or the source, and this box has binaries only.
- **`--spec-draft-backend-sampling`.** Defaults to enabled, but `/props` reports `backend_sampling: false`. If draft sampling could actually be offloaded, it might cut the tax. **Untested — the most promising unexplored lever.**

---

## Tool gap and tool changes (iron rule 6)

**Gap, stated:** **no existing tool covers this probe.** `bench/engine-bench/openai_probe.py` — the registry's "probe a live server" tool — exposes `--temperature` only (no sampler axis), streams for concurrency waves, and **discards `timings.draft_n` / `draft_n_accepted`**. Nothing in the registry varies sampler parameters or reads speculation acceptance. Per rule 6(c) I therefore committed the probe as a **re-runnable script that regenerates its own data** (`probe.sh` + `row.py`), rather than transcribing numbers by hand — and I am **recommending the tool change rather than forking the logic**:

- **`openai_probe.py` should gain** a `--sampler '<json>'` passthrough and record `draft_n` / `draft_n_accepted` into `results.jsonl`. That is the correct long-term home; this run dir is a stopgap.

**Changed in this run (rule 6 — extend the tool, don't work around it):**

- **`bench/lib/vram_sampler.py` now records `mclk_mhz` and `gpu_busy_pct`** (`rocm-smi --showuse`; `utilization.gpu`/`clocks.mem` on NVIDIA), and reports both in the summary line. **This was load-bearing, not cosmetic:** `sclk` alone cannot distinguish a **downclocked** GPU (thermal/power limit; busy% stays high) from a **starved** one (host on the critical path; busy% and sclk both sag). The entire "CPU-bound" reading of the pp cells hinged on that distinction, and the old sampler could not make it.

**Correction to a claim made earlier in this investigation:** I asserted the harness "throws away the acceptance rate" and proposed teaching `capture.py` to record it. **That was wrong.** `capture.py` stores llama.cpp's whole `timings` blob verbatim, and `draft_n`/`draft_n_accepted` are present on **210/210** campaign rows. The gap is that **`aggregate.py` never surfaces them** — a reporting gap, not a capture gap. The campaign's "untested — one MTP-on/off run answers it" was **already answerable from data it had collected**.

---

## Provenance

- **MEASURED** — everything in the tables above, from `bench/runs/2026-07-16-0927-mtp-sampler-probe/results.jsonl` (26 rows, cite the row `label`) and, where stated, the 210 rows of `campaigns/2026-07-14-hardest-tasks-27b-vs-35b/out/outputs.jsonl`.
- **INFERRED** — the vocabulary-scan explanation for the ~2 ms; the Amdahl framing; the claim that the tax shrinks on faster hosts.
- **CLAIMED** — vLLM [#27433](https://github.com/vllm-project/vllm/issues/27433) (open) for batch-invariance as the known mechanism of inference non-determinism. Depth-scaling of MTP's benefit from `docs/analysis/2026-07-11-2200-deep-context-35b.md` (MEASURED, ours).

## Recommended next steps

1. **Depth-confirm at ~133k** — the one open question that changes a number. Cells: `{MTP on, off} × {pp 0.0, 0.01, 1.5}` plus `n-max {2,3,4}`, logging acceptance. Resolves the +2.0 vs +4.16 ms/tok gap **and** finishes off the session-degradation confound. *(This is the run worth GPU time.)*
2. **Extend `openai_probe.py`** with `--sampler` + acceptance capture, then retire `probe.sh` into it.
3. **Surface acceptance in `aggregate.py`** — the data is already on all 210 rows.
4. **Test `--no-spec-draft-backend-sampling`** — cheap, and the only plausible lever that could remove the tax.
5. **Do not** spend GPU on the campaign's proposed 4-cell `{MTP on/off} × {pp 0/1.5}` throughput run **as designed**. Throughput cannot separate rejection from overhead; acceptance rate does it in one request. That question is now answered.

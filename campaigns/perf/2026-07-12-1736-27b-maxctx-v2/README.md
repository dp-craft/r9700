> ⚠️ **CORRECTED / SUPERSEDED (2026-07-12).** This campaign's central premise was **wrong**.
> Qwen3.6-27B is a **hybrid** architecture — only **16 of its 65 blocks are full-attention** (the
> other 48 are SSM/Gated-DeltaNet linear-attention with a *fixed* state, no growing KV). So f16 KV is
> **64 KiB/tok, not 260**, and the model fits to **~240K (f16) / native 262K (q8_0)** in 32 GB — **200K
> and 230K DO fit** (MEASURED: 200K f16 = 29.0 GiB, loaded in 31 s). Everything below claiming "200K
> impossible / guard-skip" is the old error, kept only for the audit trail. Authoritative now:
> the hybrid-aware `bench/gguf_kv.py` and **`docs/plans/2026-07-12-27b-finetune-quality-tokens.md`**.

# 27B dense — max context by VRAM-logged sweep (measure-then-calculate) (R9700, 2026-07-12)

Scaffolded by `bench/gen_campaign.py`. The executable driver is **`run.sh`** in this folder
(resumable — per-probe markers in `done/`, rerun to continue). To regenerate `run.sh` after a spec
edit **without clobbering this README**, run `emit` *without* `--force`.

## Why this campaign (the question)
Successor to `2026-07-12-27b-maxctx-f16`, which pinned the 27B-dense ceilings but **captured no
VRAM** (the sampler was unwired) and never bracketed the top with a real OOM. This one answers
**"what is the true max context, with logged memory, staying strictly in VRAM?"** the way it was
asked: **measure a spread of depths that comfortably fit, log VRAM at each, then *calculate* the
exact max** from the measured VRAM-vs-ctx line — rather than blindly pushing a server past the edge.

## Method — measure-then-calculate (+ a hard VRAM-only guard)
- **Measured rungs** (all predicted **< 32400 MiB**, so they load with margin): f16 @ 32/48/56/60K,
  q8_0 @ 64/96/112/116K. Prompt is `codereview-8000.txt` (~8K) — small enough to fit the 32K slot,
  and since llama.cpp allocates the **full `-c` KV at load**, VRAM-at-load is identical to what a
  40K prompt would show (KV dominates; the ~8K prefill just confirms the server serves + gives a
  prefill/decode point). Fast: ~8K prefill ≈ a few seconds × 2 reps × 8 servers.
- **The pre-flight guard = the "GPU/VRAM-only" enforcement.** `VRAM_BUDGET_MIB` defaults to **32400**
  (physical VRAM is **32624 MiB**; idle GTT baseline ~77 MiB). Any server predicted above it is
  **SKIPPED before launch** → it can never allocate into GTT/system RAM and freeze the box. The
  sampler also logs **GTT** so the write-up can *prove* no host-RAM spill occurred (GTT stays ≈ its
  ~77 MiB baseline on a healthy run; a spill shows as GTT climbing hundreds–thousands of MiB).
- **Edge points** (skip at 32400, measurable at physical): f16 @ **64K** (32610 MiB), q8_0 @ **120K**
  (32530 MiB) — both **loaded in the prior campaign**; they sit just over the *safe* budget (at
  ~physical), so they skip here by design. To measure them directly, rerun with `VRAM_BUDGET_MIB=32624`.
- **Max-limit tests** (the "does 200K fit?" question — **guard-SKIPPED, never launched**, they print
  predicted VRAM as the answer): f16 @ **200K (67970 MiB)** / **230K (75770 MiB)**, q8_0 @ **200K
  (43570 MiB)** / **230K (47710 MiB)**. All 42–76 GiB — physically impossible on the 32 GB card, so
  the guard refuses them. See **§Why 200K can't fit** below. ⚠️ Do **not** force these with a raised
  budget: q8 @ 200K/230K (~26–30 GiB KV) could partially spill into GTT and thrash/freeze the box —
  the exact failure the guard exists to prevent. The f16 ones (~50–57 GiB KV) exceed even VRAM+RAM
  and would fail cleanly, but there's nothing to learn from it that the prediction doesn't already say.
- **The deliverable is the calculation:** fit `VRAM@load ≈ intercept + slope·ctx` from the measured
  rungs (intercept ≈ weights+compute, slope ≈ KV/tok), then report the max ctx at the **safe 32400**
  budget *and* at **physical 32624**. The measured slope (≈260 KiB/tok f16) replaces the a-priori
  formula and **empirically refutes any tool claiming 200K f16 fits**.

## Why 200K can't fit (GGUF-verified — refutes online "will it fit" tools)
Parsed straight from `Qwen3.6-27B-Q4_K_S.gguf` (arch `qwen35`): `block_count=65`, `head_count_kv=4`,
`key_length=value_length=256` (**head_dim 256 — double the usual 128**), `context_length=262144`.
→ **f16 KV = 65 × 4 × (256+256) × 2 B = 260 KiB/token** (q8_0 ≈ 138). So f16 KV *alone* is 16.2 GiB
at 65K, **49.6 GiB at 200K, 57.0 GiB at 230K** — 2× the whole card before counting the 15 GiB of
weights. Online tools that say "200K fits" are either (a) reporting the model's **architectural**
`context_length` (262144 — what it's *trained* for, not what its KV fits in 32 GB), or (b) assuming a
**generic/quantized** KV for a standard-shaped 27B; this model is unusually **deep (65 layers) and
wide-headed (head_dim 256)**, so its KV is ~3–4× a generic estimate. Contrast the 35B **MoE** (~21
KiB/tok) which genuinely ran 200K — same "27B/35B" labels, 12× different KV regime. **Feasible max ≈
65K (f16) / ~120K (q8_0); the measured rungs confirm the 260 KiB/tok slope.**

## Fixed parameters
- Model `Qwen3.6-27B-Q4_K_S.gguf` (dense, 15.01 GiB, **no MTP layer**) · backend **vulkan** ·
  tuning `-ub 2048 -b 4096 -fa on` · np=1 (max-context is a single-slot question) · server on :8081.

## Build fixtures first (~1 min)
`codereview-8000.txt` is the only fixture; build it if absent:
```bash
export ROOT=/home/dev/work/dp-craft/amd
cd "$ROOT/bench/workloads" && mkdir -p generated
python3 build_prompt.py --task tasks/codereview-large.task.md \
  --src corpus/ts-agentic-code-runner --src corpus/py-rich \
  --target-tokens 8000 --out generated/codereview-8000.txt
```

## Run
```bash
bash campaigns/2026-07-12-27b-maxctx-v2/run.sh
# resume after interruption: same command (done/ markers skip finished probes)
# subset / shorter pass:  ONLY='*-q8-*' REPS=1 MAX_TOKENS=64 bash campaigns/2026-07-12-27b-maxctx-v2/run.sh
# measure the edges too:  VRAM_BUDGET_MIB=32624 bash campaigns/2026-07-12-27b-maxctx-v2/run.sh
```
The driver **continues past a failed server** and **skips (before launch) any server predicted to
exceed `VRAM_BUDGET_MIB`** — so it stays in VRAM and never risks a system-RAM spill/freeze. VRAM &
GTT are sampled per probe into each run dir's `gpu_samples.csv`.

## Matrix
| server | ctx | np | kv | mtp | probe | conc | prompts | predicted VRAM | @32400 guard |
|--------|----:|---:|:--:|:---:|-------|-----:|---------|---------------:|:------------:|
| f16-c32k | 32768 | 1 | f16 | 0 | `mc-f16-c32k` | 1 | codereview-8000.txt | 24290 | run |
| f16-c48k | 49152 | 1 | f16 | 0 | `mc-f16-c48k` | 1 | codereview-8000.txt | 28450 | run |
| f16-c56k | 57344 | 1 | f16 | 0 | `mc-f16-c56k` | 1 | codereview-8000.txt | 30530 | run |
| f16-c60k | 61440 | 1 | f16 | 0 | `mc-f16-c60k` | 1 | codereview-8000.txt | 31570 | run |
| q8-c64k | 65536 | 1 | q8_0 | 0 | `mc-q8-c64k` | 1 | codereview-8000.txt | 24802 | run |
| q8-c96k | 98304 | 1 | q8_0 | 0 | `mc-q8-c96k` | 1 | codereview-8000.txt | 29218 | run |
| q8-c112k | 114688 | 1 | q8_0 | 0 | `mc-q8-c112k` | 1 | codereview-8000.txt | 31426 | run |
| q8-c116k | 118784 | 1 | q8_0 | 0 | `mc-q8-c116k` | 1 | codereview-8000.txt | 31978 | run |
| f16-c64k-edge | 65536 | 1 | f16 | 0 | `mc-f16-c64k` | 1 | codereview-8000.txt | 32610 | **skip** (edge; run at 32624) |
| q8-c120k-edge | 122880 | 1 | q8_0 | 0 | `mc-q8-c120k` | 1 | codereview-8000.txt | 32530 | **skip** (edge; run at 32624) |
| f16-c200k-max | 204800 | 1 | f16 | 0 | `mc-f16-c200k` | 1 | codereview-8000.txt | 67970 | **skip** (66 GiB — impossible) |
| f16-c230k-max | 235520 | 1 | f16 | 0 | `mc-f16-c230k` | 1 | codereview-8000.txt | 75770 | **skip** (74 GiB — impossible) |
| q8-c200k-max | 204800 | 1 | q8_0 | 0 | `mc-q8-c200k` | 1 | codereview-8000.txt | 43570 | **skip** (43 GiB — impossible) |
| q8-c230k-max | 235520 | 1 | q8_0 | 0 | `mc-q8-c230k` | 1 | codereview-8000.txt | 47710 | **skip** (47 GiB — impossible) |

## Write-up
**benchmark-results** skill → co-located `campaigns/2026-07-12-27b-maxctx-v2/analysis.md` (summary +
table first, **memory column mandatory**); `report.html` auto-generated by `run.sh`'s last step
(`bench/lib/report.py`). Add a `<!-- meta -->` block to the report and run `docs/reindex.py`.

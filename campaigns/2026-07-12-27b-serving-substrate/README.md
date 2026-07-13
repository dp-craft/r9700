# 27B serving substrate — real prefill curve, KV f16/q8_0, MTP decode, cache reuse (R9700, 2026-07-12)

Scaffolded by `bench/gen_campaign.py`. The executable driver is **`run.sh`** in this folder
(resumable — per-probe markers in `done/`, rerun to continue).

> **This is Campaign 1 of a 3-campaign series** — the plan is
> `docs/plans/2026-07-12-27b-agentic-config-campaign-series.md`. This one measures the
> **quality-independent serving substrate** (real prefill curve, KV f16 vs q8_0, MTP decode speed,
> prefix-cache reuse, Vulkan vs HIP). No judge, no sampling — those are Campaign 2, which runs on
> **this campaign's winning substrate**. Goal of the series: a stable config for heavy agentic
> coding (multi-rule + tool use).

## Why these probes (what each one learns)
- **`pf-cr8000/32000/64000` (cold, `unique`)** — the **real prefill-throughput curve** vs depth.
  This is the answer to "why was prefill slow": the previous run's prompts were 51–99 tokens, so
  `prefill_tps` (~200) was a **fixed-overhead artifact** (~255 ms/req launch floor + ~1260 tok/s
  marginal, MEASURED). At your real 10–50K operating point prefill is far higher — this curve
  measures it honestly. Report `prefill_tps` and `ttft` vs depth.
- **`warm-cr32000` (`shared`)** — cold vs warm **prompt-cache amortization**: request 1 pays full
  prefill, requests 2–4 hit the server prefix cache. The ratio = what a **reused system+code
  prefix** saves per agentic turn. (See also the `--cache-reuse` KV-shift variant below, for the
  harder *prefix + changed tail* case.)
- **`sub-q8` vs `sub-f16`** — KV **q8_0 vs f16** at 32K/64K: Δprefill, Δdecode, VRAM saved
  (34 vs 64 KiB/tok). Apply the **≤5 % rule**. At these depths VRAM is not binding (predicted
  22.4 GiB f16 / 20.5 GiB q8_0 « 32.4 budget), so the only question is whether q8_0 costs speed —
  and whether the saved VRAM is worth spending on a bigger `--cache-ram` / more `-np` slots.
- **`sub-mtp1`** — MTP **decode speedup + acceptance** (`dec-think-mtp1`) and whether MTP perturbs
  **prefill** (`pf-cr32000-mtp1`). Decode **speed only** here; MTP's *quality/runaway* behavior is
  Campaign 2 (it's temperature-coupled — the previous runaway happened at temp 1.0).

## Fixed parameters
- Model `Qwen3.6-27B-MTP-Q4_K_M.gguf` (the MTP build — it uniquely carries the MTP axis; the
  substrate is arch+quant-determined and **transfers to jackrong-qwopus**, re-confirmed as
  Campaign 2 step B0) · backend **vulkan** · tuning `-ub 2048 -b 4096 -fa on` · ctx 65536 · np 1 ·
  server on :8081.
- Fixtures already exist in `bench/workloads/generated/`: `codereview-{8000,32000,64000}.txt`,
  `thinking-hard.txt`. **No new fixtures needed** for the base run.

## Extra passes (backend + server flags are GLOBAL, so these are documented re-runs, not spec rows)

**A. Prefix-cache KV-shift reuse** (the *prefix + changed tail* agentic case, beyond identical-prompt
`shared`). Re-run just the warm probe with host-memory cache + KV-shift reuse enabled via
`EXTRA_ARGS` (already plumbed through `serve_llamacpp.sh`):
```bash
EXTRA_ARGS="--cache-reuse 256 --cache-ram 8192" \
  ONLY='warm-cr32000' bash campaigns/2026-07-12-27b-serving-substrate/run.sh
```
Compare its warm ttft/prefill to the baseline `warm-cr32000`. (A dedicated *fixed-20K-prefix +
small-delta* fixture is a Campaign-2/3 refinement — the tracked `agentic-*.txt` deliberately put a
unique run-id at the **start**, which defeats reuse, so don't use them here.)

**B. Vulkan vs ROCm/HIP spot-check @32K** (both builds are installed; HIP has not been retested at
this operating point). Run the 32K prefill + decode probes on the HIP build (:8080) by hand and
compare to `pf-cr32000` / `dec-think`:
```bash
# start HIP server
MODEL=/home/dev/models/gguf/Qwen3.6-27B-MTP-Q4_K_M.gguf BACKEND=rocm PORT=8080 CTX=65536 \
  KV=f16 UB=2048 B=4096 FA=on bash bench/engine-bench/serve_llamacpp.sh
# probe it (engine-bench run.sh against the running server)
SERVERS='http://localhost:8080' PREFIX_MODE=unique REPS=3 MAX_TOKENS=256 API=completions \
  bash bench/engine-bench/run.sh   # prompts=codereview-32000.txt ; then thinking-hard.txt max_tokens 512 api chat
MODEL=... BACKEND=rocm PORT=8080 bash bench/engine-bench/serve_llamacpp.sh stop
```
The interesting number is whether HIP has a **lower per-request launch floor** (the ~255 ms fixed
cost) or higher sustained decode than Vulkan.

## Fixed parameters
- Model `Qwen3.6-27B-MTP-Q4_K_M.gguf` · backend **vulkan** ·
  tuning `-ub 2048 -b 4096 -fa on` ·
  server on :8081.

## Build fixtures first
Build every prompt file referenced below into `bench/workloads/generated/` with
`build_prompt.py` (see `docs/GUIDE.md` §2). The driver assumes they exist.

## Run
```bash
bash campaigns/2026-07-12-27b-serving-substrate/run.sh
# resume after interruption: same command (done/ markers skip finished probes)
# subset / shorter pass:  ONLY='*-q8-*' REPS=1 MAX_TOKENS=64 bash campaigns/2026-07-12-27b-serving-substrate/run.sh
# tighten the guard:      VRAM_BUDGET_MIB=31000 bash campaigns/2026-07-12-27b-serving-substrate/run.sh
```
The driver **continues past a failed server** and **skips (before launch) any server predicted to
exceed `VRAM_BUDGET_MIB`** — so it stays in VRAM and never risks a system-RAM spill/freeze. VRAM &
GTT are sampled per probe into each run dir's `gpu_samples.csv`.

## Matrix
| server | ctx | np | kv | mtp | probe | conc | prompts |
|--------|----:|---:|:--:|:---:|-------|-----:|---------|
| sub-f16 | 65536 | 1 | f16 | 0 | `pf-cr8000` | 1 | codereview-8000.txt |
| sub-f16 | 65536 | 1 | f16 | 0 | `pf-cr32000` | 1 | codereview-32000.txt |
| sub-f16 | 65536 | 1 | f16 | 0 | `pf-cr64000` | 1 | codereview-64000.txt |
| sub-f16 | 65536 | 1 | f16 | 0 | `warm-cr32000` | 1 | codereview-32000.txt |
| sub-f16 | 65536 | 1 | f16 | 0 | `dec-think` | 1 | thinking-hard.txt |
| sub-q8 | 65536 | 1 | q8_0 | 0 | `pf-cr32000-q8` | 1 | codereview-32000.txt |
| sub-q8 | 65536 | 1 | q8_0 | 0 | `pf-cr64000-q8` | 1 | codereview-64000.txt |
| sub-q8 | 65536 | 1 | q8_0 | 0 | `dec-think-q8` | 1 | thinking-hard.txt |
| sub-mtp1 | 65536 | 1 | f16 | 1 | `pf-cr32000-mtp1` | 1 | codereview-32000.txt |
| sub-mtp1 | 65536 | 1 | f16 | 1 | `dec-think-mtp1` | 1 | thinking-hard.txt |

## Write-up
**benchmark-results** skill → co-located `campaigns/2026-07-12-27b-serving-substrate/analysis.md` (summary + table
first, **memory column mandatory**); `report.html` auto-generated by `run.sh`'s last step
(`bench/lib/report.py`). Add a `<!-- meta -->` block to the report and run `docs/reindex.py`.

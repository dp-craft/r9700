# Starter campaign v2 — baseline + optimum picture (R9700, 2026-07-11)

A self-contained run plan. A fresh session executes it top to bottom without guesswork.
✅ = command verified in this repo · ⚠️ = one-time check on your machine.

**v2 (2026-07-11 evening):** rewritten for the adaptive harness. v1's flaws — padding source too
small for ≥32K prompts, MTP missing from every server command, q8_0 baked in as KV baseline —
are fixed in the harness itself; see `docs/GUIDE.md`.

## Goal
Answer four questions with MEASURED, bracketed numbers on the **35B-A3B** (the main work model):
1. **Tuning optimum** per backend (ROCm vs Vulkan): best `-ub`/`-b`/`-fa`, peak bracketed on both
   sides (model-bench `sweep.py`).
2. **KV 8-bit decision**: does q8_0 cost ≤5% prefill+decode at depth 32K? What VRAM does it buy?
   (sweep.py KV stage — the ACCEPT/KEEP verdict feeds every later config.)
3. **Serving combos**: backend × MTP × KV on real workloads — context-depth curve 8K→64K,
   thinking `ttfa_s` (engine-bench `campaign.sh` Part A).
4. **Agentic throughput**: 1/2/4 parallel streams on 4 slots — per-stream vs aggregate tok/s,
   TTFT p95, inside 32 GB (`campaign.sh` Part B; per-slot ctx = CTX/NP).

## Fixed parameters
- Model: `Qwen3.6-35B-A3B-UD-Q4_K_M.gguf` (embedded MTP layer) · decode sample 256 tok ·
  temperature 0.2 · llama.cpp build b9950 (record if different!)
- Repo root `$ROOT=/home/dev/work/dp-craft/amd`; GPU/vendor env auto via `bench/lib/gpu_env.sh`.

```bash
export ROOT=/home/dev/work/dp-craft/amd
rocm-smi --showproductname | grep R9700          # sanity ✅
ls /home/dev/models/gguf/*.gguf                  # sanity ✅
```

## Phase 1 — workload fixtures ✅ (~1 min)
```bash
cd "$ROOT/bench/workloads" && mkdir -p generated
for T in 8000 32000 64000 100000; do
  python3 build_prompt.py --task tasks/codereview-large.task.md \
    --src corpus/ts-agentic-code-runner --src corpus/py-rich \
    --target-tokens $T --out generated/codereview-${T}.txt
done
python3 build_prompt.py --task tasks/thinking-hard.prompt.txt --target-tokens 0 \
  --out generated/thinking-hard.txt
python3 build_prompt.py --task tasks/agentic-implement.task.md \
  --src corpus/ts-agentic-code-runner --target-tokens 8000 --variants 4 \
  --out generated/agentic-8000.txt
```
Expected: 9 files; builder errors out if any target can't be filled ≥97%.

## Phase 2 — adaptive tuning sweep, both backends ✅ (~30–60 min each)
```bash
cd "$ROOT/bench/model-bench"
./sweep.py --model /home/dev/models/gguf/Qwen3.6-35B-A3B-UD-Q4_K_M.gguf --slug 35b-rocm
./sweep.py --model /home/dev/models/gguf/Qwen3.6-35B-A3B-UD-Q4_K_M.gguf \
  --llama-bench "$ROOT/bench/llamacpp-vulkan/llama-bench" --slug 35b-vulkan
```
Expected: two `bench/runs/<stamp>-sweep-35b-*/sweep-summary.json`, each with interior-peak
curves for ub/batch, fa verdict, **KV verdict (ACCEPT q8_0 / KEEP f16)** at depth 32768 with
Δ% and VRAM saved, and a recommended server line.

## Phase 3 — serving combination matrix ✅ plumbing (~1.5–2.5 h)
Feed the sweep's UB/B/FA into the campaign if they differ from the defaults (2048/8192/on):
```bash
cd "$ROOT/bench/engine-bench"
UB=2048 B=8192 FA=on ./campaign.sh          # backends × MTP(0/1) × KV(f16/q8_0), Part A+B
# resume after interruption:
# CAMPAIGN_DIR=$ROOT/bench/runs/<stamp>-campaign-combo35b ./campaign.sh
```
Expected: `results.jsonl` with aggregate rows per {config × cr8000/cr32000/cr64000/thinking ×
agentic-c1/c2/c4}; server cmdline+props per config in `servers/`; failed combos (e.g. MTP
mid-stream crash — known upstream issue, see `bench/engine-bench/README.md`) in `failures.txt`,
never silently averaged.

## Phase 4 — write it up (/benchmark-results skill)
- `docs/analysis/<stamp>-sweep-35b-rocm-vs-vulkan.md` — Phase 2: optimum + KV decision table.
- `docs/analysis/<stamp>-campaign-combo35b.md` — Phase 3: depth curve, MTP×KV interaction,
  concurrency scaling (per-stream vs aggregate), TTFT p95. Update README TL;DR with the new
  winning config (provenance: these runs).

## Run matrix (tick as you go)
- [x] 1: fixtures built (9 files)
- [x] 2: sweep 35B ROCm → summary + KV verdict (`bench/runs/2026-07-11-1833-sweep-35b-rocm/`; KEEP f16)
- [x] 2: sweep 35B Vulkan → summary + KV verdict (`bench/runs/2026-07-11-1837-sweep-35b-vulkan/`; KEEP f16)
- [x] 3: campaign Part A (8 configs × depth curve + thinking) — `cr64000` overflows 65536 ctx (FAILED ×8, documented)
- [x] 3: campaign Part B (8 configs × concurrency 1/2/4) — `bench/runs/2026-07-11-1844-campaign-combo35b/`
- [x] 4: two analysis docs + INDEX + README TL;DR refresh (2026-07-11)

## Out of scope (later, targeted)
27B model (no MTP layer — half the matrix is meaningless for it) · ollama/vLLM cross-engine
rows (add via `run.sh` once the llama.cpp picture is settled) · 100K depth (needs CTX>100K:
q8_0 KV likely REQUIRED — that's itself a Phase-2 finding).

# Benchmark harness guide — how to run everything (offline, solo)

> This is the generic operator guide. Concrete, dated run plans ("runbooks") live in
> `campaigns/<date>-<slug>/` (project root), each with its co-located `analysis.md` write-up.
> Scaffold a new one with the `/benchmark-new-campaign` skill.

Step-by-step for both tracks. Legend: ✅ = verified working in this repo (2026-07-11 session) ·
⚠️ = confirm on your machine first.

## 0. Prerequisites (once per shell)
```bash
cd /home/dev/work/dp-craft/amd        # $ROOT
```
- Vendor env (HSA override on AMD) is handled by the scripts via `bench/lib/gpu_env.sh` — you no
  longer export it by hand. On **NVIDIA / other GPUs** everything works the same: point
  `LLAMA_BENCH` / `LLAMA_SERVER` at a CUDA (or other) build; `gpu_env.sh` records the GPU via
  `nvidia-smi`, and engine-bench is pure HTTP anyway. ✅ (AMD path verified; NVIDIA path ⚠️ untested)
- Models in `/home/dev/models/gguf/` (27B Q4_K_S, 35B-A3B-UD Q4_K_M with embedded MTP layer). ✅
- llama.cpp builds: `bench/llamacpp/` (ROCm) + `bench/llamacpp-vulkan/` (RADV), build b9950. ✅
- GPU check: `rocm-smi --showproductname` → "AMD Radeon AI PRO R9700". ✅

---

## 1. model-bench — find the tuning optimum (no server needed)

**Adaptive optimum search** (recommended — expands the grid until the peak is bracketed,
then runs the KV f16-vs-q8_0 acceptance test at depth): ✅
```bash
cd bench/model-bench
./sweep.py --model /home/dev/models/gguf/Qwen3.6-35B-A3B-UD-Q4_K_M.gguf --slug 35b-rocm
./sweep.py --model /home/dev/models/gguf/Qwen3.6-35B-A3B-UD-Q4_K_M.gguf \
    --llama-bench $PWD/../llamacpp-vulkan/llama-bench --slug 35b-vulkan
```
→ `bench/runs/<stamp>-sweep-<slug>/sweep-summary.json` (curves, KV verdict ACCEPT/KEEP,
recommended server command). ~30–60 min per backend on the 35B.

**Manual single run** (quick checks): ✅
```bash
MODEL=/home/dev/models/gguf/Qwen3.6-27B-Q4_K_S.gguf SLUG=27b-check UB=1024,2048 ./run.sh
```
Knobs: `bench/model-bench/README.md`. KV **default is f16** (baseline); q8_0 only via the
sweep's ≤5% acceptance rule.

---

## 2. Build the workload prompts ✅
```bash
cd bench/workloads && mkdir -p generated
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
The corpus (`bench/workloads/corpus/`, tracked, ~565K tokens TS+Python) is big enough for 100K;
the builder **fails loudly** if a target can't be filled. Real token counts run within ±3% of
nominal (calibrated 3.6 chars/token — see `bench/workloads/README.md`).

---

## 3. engine servers

**Use the launcher** — it records the exact cmdline + `/props`, waits for health: ✅
```bash
cd bench/engine-bench
# llama.cpp Vulkan, MTP on, q8_0 KV, 64K ctx, 1 slot, on :8081
MODEL=/home/dev/models/gguf/Qwen3.6-35B-A3B-UD-Q4_K_M.gguf \
  BACKEND=vulkan MTP=1 KV=q8_0 CTX=65536 NP=1 PORT=8081 ./serve_llamacpp.sh start
PORT=8081 ./serve_llamacpp.sh status   # / stop
```
Key facts: **MTP** = `--spec-type draft-mtp` (draft layer is embedded in the 35B GGUF —
`nextn_predict_layers=1`); **parallel slots** `-np N` split the context: per-slot ctx = `CTX/NP`
(budget real prompt tokens + max_tokens per slot). ✅ verified: Vulkan+MTP+q8_0 server, MTP
+24% decode measured on chat.

**ollama** (port 11434): ⚠️
```bash
OLLAMA_FLASH_ATTENTION=1 OLLAMA_KV_CACHE_TYPE=q8_0 ollama serve   # then, once:
ollama create q35:local -f bench/engine-bench/ollama/Modelfile_q35
```
**vLLM** (port 8000, Docker): ⚠️ 27B failed to load in prior tests; 35B AWQ only
```bash
docker run --rm -it --device /dev/kfd --device /dev/dri -p 8000:8000 \
  -v /home/dev/models:/models \
  rocm/vllm:rocm7.13.0_gfx120X-all_ubuntu24.04_py3.13_pytorch_2.10.0_vllm_0.19.1 \
  vllm serve /models/Qwen3.6-35B-A3B-AWQ-4bit --port 8000
```

---

## 4. engine-bench — measure

**Combination campaign** (the full picture: backend × MTP × KV × depth × concurrency on the
35B; servers restarted per config; resumable): ✅ (plumbing verified; full run pending)
```bash
cd bench/engine-bench && ./campaign.sh
# interrupted? → CAMPAIGN_DIR=$ROOT/bench/runs/<stamp>-campaign-combo35b ./campaign.sh
```
Runtime ≈ 1.5–2.5 h (16 server configs × model load + measurements). Output: one
`results.jsonl` (per-request + aggregate rows), per-config server cmdline + props, `failures.txt`.

**Single comparison run** against servers you started yourself: ✅
```bash
PROMPT_FILE=$PWD/../workloads/generated/codereview-64000.txt SLUG=cr64k \
  MAX_TOKENS=256 PREFIX_MODE=unique ./run.sh
# thinking-mode (chat template REQUIRED — raw completions can EOS instantly):
PROMPT_FILE=$PWD/../workloads/generated/thinking-hard.txt SLUG=think \
  MAX_TOKENS=1024 API=chat ./run.sh
# agentic concurrency wave (4 streams, per-stream variant files, cold cache):
PROMPT_FILE="$PWD/../workloads/generated/agentic-8000-v1.txt $PWD/../workloads/generated/agentic-8000-v2.txt \
  $PWD/../workloads/generated/agentic-8000-v3.txt $PWD/../workloads/generated/agentic-8000-v4.txt" \
  SLUG=agentic4 CONCURRENCY=4 REPS=3 PREFIX_MODE=unique MAX_TOKENS=256 ./run.sh
```
**llama-benchy** (standardized synthetic curves, installed at `bench/dl/benchy-venv`): ✅ install
```bash
USE_BENCHY=1 BENCHY_ARGS="--pp 2048 8192 --tg 128 --concurrency 1 4 --runs 3" SLUG=benchy ./run.sh
```

---

## 5. Visualize a run (charts, no install) ✅
`bench/lib/report.py` renders any run/campaign dir into **theme-aware SVG charts** (`charts/*.svg`)
plus an `appendix.md` that embeds them — so the charts live INSIDE the Markdown write-up (stdlib
Python only, works offline, light/dark aware). It auto-detects the run kind:
```bash
# throughput (results.jsonl) → depth curves, concurrency scaling, TTFT p95, thinking, memory:
bench/lib/report.py bench/runs/<stamp>-campaign-combo35b        # → <dir>/charts/ + <dir>/appendix.md
# quality (outputs.jsonl) → quality-vs-cost, accuracy, judge, token economy, latency, per-task heatmap
bench/lib/report.py campaigns/<date>-<slug>
# sweep (sweep-summary.json) → -ub/-b tuning curves + VRAM + KV verdict
bench/lib/report.py bench/runs/<stamp>-sweep-35b-vulkan
bench/lib/report.py <dir> --charts DIR --appendix FILE          # custom output paths
```
Failures (`failures.txt`, `n_err>0`) and errored requests are surfaced in a note, never averaged
in; every chart set ships a color-independent data table. The SVGs under `charts/` are **committed**
(embed `appendix.md` into `analysis.md`); the raw JSONL in `out/` is gitignored.

## 6. Turn a run into a report
Use the `/benchmark-results` skill: reads the run dir, computes deltas, writes the co-located
`campaigns/<date>-<slug>/analysis.md` (or `docs/analysis/<stamp>-<slug>.md` for a one-off with no
campaign; summary + table first, **memory column mandatory**), registers it in `docs/INDEX.md`.
The doc must include (spec + canonical glossary rows live in the skill's output contract):
- a **Legend** right after the Summary — every knob/label the run used (`-ub`, `-b`, `-fa`,
  KV f16/q8_0, MTP, crN depth, agentic-cN, TTFT/ttfa, …): definition, effect on this hardware,
  how it was tested;
- a **Consequences & root causes** section — relations/interactions, causal explanations, and
  practical consequences, each tagged MEASURED / INFERRED / CLAIMED; root causes that can't be
  established from our data get validated via the `/research` skill, unresolved ones marked OPEN.

---

## Measurement rules (the short list)
- **Cold vs warm prefill**: identical prompts hit the server prefix cache from the 2nd request —
  use `PREFIX_MODE=unique` unless you're *studying* the cache (then `shared`). (Measured: 2.4×
  inflated prefill on rep 2 without it.)
- **One variable per comparison**; note `plateau_within_noise` (±3% run variance) instead of
  declaring winners inside the noise band.
- **KV q8_0 rule**: accepted only if prefill AND decode lose ≤5% at the target depth (sweep.py
  automates this); the payoff (halved KV = bigger ctx / more slots) is quantified from the
  per-invocation VRAM samples.
- Every run dir must have `meta.txt` (+ server cmdline/props for engine-bench) — an unversioned
  number is noise.

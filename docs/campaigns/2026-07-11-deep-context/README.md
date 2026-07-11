# Deep-context campaign — max depth + parallel at the ceiling (R9700, 2026-07-11)

A self-contained run plan. Built from the conventions in `docs/GUIDE.md`.
✅ = command uses verified repo tooling · ⚠️ = watch point.

**Two ways to run it.** ① **Automated + resumable:** after Phase 1 (fixtures), just
`bash docs/campaigns/2026-07-11-deep-context/run.sh` — it loops every server/probe below with
per-probe `done/` markers (rerun to continue after an interruption), consolidates every probe
into one `results.jsonl`, and auto-generates `report.html` as the last step. `run.sh` is generated from `spec.json` by `bench/gen_campaign.py`;
edit the spec and regenerate, or hand-edit. ② **Manual:** run the phase commands below yourself.

**Why this campaign.** The starter campaign capped at 64K and hit a `cr64000` context overflow.
Direct VRAM measurement then showed the real picture: **f16 KV ≈ 21 KiB/token** (not the textbook
82 KiB), so the native **262 144** context fits in **~27 GB** (measured) — VRAM is *not* the binding
limit, the model's RoPE cap is. This campaign measures how deep we can actually go and how the card
behaves at the ceiling, single-stream and in parallel.

## Decisions locked (2026-07-11)
- **Backend:** Vulkan/RADV only (the decode winner) · **tuning:** `-ub 2048 -b 4096 -fa on` (sweep optimum).
- **KV:** **f16 everywhere**, plus **one q8_0 confirmatory point** at the deepest single run
  (to document, with numbers, that q8_0 is *not* needed here).
- **Single-thread max depth:** **~200 000** (safety margin under the 262 144 native cap; shorter prefill).
- **Parallel:** server `-c 262144`, `-np ∈ {2,4}` (each slot = `262144/np`). **No VRAM fallback** —
  if a server won't start / a probe stops, we fix and re-run that point (per your call).
- **MTP:** **on** for single-stream (decode +30–40 %), **off** for parallel (it reverses to −8…−15 %
  under load — measured in the starter campaign).

## Fixed parameters
- Model `Qwen3.6-35B-A3B-UD-Q4_K_M.gguf` (embedded MTP layer) · llama.cpp build b9950 (record if different).
- Repo root `$ROOT`; GPU/vendor env auto via `bench/lib/gpu_env.sh`. Vulkan server on **:8081**
  (matches `run.sh`'s `llamacpp-vulkan` engine URL).

```bash
export ROOT=/home/dev/work/dp-craft/amd
cd "$ROOT/bench/engine-bench"
# Only probe the Vulkan server we start (silences the not-running rocm/ollama engines):
export ENGINES_LIST="llamacpp-vulkan|http://localhost:8081/v1|local"
export MODEL=/home/dev/models/gguf/Qwen3.6-35B-A3B-UD-Q4_K_M.gguf
export GEN=$ROOT/bench/workloads/generated
```

## Phase 1 — build the deep fixtures ✅ (~2 min)
```bash
cd "$ROOT/bench/workloads" && mkdir -p generated
# single-thread depth curve (corpus ~565K tok is big enough):
for T in 8000 128000 200000; do
  python3 build_prompt.py --task tasks/codereview-large.task.md \
    --src corpus/ts-agentic-code-runner --src corpus/py-rich \
    --target-tokens $T --out generated/codereview-${T}.txt
done
python3 build_prompt.py --task tasks/thinking-hard.prompt.txt --target-tokens 0 \
  --out generated/thinking-hard.txt
# parallel agent streams: 4 variants at 32K each (fills the np=4 slot = 65536 with gen headroom):
python3 build_prompt.py --task tasks/agentic-implement.task.md \
  --src corpus/ts-agentic-code-runner --src corpus/py-rich \
  --target-tokens 32000 --variants 4 --out generated/agentic-32000.txt
```
Expected: 6 files (`codereview-{8000,128000,200000}.txt`, `thinking-hard.txt`,
`agentic-32000-v1..v4.txt`); the builder **errors out** if any target can't be filled ≥97 %.

## Phase 2 — deep single-thread, MTP off then on ✅ (~40–70 min)
`-c 262144 -np 1` (native max, measured ~27 GB). Depth curve + thinking per MTP setting.
```bash
cd "$ROOT/bench/engine-bench"
for M in 0 1; do
  BACKEND=vulkan CTX=262144 NP=1 KV=f16 MTP=$M UB=2048 B=4096 PORT=8081 ./serve_llamacpp.sh start
  for T in 8000 128000 200000; do
    PROMPT_FILE=$GEN/codereview-${T}.txt SLUG=deep-mtp${M}-cr${T} \
      MAX_TOKENS=256 REPS=2 PREFIX_MODE=unique ./run.sh
  done
  PROMPT_FILE=$GEN/thinking-hard.txt SLUG=deep-mtp${M}-think \
    MAX_TOKENS=1024 REPS=2 API=chat PREFIX_MODE=unique ./run.sh
  PORT=8081 ./serve_llamacpp.sh stop
done
```
⚠️ 200K prefill ≈ 1.5–2.5 min/request (×2 reps). ⚠️ MTP at deep ctx: if a run stops with an MTP
batch error (known upstream issue at short ctx), re-run that point with `MTP=0` and note it.

## Phase 3 — deepest single, q8_0 confirmatory point ✅ (~10 min)
One server, one probe — proves q8_0 buys nothing here (A/B vs the f16 `deep-mtp1-cr200000` above).
```bash
BACKEND=vulkan CTX=262144 NP=1 KV=q8_0 MTP=1 UB=2048 B=4096 PORT=8081 ./serve_llamacpp.sh start
PROMPT_FILE=$GEN/codereview-200000.txt SLUG=deep-mtp1q8-cr200000 \
  MAX_TOKENS=256 REPS=2 PREFIX_MODE=unique ./run.sh
PORT=8081 ./serve_llamacpp.sh stop
```

## Phase 4 — parallel at the ceiling, MTP off ✅ (~30–50 min)
`-c 262144` split across slots; concurrency = `-np`. **No fallback** — if a server OOMs on start,
lower `CTX` for that point and record it.
```bash
for NP in 2 4; do
  BACKEND=vulkan CTX=262144 NP=$NP KV=f16 MTP=0 UB=2048 B=4096 PORT=8081 ./serve_llamacpp.sh start
  FILES=""; for v in $(seq 1 $NP); do FILES="$FILES $GEN/agentic-32000-v${v}.txt"; done
  PROMPT_FILE="$FILES" SLUG=deep-par-np${NP} \
    MAX_TOKENS=256 CONCURRENCY=$NP REPS=2 PREFIX_MODE=unique ./run.sh
  PORT=8081 ./serve_llamacpp.sh stop
done
```
Each `run.sh` writes `bench/runs/<stamp>-engine-deep-*/results.jsonl` (+ per-engine `/props`,
copied prompts). Server cmdline/props/log live under `bench/.servers/8081.*` per launch.

## Phase 5 — write it up (/benchmark skill)
`docs/analysis/<stamp>-deep-context-35b.md` — depth curve to 200K (prefill+decode collapse),
MTP on/off at depth, q8_0-vs-f16 confirmatory row, parallel decode/stream + aggregate + TTFT p95
at np 2/4. Update the README TL;DR max-context line (provenance: these runs).

## Phase 6 — generate the report (LAST STEP) ✅
The automated `run.sh` already does this and writes `report.html` into the campaign dir. If you ran
the phases manually, consolidate the per-probe run dirs and render (self-contained HTML, Chart.js
vendored, no network):
```bash
CDIR="$ROOT/bench/runs/2026-07-11-deep-context"; mkdir -p "$CDIR"
cat "$ROOT"/bench/runs/*-engine-deep-*/results.jsonl > "$CDIR/results.jsonl"
python3 "$ROOT/bench/lib/report.py" "$CDIR"          # → $CDIR/report.html
xdg-open "$CDIR/report.html"                          # or open in a browser
```

## Run matrix (tick as you go)
- [x] 1: fixtures built (6 files)
- [x] 2: single MTP=0 → cr{8k,128k,200k} + thinking
- [x] 2: single MTP=1 → cr{8k,128k,200k} + thinking
- [x] 3: q8_0 confirm @200k (MTP=1) — first attempt (2306) empty, re-run 2310 OK
- [x] 4: parallel np=2 (agentic-32k ×2)
- [x] 4: parallel np=4 (agentic-32k ×4)
- [x] 5: analysis doc + INDEX + README max-ctx refresh → `docs/analysis/2026-07-11-2200-deep-context-35b.md`
- [x] 6: report.html generated → `bench/runs/2026-07-11-2200-deep-context/report.html`

## Out of scope (deliberately)
- **ROCm backend** (Vulkan wins decode; add later if needed) · **full q8_0 matrix** (one confirm
  point only — KV is 21 KiB/tok, f16 fits to 262K) · **>262 144 context** (needs YaRN/RoPE scaling
  — a separate quality-vs-length study) · **27B model** (no MTP layer).

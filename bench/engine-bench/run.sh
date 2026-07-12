#!/usr/bin/env bash
# engine-bench — cross-engine comparator. Sends the SAME real workload to each engine's
# OpenAI-compatible /v1 endpoint and records prefill/decode/TTFT (+ thinking + concurrency metrics).
#
# Two measurement backends:
#   1. capture_engine.py probe (bench/lib/) — zero install: real prompt files, thinking-mode ttfa,
#      --concurrency waves, prefix modes (agentic). Default.
#   2. llama-benchy    — standardized synthetic pp/tg/depth curves with concurrency
#      (install: see README). Set USE_BENCHY=1. Complements, does not replace, the probe.
#
# You start the engine servers yourself (docs/GUIDE.md, or engine-bench/serve_llamacpp.sh);
# this script only drives them. Engine list: edit ENGINES below or set ENGINES_LIST
# (semicolon-separated "name|base-url-with-/v1|model" entries).
#
# Env knobs: PROMPT_FILE (required for probe; space-separated list = per-stream variants)
#            SLUG MAX_TOKENS CONCURRENCY REPS WARMUP PREFIX_MODE (none|unique|shared)
#            USE_BENCHY BENCHY_ARGS
#            SAMPLE_VRAM=1  → log GPU VRAM+GTT+power across the probe (gpu_samples.csv) and fold a
#                            `gpu` row into results.jsonl. NOTE: the sampler spans the whole engine
#                            loop, so the memory row is only cleanly attributable when ENGINES_LIST
#                            has ONE engine (the campaign case). Multi-engine comparisons share it.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"

: "${SLUG:=enginecmp}"
: "${MAX_TOKENS:=512}"
: "${CONCURRENCY:=1}"
: "${REPS:=1}"
: "${WARMUP:=1}"
: "${PREFIX_MODE:=none}"
: "${API:=completions}"   # chat = apply chat template (use for instruction/thinking prompts)
: "${USE_BENCHY:=0}"

if [ "$USE_BENCHY" != "1" ]; then
  : "${PROMPT_FILE:?set PROMPT_FILE=/path/to/workload.txt (see bench/workloads/; space-separated list allowed)}"
fi

# Engines to compare: "label|base_url_with_/v1|model". Comment out what you're not running,
# or override the whole list via ENGINES_LIST="a|url|m;b|url|m".
ENGINES=(
  "llamacpp-rocm|http://localhost:8080/v1|local"
  "llamacpp-vulkan|http://localhost:8081/v1|local"
  "ollama|http://localhost:11434/v1|q35:local"
  # "vllm|http://localhost:8000/v1|Qwen3.6-35B-A3B-AWQ-4bit"
)
if [ -n "${ENGINES_LIST:-}" ]; then
  IFS=';' read -r -a ENGINES <<<"$ENGINES_LIST"
fi

STAMP="$(date '+%Y-%m-%d-%H%M')"
OUT="$REPO/bench/runs/${STAMP}-engine-${SLUG}"
mkdir -p "$OUT"
{
  echo "date=$(date -Iseconds)"
  echo "workload=${PROMPT_FILE:-benchy-synthetic}"
  echo "max_tokens=$MAX_TOKENS concurrency=$CONCURRENCY reps=$REPS warmup=$WARMUP prefix_mode=$PREFIX_MODE"
} > "$OUT/meta.txt"
if [ "$USE_BENCHY" != "1" ]; then
  for f in $PROMPT_FILE; do cp "$f" "$OUT/"; done
fi

# --- VRAM/GTT sampling (SAMPLE_VRAM=1): logs GPU memory across the probe so the report can show
#     memory-at-load, peak VRAM, and peak GTT (host-RAM spill = freeze risk). Best-effort. ---
SAMPLER_PID=""
if [ "${SAMPLE_VRAM:-0}" = "1" ] && { command -v rocm-smi >/dev/null 2>&1 || command -v nvidia-smi >/dev/null 2>&1; }; then
  python3 "$REPO/bench/lib/vram_sampler.py" --out "$OUT/gpu_samples.csv" --interval 1 &
  SAMPLER_PID=$!
  # wait (≤2s) for the sampler to initialize (handler installed + first sample written) so a fast
  # probe can't kill it mid-startup and lose the memory row
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    [ -s "$OUT/gpu_samples.csv" ] && [ "$(wc -l <"$OUT/gpu_samples.csv")" -ge 2 ] && break
    kill -0 "$SAMPLER_PID" 2>/dev/null || break   # sampler died (e.g. smi missing) — stop waiting
    sleep 0.2
  done
fi
stop_sampler () { [ -n "$SAMPLER_PID" ] && kill "$SAMPLER_PID" 2>/dev/null && wait "$SAMPLER_PID" 2>/dev/null || true; SAMPLER_PID=""; }
trap stop_sampler EXIT

for e in "${ENGINES[@]}"; do
  IFS='|' read -r name url model <<<"$e"
  echo "== $name ($url) =="
  if ! curl -sf -m 3 "${url%/v1}/health" >/dev/null 2>&1 && ! curl -sf -m 3 "$url/models" >/dev/null 2>&1; then
    echo "  (skipped: $url not reachable)"; continue
  fi
  # record what the server says about itself (llama.cpp /props has build + full settings)
  curl -sf -m 5 "${url%/v1}/props" -o "$OUT/props_${name}.json" 2>/dev/null || true
  curl -sf -m 5 "$url/models" -o "$OUT/models_${name}.json" 2>/dev/null || true

  if [ "$USE_BENCHY" = "1" ]; then
    BENCHY="${BENCHY_BIN:-$REPO/bench/dl/benchy-venv/bin/llama-benchy}"
    "$BENCHY" --base-url "$url" --model "$model" ${BENCHY_ARGS:-} \
      > "$OUT/benchy_${name}.txt" 2>&1 || echo "  benchy failed for $name (see $OUT/benchy_${name}.txt)"
  else
    PF_ARGS=(); for f in $PROMPT_FILE; do PF_ARGS+=(--prompt-file "$f"); done
    python3 "$REPO/bench/lib/capture_engine.py" probe --url "$url" --model "$model" "${PF_ARGS[@]}" \
      --max-tokens "$MAX_TOKENS" --concurrency "$CONCURRENCY" --reps "$REPS" \
      --warmup "$WARMUP" --prefix-mode "$PREFIX_MODE" --api "$API" \
      --engine "$name" --label "$SLUG" >> "$OUT/results.jsonl" || echo "  probe failed for $name"
  fi
done

stop_sampler
# fold the GPU memory summary into results.jsonl as a `gpu` row (report + write-up read it)
if [ -f "$OUT/gpu_samples.csv" ] && [ -f "$OUT/results.jsonl" ]; then
  python3 - "$OUT/gpu_samples.csv" "$SLUG" >> "$OUT/results.jsonl" <<'PY' || true
import sys, re
csv, slug = sys.argv[1], sys.argv[2]
last = ""
for line in open(csv):
    if line.startswith("#"): last = line
if last:
    g = dict(re.findall(r"(\w+)=([\d.]+)", last))
    import json
    print(json.dumps({"kind": "gpu", "label": slug,
        "vram_used_mib_at_load": int(float(g["load_vram_used_mib"])) if "load_vram_used_mib" in g else None,
        "peak_vram_mib": int(float(g["peak_vram_used_mib"])) if "peak_vram_used_mib" in g else None,
        "peak_gtt_mib": int(float(g["peak_gtt_used_mib"])) if "peak_gtt_used_mib" in g else None,
        "avg_power_w": float(g["avg_power_w"]) if "avg_power_w" in g else None}))
PY
fi

echo "→ results: $OUT"
[ -f "$OUT/results.jsonl" ] && { echo "--- summary (aggregate rows) ---"; \
  python3 -c "import json
for l in open('$OUT/results.jsonl'):
    d=json.loads(l)
    if d.get('kind')!='aggregate': continue
    print(f\"{d.get('engine'):16} c={d.get('concurrency')} ttft_p50={d.get('ttft_s_p50')}s \"
          f\"prefill_p50={d.get('prefill_tok_s_p50')} dec/stream_p50={d.get('decode_tok_s_per_stream_p50')} \"
          f\"AGG={d.get('aggregate_tok_s')} tok/s err={d.get('n_err')}\")"; }

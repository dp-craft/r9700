#!/usr/bin/env bash
# run_capture.sh — Phase A driver for the 27B fine-tune quality/token campaign.
# For each config (model × MTP): start one llama-server (fixed tuning), sample VRAM/GTT/power across
# the whole probe, send every task via capture.py (streaming → full timings + TTFT), stop the server.
# Resumable (per-config done markers), continues past a failed config. Then run deterministic scoring.
#
#   bash run_capture.sh                        # all 5 configs, reps 1
#   ONLY='unsloth*' REPS=3 bash run_capture.sh # subset / more reps
#   MODELS_DIR=/home/dev/models/gguf bash run_capture.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
SERVE="$REPO/bench/engine-bench/serve_llamacpp.sh"

: "${MODELS_DIR:=/home/dev/models/gguf}"
: "${PORT:=8081}" ; : "${CTX:=132768}" ; : "${KV:=f16}" ; : "${UB:=2048}" ; : "${B:=4096}"
: "${REPS:=1}" ; : "${MAX_TOKENS:=8192}" ; : "${BACKEND:=vulkan}"   # generous: thinking models burn 1000s of tokens
OUTDIR="$HERE/out" ; mkdir -p "$OUTDIR/done"
OUT="$OUTDIR/outputs.jsonl" ; VRAM="$OUTDIR/vram.jsonl"

# label | model filename (in MODELS_DIR) | mtp
CONFIGS=(
  "rico03-distilled|Qwen3.6-27B-Claude-Opus-Reasoning-Distilled-Q4_K_S.gguf|0"
  "unsloth-mtp-off|Qwen3.6-27B-MTP-Q4_K_M.gguf|0"
  "unsloth-mtp-on|Qwen3.6-27B-MTP-Q4_K_M.gguf|1"
  "hauhau-uncensored|Qwen3.6-27B-Uncensored-HauhauCS-Aggressive-IQ4_XS.gguf|0"
  "jackrong-qwopus|Qwopus3.6-27B-v1-preview-Q4_K_M.gguf|0"
)

vram_used_mib() { rocm-smi --showmeminfo vram 2>/dev/null \
  | awk -F: '/VRAM Total Used/ {gsub(/ /,"",$NF); printf "%d", $NF/1048576}'; }

for entry in "${CONFIGS[@]}"; do
  IFS='|' read -r label file mtp <<< "$entry"
  [ -n "${ONLY:-}" ] && [[ "$label" != ${ONLY} ]] && { echo "skip (ONLY): $label"; continue; }
  if [ -f "$OUTDIR/done/$label" ]; then echo "skip (done): $label"; continue; fi
  model="$MODELS_DIR/$file"
  if [ ! -f "$model" ]; then echo "MISSING MODEL, skipping: $model" | tee -a "$OUTDIR/failures.txt"; continue; fi

  echo "=== $label  (mtp=$mtp)  $file ==="
  t0=$(date +%s)
  if MODEL="$model" BACKEND="$BACKEND" PORT="$PORT" CTX="$CTX" NP=1 UB="$UB" B="$B" FA=on \
       KV="$KV" MTP="$mtp" bash "$SERVE" start; then
    load_s=$(( $(date +%s) - t0 ))
    used=$(vram_used_mib); echo "  VRAM at load: ${used} MiB  (load ${load_s}s)"
    # per-config provenance: /props (build + effective settings) + model file size
    curl -s -m 10 "http://127.0.0.1:$PORT/props" > "$OUTDIR/props_${label}.json" 2>/dev/null || true
    msize=$(stat -c%s "$model" 2>/dev/null || echo 0)
    # sample VRAM/GTT/power across the whole probe (peak + avg power)
    csv="$OUTDIR/gpu_${label}.csv"; SPID=""
    if command -v rocm-smi >/dev/null 2>&1; then
      python3 "$REPO/bench/lib/vram_sampler.py" --out "$csv" --interval 1 &
      SPID=$!
      for _ in 1 2 3 4; do
        [ -s "$csv" ] && [ "$(wc -l <"$csv")" -ge 2 ] && break
        kill -0 "$SPID" 2>/dev/null || break; sleep 0.5
      done
    fi
    python3 "$HERE/capture.py" --config "$label" --tasks "$HERE/tasks/tasks.jsonl" \
      --out "$OUT" --base-url "http://127.0.0.1:$PORT" --reps "$REPS" --max-tokens "$MAX_TOKENS" \
      && touch "$OUTDIR/done/$label"
    [ -n "$SPID" ] && { kill "$SPID" 2>/dev/null; wait "$SPID" 2>/dev/null || true; }
    # fold at-load + sampler peak/power/thermal summary + provenance into vram.jsonl
    python3 - "$label" "$file" "$mtp" "$CTX" "$KV" "$used" "$csv" "$load_s" "$msize" >> "$VRAM" <<'PY'
import sys, json, re
label, file, mtp, ctx, kv, used, csv, load_s, msize = sys.argv[1:10]
row = {"config": label, "file": file, "mtp": int(mtp), "ctx": int(ctx), "kv": kv,
       "vram_used_mib_at_load": int(used), "load_time_s": int(load_s),
       "model_size_bytes": int(msize), "weights_gib": round(int(msize) / 2**30, 2)}
try:
    summ = [l for l in open(csv) if l.startswith("#")][-1]
    for k, v in re.findall(r"(\w+)=([\d.]+)", summ):
        row[k] = float(v) if "." in v else int(v)
except Exception as e:
    row["sampler_note"] = str(e)
print(json.dumps(row))
PY
  else
    echo "SERVER FAILED to start: $label" | tee -a "$OUTDIR/failures.txt"
  fi
  PORT="$PORT" bash "$SERVE" stop || true
  sleep 2
done

echo; echo "=== deterministic scoring ==="
python3 "$HERE/graders/score_deterministic.py" --tasks "$HERE/tasks/tasks.jsonl" \
  --outputs "$OUT" --out "$OUTDIR/scores_deterministic.jsonl" || true
echo
echo "Phase A complete. Outputs: $OUT"
echo "  per-config VRAM/peak/power: $VRAM   gpu samples: $OUTDIR/gpu_*.csv"
echo "  deterministic scores: $OUTDIR/scores_deterministic.jsonl"
echo "Next: hand $OUT + $VRAM to the LLM-judge + aggregation step (Phase B/C)."

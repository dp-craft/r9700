#!/usr/bin/env bash
# run_capture.sh — Phase A driver for the 27B fine-tune quality/token campaign.
# For each config (model × MTP): start one llama-server (fixed tuning), sample VRAM at load,
# send every task via capture.py, stop the server. Resumable (per-config done markers),
# continues past a failed config. Then run the deterministic scorer.
#
#   bash run_capture.sh                        # all 5 configs, reps 1
#   ONLY='unsloth*' REPS=3 bash run_capture.sh # subset / more reps
#   MODELS_DIR=/home/dev/models/gguf bash run_capture.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
SERVE="$REPO/bench/engine-bench/serve_llamacpp.sh"

: "${MODELS_DIR:=/home/dev/models/gguf}"
: "${PORT:=8081}" ; : "${CTX:=32768}" ; : "${KV:=f16}" ; : "${UB:=2048}" ; : "${B:=4096}"
: "${REPS:=1}" ; : "${MAX_TOKENS:=2048}" ; : "${BACKEND:=vulkan}"
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
  if MODEL="$model" BACKEND="$BACKEND" PORT="$PORT" CTX="$CTX" NP=1 UB="$UB" B="$B" FA=on \
       KV="$KV" MTP="$mtp" bash "$SERVE" start; then
    used=$(vram_used_mib)
    echo "{\"config\":\"$label\",\"file\":\"$file\",\"mtp\":$mtp,\"ctx\":$CTX,\"kv\":\"$KV\",\"vram_used_mib_at_load\":$used}" >> "$VRAM"
    echo "  VRAM at load: ${used} MiB"
    python3 "$HERE/capture.py" --config "$label" --tasks "$HERE/tasks/tasks.jsonl" \
      --out "$OUT" --base-url "http://127.0.0.1:$PORT" --reps "$REPS" --max-tokens "$MAX_TOKENS" \
      && touch "$OUTDIR/done/$label"
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
echo "  VRAM/load: $VRAM   deterministic scores: $OUTDIR/scores_deterministic.jsonl"
echo "Next: hand $OUT to the LLM-judge step (Phase B) for the 'judge' tasks."

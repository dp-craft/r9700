#!/usr/bin/env bash
# run_repair.sh — add-on B orchestration: for each cell, relaunch its server and run ONE lint/type
# repair turn (repair.py) on the replies that failed the strict gate, then grade the repaired set.
# Reuses serve_llamacpp.sh exactly like run_capture.sh. Run AFTER run_capture.sh (needs out/outputs.jsonl
# + out/scores_typescript.jsonl to know which replies failed). Idempotent (repair.py skips done rows).
#
#   bash run_repair.sh
#   ONLY='un-*' bash run_repair.sh          # only 27B cells
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
SERVE="$REPO/bench/engine-bench/serve_llamacpp.sh"
: "${MODELS_DIR:=/home/dev/models/gguf}" ; : "${CONFIGS:=$HERE/configs.jsonl}"
: "${PORT:=8081}" ; : "${BACKEND:=vulkan}" ; : "${UB:=2048}" ; : "${B:=4096}" ; : "${WAIT:=600}"
OUTDIR="$HERE/out" ; OUT="$OUTDIR/outputs.jsonl" ; SCORES="$OUTDIR/scores_typescript.jsonl"
ROUT="$OUTDIR/outputs_repair.jsonl"
[ -s "$OUT" ] && [ -s "$SCORES" ] || { echo "need $OUT + $SCORES (run run_capture.sh first)"; exit 2; }

python3 -c '
import json,sys
for l in open(sys.argv[1]):
    if not l.strip(): continue
    c=json.loads(l); print("|".join(str(c.get(k,"")) for k in ["label","model","mtp","kv","ctx","budget"]))
' "$CONFIGS" | while IFS='|' read -r label model mtp kv ctx budget; do
  [ -n "${ONLY:-}" ] && [[ "$label" != ${ONLY} ]] && continue
  # skip the cell if nothing failed the strict gate (repair.py also skips clean rows itself)
  python3 -c "
import json,sys
fail=any(json.loads(l).get('config')=='$label' and not json.loads(l).get('hard_pass')
         for l in open('$SCORES') if l.strip())
sys.exit(0 if fail else 1)" 2>/dev/null || { echo "skip (nothing failed): $label"; continue; }
  mfile="$MODELS_DIR/$model"; [ -f "$mfile" ] || { echo "missing model: $mfile"; continue; }
  echo "=== repair $label ==="
  if MODEL="$mfile" BACKEND="$BACKEND" PORT="$PORT" CTX="$ctx" NP=1 UB="$UB" B="$B" FA=on \
       KV="$kv" MTP="$mtp" WAIT="$WAIT" EXTRA_ARGS="--reasoning-budget $budget" bash "$SERVE" start; then
    python3 "$HERE/repair.py" --config "$label" --base-url "http://127.0.0.1:$PORT" \
      --outputs "$OUT" --scores "$SCORES" --out "$ROUT" \
      --max-tokens $(( (budget>0?budget:8192) + 8192 )) || echo "repair.py failed for $label"
  else
    echo "server failed: $label"
  fi
  PORT="$PORT" bash "$SERVE" stop || true ; sleep 2
done

echo "=== grade repaired replies ==="
python3 "$HERE/score_typescript.py" selftest >/dev/null || { echo "grader self-check failed; aborting"; exit 4; }
python3 "$HERE/score_typescript.py" batch --outputs "$ROUT" --tasks "$HERE/tasks.jsonl" \
  --out "$OUTDIR/scores_repair.jsonl"
echo "repaired replies: $ROUT   scores: $OUTDIR/scores_repair.jsonl"
echo "compare scores_typescript.jsonl (before) vs scores_repair.jsonl (after one repair turn)."

#!/usr/bin/env bash
# run_repair.sh — add-on B orchestration: for each cell, relaunch its server and run ONE lint/type
# repair turn (repair.py) on the replies that failed the strict gate, then grade the repaired set.
# Reuses serve_llamacpp.sh exactly like run_capture.sh. Run AFTER run_capture.sh (needs
# <dir>/tmp/outputs.jsonl + <dir>/results/scores_typescript.jsonl to know which replies failed).
# Idempotent (repair.py skips done rows).
#
#   bash bench/quality/run_repair.sh <campaign_dir>      # or CAMPAIGN_DIR=<dir>
#   ONLY='un-*' bash bench/quality/run_repair.sh <dir>   # only 27B cells
set -uo pipefail
Q="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
D="${1:-${CAMPAIGN_DIR:-}}"
[ -n "$D" ] || { echo "usage: run_repair.sh <campaign_dir> (or CAMPAIGN_DIR=<dir>)" >&2; exit 2; }
D="$(cd "$D" 2>/dev/null && pwd)" || { echo "run_repair: campaign dir not found: ${1:-${CAMPAIGN_DIR:-}}" >&2; exit 2; }
REPO="$(git -C "$D" rev-parse --show-toplevel 2>/dev/null)"
[ -n "$REPO" ] || REPO="$(cd "$Q/../.." && pwd)"
SERVE="$REPO/stack/serve/llamacpp/serve_llamacpp.sh"
: "${MODELS_DIR:=/home/dev/models/gguf}" ; : "${CONFIGS:=$D/configs.jsonl}"
: "${PORT:=8081}" ; : "${BACKEND:=vulkan}" ; : "${UB:=2048}" ; : "${B:=4096}" ; : "${WAIT:=600}"
RAW="$D/tmp"
OUT="$RAW/outputs.jsonl" ; SCORES="$D/results/scores_typescript.jsonl"
ROUT="$RAW/outputs_repair.jsonl"
[ -s "$OUT" ] && [ -s "$SCORES" ] || { echo "need $OUT + $SCORES (run bench/quality/run_capture.sh \"$D\" first)" >&2; exit 2; }

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
    python3 "$Q/repair.py" --config "$label" --base-url "http://127.0.0.1:$PORT" \
      --campaign "$D" --outputs "$OUT" --scores "$SCORES" --out "$ROUT" \
      --max-tokens $(( (budget>0?budget:8192) + 8192 )) || echo "repair.py failed for $label"
  else
    echo "server failed: $label"
  fi
  PORT="$PORT" bash "$SERVE" stop || true ; sleep 2
done

echo "=== grade repaired replies ==="
python3 "$Q/score_typescript.py" selftest >/dev/null || { echo "grader self-check failed; aborting"; exit 4; }
python3 "$Q/score_typescript.py" batch --campaign "$D" --outputs "$ROUT" \
  --out "$D/results/scores_repair.jsonl"
echo "repaired replies: $ROUT   scores: $D/results/scores_repair.jsonl"
echo "compare results/scores_typescript.jsonl (before) vs results/scores_repair.jsonl (after one repair turn)."

#!/usr/bin/env bash
# opus calibration gate for pricing-deferred: 3 reps, one-shot, graded.
set -uo pipefail
cd "$(dirname "$0")/../.."
P=out/cal-io/prompt-pricing-deferred.txt
for rep in 0 1 2; do
  R="out/cal-io/answer-opus-pricing-deferred-rep${rep}.txt"
  if [ -s "$R" ]; then echo "skip (done): rep$rep"; continue; fi
  echo "=== opus rep$rep ==="
  bash claude_ask.sh --prompt "$PWD/$P" --result "$PWD/$R" --cwd "$PWD" --model opus \
    && echo "  wrote $R ($(wc -c < "$R") bytes)" || echo "  FAILED rep$rep"
done
echo "=== grading ==="
for rep in 0 1 2; do
  R="out/cal-io/answer-opus-pricing-deferred-rep${rep}.txt"
  [ -s "$R" ] || { echo "rep$rep: NO ANSWER"; continue; }
  python3 score_typescript.py response --response-file "$R" \
    --task ts-harness/tasks/pricing-deferred --id "opus-rep${rep}" \
    > "out/cal-io/score-opus-rep${rep}.json" 2>&1 || echo "rep$rep grade error"
done
echo "DONE"

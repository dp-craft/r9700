#!/bin/bash
# ladder.sh LABEL PROFILE [ENV=VAL ...]
#   Context ladder on top of claudetest.sh: MAXLEN = START, START+STEP, ... END (default 120000..180000 by 15000),
#   RUNS (default 2) gate runs per step. Stops at the first non-PASS (FAULT, CLAUDE_FAIL or BOOT_FAILED) so the
#   last fully-PASSed step is the largest ctx with evidence. Compaction per step comes from claudetest.sh
#   (AUTOCOMPACT_PCT default = min(75, safe limit - 3)). Each run is labelled LABEL-<maxlen/1000>k-rN in results.tsv.
#   Why (2026-10-22): the fault depends on memory layout and the KV pool size moves the layout, so one PASS at one
#   ctx (mhist @160k) is luck until it repeats; walk up from a small window instead.
set -u
H=$(cd "$(dirname "$0")" && pwd)
label=$1; shift
START=${START:-120000}; STEP=${STEP:-15000}; END=${END:-180000}; RUNS=${RUNS:-2}
last_ok=none
for M in $(seq "$START" "$STEP" "$END"); do
  for r in $(seq 1 "$RUNS"); do
    l=$label-$((M / 1000))k-r$r
    MAXLEN=$M bash "$H/claudetest.sh" "$l" "$@"
    res=$(awk -F'\t' -v l="$l" '$2 == l { r = $4 } END { print r }' "$H/results.tsv")
    [ "$res" = PASS ] || { echo "[$label] LADDER STOP at $M run $r: $res  (last fully-passed ctx: $last_ok)"; exit 1; }
  done
  last_ok=$M
done
echo "[$label] LADDER PASS up to $last_ok ($RUNS runs per step)"

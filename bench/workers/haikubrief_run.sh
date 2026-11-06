#!/usr/bin/env bash
# haikubrief_run.sh TAG PROMPT_FILE [REPS]: Ornith on Haiku's exact brief and set S of the 2026-11-04 run, PROMPT_FILE replacing
# Claude Code's prompt, REPS sessions in parallel (default 3). Each rep gets its own ROOT with the same MANIFEST (read-only fixtures).
# Out: $SP/hb/<TAG>-<rep>/out-<TAG>/NN.txt, meta/{raw.json,timing.json,brief.txt}; one VRAM sample file for the batch.
# Hand-written (iron rule 6): prompt_run.py runs one report per session on the newer briefs; the old run_local.sh can't swap the prompt.
set -u
TAG=$1; PROMPT=$2; REPS=${3:-3}
OLD=/home/dev/work/dp-craft/amd/campaigns/workers/2026-11-04-2207-docanalysis-ornith-vs-haiku
SP=/tmp/claude-1001/-home-dev-work-dp-craft-amd/bf832afa-1002-41d9-a4b8-4b201a1bc43c/scratchpad
ORN=/home/dev/work/dippe/skills-agents/skills/ornith/scripts/ornith.sh
[ -f "$PROMPT" ] || { echo "no prompt file $PROMPT" >&2; exit 2; }
PROMPT=$(realpath "$PROMPT")  # each session runs from its own ROOT
mkdir -p "$SP/hb"
python3 /home/dev/work/dp-craft/amd/stack/gpu/vram_sampler.py --out "$SP/hb/$TAG-gpu.csv" --interval 1 & VS=$!
P=()
for i in $(seq 1 "$REPS"); do
  ROOT=$SP/hb/$TAG-$i; M=$ROOT/meta
  [ -e "$ROOT/out-$TAG" ] && { echo "$TAG-$i exists, skipped" >&2; continue; }
  mkdir -p "$M" "$ROOT/out-$TAG"; cp "$OLD/S/MANIFEST.txt" "$ROOT/"
  sed -e "s#__ROOT__#$ROOT#g" -e "s#__ARM__#$TAG#g" "$OLD/harness/brief.txt" > "$M/brief.txt"
  ( cd "$ROOT"; T0=$(date +%s.%N)
    ORNITH_PROMPT=none ORNITH_OUT=$M/raw.json timeout 1500 "$ORN" --profile read "$(cat "$M/brief.txt")" \
      --system-prompt-file "$PROMPT" > "$M/result.txt" 2>&1; RC=$?
    echo "{\"rc\":$RC,\"wall_s\":$(echo "$(date +%s.%N)-$T0" | bc)}" > "$M/timing.json" ) & P+=($!)
  sleep 3
done
[ ${#P[@]} -gt 0 ] && wait "${P[@]}"
kill $VS 2>/dev/null; wait $VS 2>/dev/null
for i in $(seq 1 "$REPS"); do echo "$TAG-$i $(cat "$SP/hb/$TAG-$i/meta/timing.json" 2>/dev/null) notes=$(ls "$SP/hb/$TAG-$i/out-$TAG" 2>/dev/null | wc -l)"; done
python3 -c "import csv,sys; r=list(csv.DictReader(open(sys.argv[1]))); k=[c for c in r[0] if 'vram' in c and 'used' in c][0]; print('peak',k,max(float(x[k]) for x in r))" "$SP/hb/$TAG-gpu.csv" 2>/dev/null

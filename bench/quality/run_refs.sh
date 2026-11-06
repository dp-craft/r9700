#!/usr/bin/env bash
# run_refs.sh — collect the REFERENCE LADDER (haiku/sonnet/opus) at N reps for every matrix task,
# grade it with the SAME grader as the local cells, and emit calibration-reps.jsonl.
#
# WHY THIS EXISTS (CLAUDE.md rule 6): no tool owns "collect the reference ladder across
# models x tasks x reps". out/cal-io/run_cal.sh was the one-off ancestor (opus x pricing-deferred
# x 3 reps); this generalizes it to the full matrix. It is GLUE ONLY — it composes existing tools
# and adds no prompting/grading logic of its own:
#   build_context.py --tokens 0   -> the one-shot prompt
#   claude_ask.sh                 -> one interactive tmux claude session per answer
#   score_typescript.py response  -> the same grader the local cells were scored with
#
# WHY THE REFERENCES ARE ONE-SHOT (--tokens 0, NO 120k filler): the reference ladder measures
# CAPABILITY, not capability-at-depth. It is therefore NOT depth-matched to the local cells, and a
# ref-vs-local delta is NOT like-for-like — the local models carry ~133k of context the refs never
# see. This is a KNOWN, DOCUMENTED asymmetry (README / analysis.md); do not quote a bare delta.
#
# WHY REPS: at the measured rep noise a SINGLE reference sample carries roughly +/-19 pts, which is
# why the n=1 ladder could never be quoted as a like-for-like gap. 3 reps collapse that; aggregate.py
# reads the `rep` field and reports mean+-sd and hard_pass as k/n.
#
# RESUMABLE: a non-empty answer file is skipped, so the 3 opus x pricing-deferred reps already in
# out/cal-io/ are reused (identical naming; their prompt is byte-identical to today's build — verified).
#
# USAGE
#   bash run_refs.sh                              # full matrix (3 models x 5 tasks x 3 reps)
#   MODELS=opus bash run_refs.sh                  # one model
#   ONLY=pricing-deferred bash run_refs.sh        # one task
#   REPS=1 bash run_refs.sh                       # quick
#   GRADE_ONLY=1 bash run_refs.sh                 # re-grade + re-emit jsonl, ask nothing
#
# THEN:
#   python3 aggregate.py --dir out --by-task --calib-files calibration-reps.jsonl --out out/summary.md
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"

: "${MODELS:=haiku sonnet opus}"
: "${REPS:=3}"
: "${ONLY:=}"
: "${GRADE_ONLY:=}"
CAL="out/cal-io"
OUT="calibration-reps.jsonl"
# The `grader` provenance label comes FROM score_typescript.py (GRADER constant) — it is not stamped
# here. A label typed by the caller can claim a grader the rows were never scored with; one emitted
# by the grader itself cannot.

mkdir -p "$CAL"

# Tasks = exactly the matrix tasks the local cells ran (tasks.jsonl matrix != false), so the
# reference ladder covers the same task set the digest compares against.
mapfile -t TASKS < <(python3 -c "
import json
for l in open('tasks.jsonl'):
    r = json.loads(l)
    if r.get('matrix') is not False:
        print(r['id'])")
[ -n "${ONLY}" ] && mapfile -t TASKS < <(printf '%s\n' "${TASKS[@]}" | grep -x -- "$ONLY")
[ "${#TASKS[@]}" -gt 0 ] || { echo "run_refs: no tasks selected (ONLY=$ONLY)" >&2; exit 2; }

echo "tasks : ${TASKS[*]}"
echo "models: $MODELS"
echo "reps  : $REPS"
echo

# --- 1. prompts (one-shot, no filler) -------------------------------------------------------------
# ALWAYS rebuild and compare. A cache keyed on mere existence is how a stale prompt silently gets
# reused after a task edit — the exact bug that would have made new reps incomparable to old ones.
for t in "${TASKS[@]}"; do
  p="$CAL/prompt-$t.txt"
  tmp="$(mktemp)"
  python3 build_context.py --task "ts-harness/tasks/$t" --tokens 0 --out "$tmp" >/dev/null 2>&1 \
    || { echo "run_refs: build_context failed for $t" >&2; rm -f "$tmp"; exit 1; }
  if [ -s "$p" ] && ! diff -q "$tmp" "$p" >/dev/null 2>&1; then
    n=$(ls "$CAL"/answer-*-"$t"-rep*.txt 2>/dev/null | wc -l)
    echo "WARNING: prompt for '$t' CHANGED since the existing answers were collected." >&2
    echo "         $n existing answer(s) are NOT comparable to new reps. Delete them to re-collect." >&2
  fi
  mv "$tmp" "$p"
done

# --- 2. collect answers ---------------------------------------------------------------------------
if [ -z "$GRADE_ONLY" ]; then
  todo=0
  for m in $MODELS; do for t in "${TASKS[@]}"; do for ((rep=0; rep<REPS; rep++)); do
    [ -s "$CAL/answer-$m-$t-rep$rep.txt" ] || todo=$((todo+1))
  done; done; done
  echo "answers to collect: $todo (existing are skipped)"
  echo

  for m in $MODELS; do
    for t in "${TASKS[@]}"; do
      for ((rep=0; rep<REPS; rep++)); do
        R="$CAL/answer-$m-$t-rep$rep.txt"
        if [ -s "$R" ]; then echo "skip (done): $m $t rep$rep"; continue; fi
        echo "=== $m $t rep$rep ==="
        bash claude_ask.sh --prompt "$HERE/$CAL/prompt-$t.txt" --result "$HERE/$R" \
                           --cwd "$HERE" --model "$m" \
          && echo "  wrote $R ($(wc -c < "$R" 2>/dev/null || echo 0) bytes)" \
          || echo "  FAILED: $m $t rep$rep"
      done
    done
  done
  echo
fi

# --- 3. grade + emit ------------------------------------------------------------------------------
# Rebuilt from scratch every run so the file always reflects the answers actually on disk.
echo "=== grading ==="
: > "$OUT"
for m in $MODELS; do
  for t in "${TASKS[@]}"; do
    for ((rep=0; rep<REPS; rep++)); do
      R="$CAL/answer-$m-$t-rep$rep.txt"
      S="$CAL/score-$m-$t-rep$rep.json"
      [ -s "$R" ] || { echo "  NO ANSWER: $m $t rep$rep"; continue; }
      if [ ! -s "$S" ]; then
        python3 score_typescript.py response --response-file "$R" --task "ts-harness/tasks/$t" \
                --id "$m-$t-rep$rep" > "$S" 2>"$S.err" || echo "  grade error: $m $t rep$rep"
      fi
      python3 - "$S" "$m" "$t" "$rep" >> "$OUT" <<'PY'
import json, sys
p, m, t, rep = sys.argv[1:5]
try:
    d = json.load(open(p))
except Exception as e:
    print(f"  BAD SCORE JSON: {p} ({e})", file=sys.stderr)
    sys.exit(0)
if not d.get("grader"):
    print(f"  WARNING: {p} has no grader field — stale score file? delete it to re-grade",
          file=sys.stderr)
d["model"] = m
d["task"] = t
d["rep"] = int(rep)
print(json.dumps(d))
PY
    done
  done
done

n=$(wc -l < "$OUT" 2>/dev/null || echo 0)
echo
echo "wrote $OUT ($n rows)"
python3 - "$OUT" <<'PY'
import json, sys, collections, statistics as st
rows = [json.loads(l) for l in open(sys.argv[1])]
acc = collections.defaultdict(list)
for r in rows:
    acc[(r["model"], r["task"])].append(r)
print(f"{'model':8s} {'task':18s} {'n':>2s} {'mean%':>6s} {'sd':>5s}  hard_pass")
for (m, t), v in sorted(acc.items()):
    s = [x["score"] for x in v if x.get("score") is not None]
    hp = sum(1 for x in v if x.get("hard_pass"))
    sd = f"{st.stdev(s)*100:5.1f}" if len(s) > 1 else "    -"
    print(f"{m:8s} {t:18s} {len(v):2d} {st.mean(s)*100:6.1f} {sd}  {hp}/{len(v)}")
missing = [f"{m} x {t}" for (m, t), v in acc.items() if len(v) < int(__import__('os').environ.get('REPS', 3))]
if missing:
    print("\nINCOMPLETE (fewer reps than requested): " + ", ".join(sorted(missing)))
PY
echo
echo "next: python3 aggregate.py --dir out --by-task --calib-files $OUT --out out/summary.md"

#!/usr/bin/env bash
# One-off A/B driver (no repo tool runs a headless agentic task; iron rule 6 exception, stated in the analysis doc):
# run dp-forge's 27B brief-fix RUNBOOK (W2-06..W2-08 left) with ONE local model in its own git worktree, capture everything.
# Usage: run_arm.sh heretic|redhat OUTROOT        Knobs: CAP_S (10800 wall-clock cap for the whole session) MAX_RESUMES (5)
set -uo pipefail
ARM=$1; OUT=$2/$ARM; mkdir -p "$OUT"
FORGE=/home/dev/work/dippe/dp-forge
BASE=de110510
WT=/home/dev/work/dippe/dpf-bench-$ARM
P=docs/plans/2026-10-28-2239-dpf-tui-f0-f1
AMD=/home/dev/work/dp-craft/amd
CAP_S=${CAP_S:-10800}; MAX_RESUMES=${MAX_RESUMES:-5}
case $ARM in
  heretic) SRV=$FORGE/vllm-heretic.sh; SET=/home/dev/.config/claude/local_vllm_direct/settings.json;;
  redhat)  SRV=$FORGE/vllm.sh;         SET=/home/dev/.config/claude/local_vllm_direct/settings-redhat.json;;
  *) echo "arm?" >&2; exit 2;;
esac
# the user's 2026-10-29 runbook prompt, first paragraph verbatim (the "Opus reviews not written yet" paragraph is obsolete)
PROMPT='Run docs/plans/2026-10-28-2239-dpf-tui-f0-f1/review/27b-fix/RUNBOOK.md: read it whole first
(cat, it is short), then follow it exactly, one brief at a time. If review/27b-fix/progress.md
exists, resume after its last line.'
RESUME='Continue: follow docs/plans/2026-10-28-2239-dpf-tui-f0-f1/review/27b-fix/RUNBOOK.md exactly; resume after the last line of review/27b-fix/progress.md.'
log(){ echo "$(date +%H:%M:%S) [$ARM] $*" | tee -a "$OUT/driver.log"; }
fp(){ (cd "$FORGE" && git rev-parse HEAD && git status --porcelain && git diff | md5sum && git ls-files -o --exclude-standard -z | xargs -0 -r md5sum); }

# 1. worktree at the base + the uncommitted inputs (3 briefs written by the 27B, progress.md with the 9 W1 lines)
[ -e "$WT" ] && { log "worktree $WT exists -- refusing"; exit 1; }
git -C "$FORGE" worktree add --detach "$WT" "$BASE" >"$OUT/worktree-add.txt" 2>&1 || { log "worktree add failed"; exit 1; }
for f in briefs/W2-06.md briefs/W2-07.md briefs/W2-08.md review/27b-fix/progress.md; do cp -p "$FORGE/$P/$f" "$WT/$P/$f"; done
# the W2 briefs (line 2) and the writer-brief template name the main checkout: point them at this worktree
sed -i "s#/home/dev/work/dippe/dp-forge#$WT#g" "$WT/$P"/briefs/W2-0[678].md "$WT/$P/01-writer-brief.md"
for nm in node_modules tools/node_modules tools/task-dag/node_modules tools/speckit-orchestrator/node_modules tools/spec-pipeline/node_modules; do
  ln -s "$FORGE/$nm" "$WT/$nm"; done
mkdir -p "$OUT/inputs"; cp -p "$WT/$P"/briefs/W2-0[678].md "$WT/$P/review/27b-fix/progress.md" "$OUT/inputs/"
git -C "$WT" status --porcelain > "$OUT/wt-status-before.txt"

# 2. shared scratch the RUNBOOK allows (/tmp/dp-refine/) starts empty; main-checkout fingerprint for the stray-write check
[ -d /tmp/dp-refine ] && mv /tmp/dp-refine "$OUT/dp-refine-preexisting"
fp > "$OUT/main-fp-before.txt"

# 3. server (gpu_exclusive floor inside serve_vllm.sh) + VRAM sampler
log "booting $SRV"
if ! "$SRV" start > "$OUT/server-start.txt" 2>&1; then log "server start failed: $(tail -2 "$OUT/server-start.txt" | tr '\n' ' ')"; exit 1; fi
cp "$AMD/bench/.servers/8000.cmdline" "$OUT/server.cmdline"
python3 "$AMD/bench/lib/vram_sampler.py" --out "$OUT/gpu_samples.csv" --interval 2 >/dev/null 2>&1 & SAMP=$!

# 4. the session; resume (same session) while fewer than 3 W2 lines are recorded, within the cap
w2done(){ grep -c '^W2-0[678] |' "$WT/$P/review/27b-fix/progress.md" 2>/dev/null || true; }
sid_of(){ python3 -c 'import json,sys
for l in open(sys.argv[1]):
    try: d=json.loads(l)
    except Exception: continue
    if d.get("session_id"): print(d["session_id"]); break' "$1" 2>/dev/null; }
T0=$(date +%s); n=0; sid=""
cd "$WT" || exit 1
while :; do
  left=$(( CAP_S - ($(date +%s) - T0) )); [ "$left" -gt 60 ] || { log "cap reached"; break; }
  if [ "$n" -eq 0 ]; then args=(-p "$PROMPT"); else args=(-p "$RESUME" --resume "$sid"); fi
  log "claude call $n (left ${left}s, W2 lines $(w2done))"
  timeout -k 60 --signal=INT "$left" claude "${args[@]}" --settings "$SET" --dangerously-skip-permissions \
    --output-format stream-json --verbose < /dev/null > "$OUT/session-$n.jsonl" 2> "$OUT/session-$n.err"
  rc=$?; s=$(sid_of "$OUT/session-$n.jsonl"); [ -n "$s" ] && sid=$s
  log "call $n rc=$rc session=$sid W2 lines $(w2done)"
  [ "$(w2done)" -ge 3 ] && { log "all 3 W2 lines recorded"; break; }
  [ -n "$sid" ] || { log "no session id -- stop"; break; }
  n=$((n+1)); [ "$n" -le "$MAX_RESUMES" ] || { log "max resumes reached"; break; }
done
echo "arm=$ARM wall_s=$(( $(date +%s) - T0 )) calls=$((n+1)) session=$sid w2_lines=$(w2done)" > "$OUT/summary.txt"

# 5. teardown, verified
kill "$SAMP" 2>/dev/null; wait "$SAMP" 2>/dev/null
"$SRV" stop > "$OUT/server-stop.txt" 2>&1
sleep 5; ss -ltn | grep -q ':8000 ' && log "WARNING port 8000 still held"

# 6. collect
git -C "$WT" status --porcelain > "$OUT/wt-status-after.txt"; git -C "$WT" diff > "$OUT/wt.diff"
mkdir -p "$OUT/outputs"
cp -p "$WT/$P"/briefs/W2-0[678].md "$WT/$P/review/27b-fix/progress.md" "$OUT/outputs/" 2>/dev/null
cp -p "$WT/$P"/review/W2-0*.refine-27b.md "$WT/$P"/review/27b-fix/W2-0*.compare.md "$OUT/outputs/" 2>/dev/null
[ -d /tmp/dp-refine ] && mv /tmp/dp-refine "$OUT/dp-refine"
pd="$HOME/.claude/projects/$(echo "$WT" | sed 's#[^A-Za-z0-9]#-#g')"; [ -d "$pd" ] && cp -r "$pd" "$OUT/claude-project"
fp > "$OUT/main-fp-after.txt"
if cmp -s "$OUT/main-fp-before.txt" "$OUT/main-fp-after.txt"; then log "main checkout untouched"; else log "MAIN CHECKOUT CHANGED during the arm -- see main-fp-*.txt"; fi
log "done: $(cat "$OUT/summary.txt")"

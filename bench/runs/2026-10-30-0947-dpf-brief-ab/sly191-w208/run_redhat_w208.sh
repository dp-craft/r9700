#!/usr/bin/env bash
# One-off driver (iron rule 6 exception, as run_arm.sh of 2026-10-30-0947-dpf-brief-ab): RedHat only, W2-08 only, on
# Sly 1.9.1 defaults (Cactus 0.5 + fade/cap, template v22.5-sly2), with the optimized RUNBOOK in a fresh worktree.
# Same inputs, prompts, client settings, cap and resume policy as the 2026-10-30 delta-0 W2-08 run, so the table can
# compare them. Usage: run_redhat_w208.sh OUTDIR      Knobs: CAP_S (10800) MAX_RESUMES (5) IMAGE
set -uo pipefail
OUT=$1; mkdir -p "$OUT"
FORGE=/home/dev/work/dippe/dp-forge
PREV=/home/dev/work/dp-craft/amd/bench/runs/2026-10-30-0947-dpf-brief-ab
BASE=de110510
WT=/home/dev/work/dippe/dpf-bench-redhat191
P=docs/plans/2026-10-28-2239-dpf-tui-f0-f1
AMD=/home/dev/work/dp-craft/amd
HERE=$(cd "$(dirname "$0")" && pwd)
CAP_S=${CAP_S:-10800}; MAX_RESUMES=${MAX_RESUMES:-5}
export IMAGE=${IMAGE:-ghcr.io/slybase/vllm-sly-radiance:1.9.1-rocm10.1}
SRV=$FORGE/vllm.sh; SET=/home/dev/.config/claude/local_vllm_direct/settings-redhat.json
PROMPT='Run docs/plans/2026-10-28-2239-dpf-tui-f0-f1/review/27b-fix/RUNBOOK.md for brief W2-08 only (W2-06 and W2-07
are out of scope): read it whole first (cat, it is short), then follow it exactly.'
RESUME='Continue: follow docs/plans/2026-10-28-2239-dpf-tui-f0-f1/review/27b-fix/RUNBOOK.md exactly for brief W2-08 only (W2-06 and W2-07 are out of scope); resume where you stopped.'
log(){ echo "$(date +%H:%M:%S) [redhat191] $*" | tee -a "$OUT/driver.log"; }
fp(){ (cd "$FORGE" && git rev-parse HEAD && git status --porcelain && git diff | md5sum && git ls-files -o --exclude-standard -z | xargs -0 -r md5sum); }

# 1. worktree at the base + the inputs the delta-0 run got (heretic/inputs) + the optimized RUNBOOK
[ -e "$WT" ] && { log "worktree $WT exists -- refusing"; exit 1; }
git -C "$FORGE" worktree add --detach "$WT" "$BASE" >"$OUT/worktree-add.txt" 2>&1 || { log "worktree add failed"; exit 1; }
cp -p "$PREV"/heretic/inputs/W2-0[678].md "$WT/$P/briefs/"; cp -p "$PREV/heretic/inputs/progress.md" "$WT/$P/review/27b-fix/"
sed -i "s#/home/dev/work/dippe/dpf-bench-heretic#$WT#g" "$WT/$P"/briefs/W2-0[678].md
sed -i "s#/home/dev/work/dippe/dp-forge#$WT#g" "$WT/$P/01-writer-brief.md"
cp "$HERE/RUNBOOK.optimized.md" "$WT/$P/review/27b-fix/RUNBOOK.md"
for nm in node_modules tools/node_modules tools/task-dag/node_modules tools/speckit-orchestrator/node_modules tools/spec-pipeline/node_modules; do
  ln -s "$FORGE/$nm" "$WT/$nm"; done
mkdir -p "$OUT/inputs"; cp -p "$WT/$P"/briefs/W2-08.md "$WT/$P/review/27b-fix/progress.md" "$WT/$P/review/27b-fix/RUNBOOK.md" "$OUT/inputs/"
git -C "$WT" status --porcelain > "$OUT/wt-status-before.txt"
[ -d /tmp/dp-refine ] && mv /tmp/dp-refine "$OUT/dp-refine-preexisting"
fp > "$OUT/main-fp-before.txt"

# 2. server (gpu_exclusive floor inside serve_vllm.sh) + VRAM sampler
log "booting $SRV with IMAGE=$IMAGE"
if ! "$SRV" start > "$OUT/server-start.txt" 2>&1; then log "server start failed: $(tail -2 "$OUT/server-start.txt" | tr '\n' ' ')"; exit 1; fi
cp "$AMD/bench/.servers/8000.cmdline" "$OUT/server.cmdline"
docker exec vllm-8000 head -1 /opt/qwen-fixed.jinja > "$OUT/template-version.txt" 2>&1
python3 "$AMD/bench/lib/vram_sampler.py" --out "$OUT/gpu_samples.csv" --interval 2 >/dev/null 2>&1 & SAMP=$!

# 3. the session; resume (same session) until the W2-08 progress line, within the cap
w208(){ grep -c '^W2-08 |' "$WT/$P/review/27b-fix/progress.md" 2>/dev/null || true; }
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
  log "claude call $n (left ${left}s, W2-08 line $(w208))"
  timeout -k 60 --signal=INT "$left" claude "${args[@]}" --settings "$SET" --dangerously-skip-permissions \
    --output-format stream-json --verbose < /dev/null > "$OUT/session-$n.jsonl" 2> "$OUT/session-$n.err"
  rc=$?; s=$(sid_of "$OUT/session-$n.jsonl"); [ -n "$s" ] && sid=$s
  log "call $n rc=$rc session=$sid W2-08 line $(w208)"
  [ "$(w208)" -ge 1 ] && { log "W2-08 line recorded"; break; }
  [ -n "$sid" ] || { log "no session id -- stop"; break; }
  [ "$n" -lt "$MAX_RESUMES" ] || { log "max resumes reached"; break; }
  n=$((n+1))
done
echo "wall_s=$(( $(date +%s) - T0 )) claude_calls=$((n+1)) session=$sid w208_line=$(w208)" > "$OUT/summary.txt"

# 4. teardown, verified
kill "$SAMP" 2>/dev/null; wait "$SAMP" 2>/dev/null
docker logs vllm-8000 > "$OUT/server-container.log" 2>&1
"$SRV" stop > "$OUT/server-stop.txt" 2>&1
sleep 5; ss -ltn | grep -q ':8000 ' && log "WARNING port 8000 still held"

# 5. collect
git -C "$WT" status --porcelain > "$OUT/wt-status-after.txt"; git -C "$WT" diff > "$OUT/wt.diff"
mkdir -p "$OUT/outputs"
cp -p "$WT/$P"/briefs/W2-08.md "$WT/$P/review/27b-fix/progress.md" "$OUT/outputs/" 2>/dev/null
cp -p "$WT/$P"/review/W2-08.refine-27b.md "$WT/$P"/review/27b-fix/W2-08.compare.md "$OUT/outputs/" 2>/dev/null
[ -d /tmp/dp-refine ] && mv /tmp/dp-refine "$OUT/dp-refine"
pd="$HOME/.claude/projects/$(echo "$WT" | sed 's#[^A-Za-z0-9]#-#g')"; [ -d "$pd" ] && cp -r "$pd" "$OUT/claude-project"
fp > "$OUT/main-fp-after.txt"
if cmp -s "$OUT/main-fp-before.txt" "$OUT/main-fp-after.txt"; then log "main checkout untouched"; else log "MAIN CHECKOUT CHANGED during the run -- see main-fp-*.txt"; fi
log "done: $(cat "$OUT/summary.txt")"

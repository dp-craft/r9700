#!/usr/bin/env bash
# W2-08 to the end on RedHat with CACTUS_DELTA=0 (user, 2026-10-30: "fastest first"). Resumes the replay's capture session
# (same worktree, same session; stopped by run_replay.sh after Part 1 of the blind review) and lets it finish W2-08:
# Part 2, compare, fix, progress line. One-off: run_arm.sh almost fits (its patterns are reused here), but its prompt
# covers all three briefs and it builds a fresh worktree; this continues the existing one.
# Usage: continue_w208.sh RUNROOT     Knobs: CAP_S (3600) MAX_RESUMES (3)
# Output: RUNROOT/delta0-w208/ -- session-0.jsonl is a copy of replay/capture-session.jsonl (the first 4.5 min, same session)
set -uo pipefail
ROOT=$1; R=$ROOT/replay; OUT=$ROOT/delta0-w208; mkdir -p "$OUT"
FORGE=/home/dev/work/dippe/dp-forge; WT=/home/dev/work/dippe/dpf-bench-replay; P=docs/plans/2026-10-28-2239-dpf-tui-f0-f1
AMD=/home/dev/work/dp-craft/amd; SRV=$FORGE/vllm.sh; SET=/home/dev/.config/claude/local_vllm_direct/settings-redhat.json
CAP_S=${CAP_S:-3600}; MAX_RESUMES=${MAX_RESUMES:-3}
RESUME='Continue: follow docs/plans/2026-10-28-2239-dpf-tui-f0-f1/review/27b-fix/RUNBOOK.md exactly for brief W2-08 only (W2-06 and W2-07 are out of scope); resume where you stopped.'
log(){ echo "$(date +%H:%M:%S) [w208] $*" | tee -a "$OUT/driver.log"; }
fp(){ (cd "$FORGE" && git rev-parse HEAD && git status --porcelain && git diff | md5sum && git ls-files -o --exclude-standard -z | xargs -0 -r md5sum); }
done08(){ grep -c '^W2-08 |' "$WT/$P/review/27b-fix/progress.md" 2>/dev/null; true; }
sid_of(){ python3 -c 'import json,sys
for l in open(sys.argv[1]):
    try: d=json.loads(l)
    except Exception: continue
    if d.get("session_id"): print(d["session_id"]); break' "$1" 2>/dev/null; }

[ -d /tmp/dp-refine ] && { log "/tmp/dp-refine exists -- refusing"; exit 1; }
cp -p "$R/capture-session.jsonl" "$OUT/session-0.jsonl"; sid=$(sid_of "$OUT/session-0.jsonl")
[ -n "$sid" ] || { log "no session id in the capture"; exit 1; }
git -C "$WT" status --porcelain > "$OUT/wt-status-before.txt"
mkdir -p "$OUT/inputs"; cp -p "$R/capture-W2-08.refine-27b.md" "$OUT/inputs/W2-08.refine-27b.part1.md"
fp > "$OUT/main-fp-before.txt"

log "booting $SRV with CACTUS_DELTA=0"
if ! env -u EXTRA_ARGS CACTUS_DELTA=0 "$SRV" start > "$OUT/server-start.txt" 2>&1; then log "server start failed: $(tail -2 "$OUT/server-start.txt" | tr '\n' ' ')"; exit 1; fi
cp "$AMD/stack/serve/var/servers/8000.cmdline" "$OUT/server.cmdline"
log "$(grep -o 'RADIANCE_CACTUS_DELTA=[0-9.]*' "$OUT/server.cmdline")"
python3 "$AMD/stack/gpu/vram_sampler.py" --out "$OUT/gpu_samples.csv" --interval 2 >/dev/null 2>&1 & SAMP=$!

T0=$(date +%s); n=1
cd "$WT" || exit 1
while :; do
  left=$(( CAP_S - ($(date +%s) - T0) )); [ "$left" -gt 60 ] || { log "cap reached"; break; }
  log "claude call $n (resume $sid, left ${left}s, W2-08 lines $(done08))"
  timeout -k 60 --signal=INT "$left" claude -p "$RESUME" --resume "$sid" --settings "$SET" --dangerously-skip-permissions \
    --output-format stream-json --verbose < /dev/null > "$OUT/session-$n.jsonl" 2> "$OUT/session-$n.err"
  rc=$?; s=$(sid_of "$OUT/session-$n.jsonl"); [ -n "$s" ] && sid=$s
  log "call $n rc=$rc session=$sid W2-08 lines $(done08)"
  [ "$(done08)" -ge 1 ] && { log "W2-08 line recorded"; break; }
  [ "$n" -lt "$MAX_RESUMES" ] || { log "max resumes reached"; break; }
  n=$((n+1))
done
echo "wall_s=$(( $(date +%s) - T0 )) continuation_calls=$n session=$sid w2_08_lines=$(done08) (plus the 4.5 min capture, session-0)" > "$OUT/summary.txt"

kill "$SAMP" 2>/dev/null; wait "$SAMP" 2>/dev/null
"$SRV" stop > "$OUT/server-stop.txt" 2>&1; cp "$AMD/stack/serve/var/servers/8000.log" "$OUT/server-container.log" 2>/dev/null
sleep 5; ss -ltn | grep -q ':8000 ' && log "WARNING port 8000 still held"

git -C "$WT" status --porcelain > "$OUT/wt-status-after.txt"; git -C "$WT" diff > "$OUT/wt.diff"
mkdir -p "$OUT/outputs"
cp -p "$WT/$P/briefs/W2-08.md" "$WT/$P/review/27b-fix/progress.md" "$WT/$P/review/W2-08.refine-27b.md" "$OUT/outputs/" 2>/dev/null
cp -p "$WT/$P/review/27b-fix/W2-08.compare.md" "$OUT/outputs/" 2>/dev/null
[ -d /tmp/dp-refine ] && mv /tmp/dp-refine "$OUT/dp-refine"
pd="$HOME/.claude/projects/$(echo "$WT" | sed 's#[^A-Za-z0-9]#-#g')"; [ -d "$pd" ] && cp -r "$pd" "$OUT/claude-project"
fp > "$OUT/main-fp-after.txt"
if cmp -s "$OUT/main-fp-before.txt" "$OUT/main-fp-after.txt"; then log "main checkout untouched"; else log "MAIN CHECKOUT CHANGED -- see main-fp-*.txt"; fi
log "done: $(cat "$OUT/summary.txt")"

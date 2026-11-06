#!/usr/bin/env bash
# Early stop for run_replay.sh (user, 2026-10-30: "if the run looks stable then maybe no reason to continue").
# Waits for the B capture to finish (body picked, or capture failed). If the capture session was stable -- no thinking
# block > 100k chars and no output-cap hit -- it kills the replay chain (process group CHAIN_PGID), stops the server,
# then runs only the control: arm A (Cactus 0.5) x N_A on the captured body. Unstable -> leaves the chain running (full A/B).
# Usage: stop_if_stable.sh RUNROOT CHAIN_PGID
set -uo pipefail
ROOT=$1; PG=$2; OUT=$ROOT/replay; L=$OUT/driver.log; N_A=${N_A:-3}
HERE=$(dirname "$(readlink -f "$0")"); FORGE=/home/dev/work/dippe/dp-forge; AMD=/home/dev/work/dp-craft/amd
log(){ echo "$(date +%H:%M:%S) [watch] $*" | tee -a "$L"; }
# trigger on the "replay B x" line: the body is fully written and the smoke is done (a B rep cut here writes nothing)
until grep -qE 'replay B x|capture failed|nothing to replay|smoke B failed' "$L"; do sleep 2; done
grep -q 'replay B x' "$L" || { log "capture/smoke failed -- chain aborts on its own, nothing to do"; exit 0; }
V=$(python3 - "$OUT/capture-session.jsonl" <<'EOF'
import json, sys
big = cap = 0
for l in open(sys.argv[1], errors="replace"):
    try: d = json.loads(l)
    except Exception: continue
    if d.get("type") == "assistant":
        big += sum(len(c.get("thinking", "")) > 100000 for c in d["message"].get("content") or [] if c.get("type") == "thinking")
    elif d.get("type") == "user":
        cap += "Output token limit hit" in json.dumps(d.get("message", {}).get("content"))
print(f"{'stable' if big == 0 and cap == 0 else 'unstable'} runaway_blocks={big} cap_hits={cap}")
EOF
)
log "B capture: $V"
case $V in stable*) ;; *) log "not stable -- full A/B continues"; exit 0;; esac
kill -TERM -"$PG" 2>/dev/null; sleep 3; kill -KILL -"$PG" 2>/dev/null
log "chain stopped (B replays skipped); stopping the B server"
"$FORGE/vllm.sh" stop > "$OUT/server-stop-B.txt" 2>&1; cp "$AMD/bench/.servers/8000.log" "$OUT/server-container-B.log" 2>/dev/null
for i in $(seq 30); do ss -ltn | grep -q ':8000 ' || break; sleep 2; done
ss -ltn | grep -q ':8000 ' && { log "port 8000 still held -- not booting A"; exit 1; }
log "control: arm A (Cactus 0.5) x$N_A on the same body"
ARMS=A N=$N_A bash "$HERE/run_replay.sh" "$ROOT"
log "control done"

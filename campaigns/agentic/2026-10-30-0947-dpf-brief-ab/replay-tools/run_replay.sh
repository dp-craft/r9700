#!/usr/bin/env bash
# Replay A/B for the RedHat thinking loop (see ../redhat-loop-research.md). One-off (iron rule 6 exception: no repo tool
# replays a captured agentic request; capture_proxy.py captures, warm_start.sh only warms). Steps:
#  1. capture: one real Claude Code session on RedHat (first arm's server) runs the RUNBOOK for W2-08 only (the brief with
#     the most Opus findings: 19, 6 high) in a fresh worktree, through capture_proxy.py; stopped at its W2-08 blind-review Write.
#  2. pick the request that produced that Write (pick_body.py) = the heaviest reasoning turn.
#  3. replay it N times per server config (replay.py):
#     B  RADIANCE_CACTUS_DELTA=0 (stock lossless acceptance)
#     A  CACTUS_DELTA 0.5 (as run in the A/B)
#     C  CACTUS_DELTA 0.5 + presence_penalty 0.3 (generation-config override; the Anthropic endpoint has no per-request field)
#     D  the checkpoint's own MTP head instead of the DFlash2 drafter (profile sly-redhat/redhat-mxfp4-mtp, k=4), Cactus 0.5
#        as that profile runs -- separates "the DFlash drafter" from "the Cactus acceptance rule" (user's request, 2026-10-30)
# Usage: run_replay.sh RUNROOT      Knobs: N (5) MAXTOK (40000) CAPTURE_CAP_S (2700) ARMS ("B A C D")
set -uo pipefail
ROOT=$1; OUT=$ROOT/replay; mkdir -p "$OUT"
HERE=$(dirname "$(readlink -f "$0")")
FORGE=/home/dev/work/dippe/dp-forge; BASE=de110510; WT=/home/dev/work/dippe/dpf-bench-replay
P=docs/plans/2026-10-28-2239-dpf-tui-f0-f1; AMD=/home/dev/work/dp-craft/amd
SRV=$FORGE/vllm.sh; SET=/home/dev/.config/claude/local_vllm_direct/settings-redhat.json
N=${N:-5}; MAXTOK=${MAXTOK:-40000}; CAPTURE_CAP_S=${CAPTURE_CAP_S:-2700}; ARMS=${ARMS:-"B A C D"}
SERVE=$AMD/stack/serve/vllm/serve_vllm.sh; MTP_NAME=qwen38-27b-redhat-mxfp4-mtp
GEN_C='{"temperature":1.0,"top_p":0.95,"top_k":20,"min_p":0.0,"presence_penalty":0.3}'
PROMPT='Run docs/plans/2026-10-28-2239-dpf-tui-f0-f1/review/27b-fix/RUNBOOK.md for brief W2-08 only (W2-06 and W2-07
are out of scope): read it whole first (cat, it is short), then follow it exactly.'
log(){ echo "$(date +%H:%M:%S) [replay] $*" | tee -a "$OUT/driver.log"; }
fp(){ (cd "$FORGE" && git rev-parse HEAD && git status --porcelain && git diff | md5sum && git ls-files -o --exclude-standard -z | xargs -0 -r md5sum); }

boot(){ case $1 in
    A) env -u CACTUS_DELTA -u EXTRA_ARGS "$SRV" start;;
    B) env -u EXTRA_ARGS CACTUS_DELTA=0 "$SRV" start;;
    C) env -u CACTUS_DELTA EXTRA_ARGS="--override-generation-config $GEN_C" "$SRV" start;;
    # vllm.sh refuses a profile whose served name differs from settings-redhat.json, so D calls serve_vllm.sh with vllm.sh's knobs
    D) env -u CACTUS_DELTA -u EXTRA_ARGS PROFILE=sly-redhat/redhat-mxfp4-mtp PORT=8000 MAXLEN=262000 MAXSEQS=1 KV_DTYPE=fp8 \
         WATCHDOG_MIB=32 GPU_UTIL=0.93 "$SERVE" start;;
  esac > "$OUT/server-start-$1.txt" 2>&1; }
stop(){ "$SRV" stop > "$OUT/server-stop-$1.txt" 2>&1; cp "$AMD/stack/serve/var/servers/8000.log" "$OUT/server-container-$1.log" 2>/dev/null
  sleep 5; ss -ltn | grep -q ':8000 ' && log "WARNING port 8000 still held after $1"; }
review_written(){ python3 - "$1" <<'EOF'
import json, sys
for l in open(sys.argv[1], errors="replace"):
    try: d = json.loads(l)
    except Exception: continue
    if d.get("type") == "assistant":
        for c in d["message"].get("content") or []:
            if c.get("type") == "tool_use" and c.get("name") in ("Write", "Edit") and str((c.get("input") or {}).get("file_path", "")).endswith("W2-08.refine-27b.md"):
                sys.exit(0)
sys.exit(1)
EOF
}

capture(){
  [ -e "$WT" ] && { log "worktree $WT exists -- refusing"; return 1; }
  git -C "$FORGE" worktree add --detach "$WT" "$BASE" > "$OUT/worktree-add.txt" 2>&1 || { log "worktree add failed"; return 1; }
  cp -p "$ROOT"/heretic/inputs/W2-0[678].md "$WT/$P/briefs/"; cp -p "$ROOT/heretic/inputs/progress.md" "$WT/$P/review/27b-fix/"
  sed -i "s#/home/dev/work/dippe/dpf-bench-heretic#$WT#g" "$WT/$P"/briefs/W2-0[678].md
  sed -i "s#/home/dev/work/dippe/dp-forge#$WT#g" "$WT/$P/01-writer-brief.md"
  for nm in node_modules tools/node_modules tools/task-dag/node_modules tools/speckit-orchestrator/node_modules tools/spec-pipeline/node_modules; do
    ln -s "$FORGE/$nm" "$WT/$nm"; done
  [ -d /tmp/dp-refine ] && mv /tmp/dp-refine "$OUT/dp-refine-preexisting"
  fp > "$OUT/main-fp-before.txt"
  python3 -c 'import json,sys; s=json.load(open(sys.argv[1])); s["env"]["ANTHROPIC_BASE_URL"]="http://127.0.0.1:8001"; json.dump(s,open(sys.argv[2],"w"),indent=1)' "$SET" "$OUT/settings-capture.json"
  python3 "$AMD/bench/core/capture_proxy.py" 8001 http://127.0.0.1:8000 "$OUT/capture" > "$OUT/capture-proxy.txt" 2>&1 & PX=$!
  sleep 2
  log "capture session (cap ${CAPTURE_CAP_S}s)"
  (cd "$WT" && exec timeout -k 30 --signal=INT "$CAPTURE_CAP_S" claude -p "$PROMPT" --settings "$OUT/settings-capture.json" \
     --dangerously-skip-permissions --output-format stream-json --verbose < /dev/null > "$OUT/capture-session.jsonl" 2> "$OUT/capture-session.err") & CL=$!
  while kill -0 "$CL" 2>/dev/null; do
    if review_written "$OUT/capture-session.jsonl"; then log "W2-08 blind-review Write seen -- stopping the capture session"; sleep 3; kill -INT "$CL" 2>/dev/null; break; fi
    sleep 5
  done
  wait "$CL" 2>/dev/null; kill "$PX" 2>/dev/null; wait "$PX" 2>/dev/null
  git -C "$WT" status --porcelain > "$OUT/capture-wt-status.txt"
  cp -p "$WT/$P"/review/W2-08.refine-27b.md "$OUT/capture-W2-08.refine-27b.md" 2>/dev/null
  [ -d /tmp/dp-refine ] && mv /tmp/dp-refine "$OUT/capture-dp-refine"
  fp > "$OUT/main-fp-after.txt"
  cmp -s "$OUT/main-fp-before.txt" "$OUT/main-fp-after.txt" && log "main checkout untouched" || log "MAIN CHECKOUT CHANGED -- see main-fp-*.txt"
  review_written "$OUT/capture-session.jsonl" || { log "no W2-08 review Write within the cap -- nothing to replay"; return 1; }
  python3 "$HERE/pick_body.py" "$OUT/capture" "$OUT/body-W2-08.json" 2>&1 | tee -a "$OUT/driver.log"; [ -s "$OUT/body-W2-08.json" ]
}

for arm in $ARMS; do
  log "boot $arm"
  if ! boot "$arm"; then log "boot $arm failed: $(tail -2 "$OUT/server-start-$arm.txt" | tr '\n' ' ')"; stop "$arm"; continue; fi
  cp "$AMD/stack/serve/var/servers/8000.cmdline" "$OUT/server-$arm.cmdline"
  log "$arm: $(grep -o 'RADIANCE_CACTUS_DELTA=[0-9.]*' "$OUT/server-$arm.cmdline") | $(docker logs vllm-8000 2>&1 | grep -o 'overridden by the model.*' | tail -1 | cut -c1-200)"
  if [ "$arm" = C ] && ! docker logs vllm-8000 2>&1 | grep -q "'presence_penalty': 0.3"; then log "C: presence_penalty 0.3 NOT applied -- skipping"; stop C; continue; fi
  if [ ! -s "$OUT/body-W2-08.json" ]; then capture || { stop "$arm"; log "capture failed -- abort"; exit 1; }; fi
  MA=(); [ "$arm" = D ] && MA=(--model "$MTP_NAME")
  python3 "$HERE/replay.py" --body "$OUT/body-W2-08.json" --label "smoke-$arm" --n 1 --out "$OUT/smoke" --max-tokens 64 "${MA[@]}" >> "$OUT/driver.log" 2>&1
  grep -q '"http"' "$OUT/smoke/results.jsonl" 2>/dev/null && { log "smoke $arm failed: $(tail -1 "$OUT/smoke/results.jsonl" | cut -c1-300)"; stop "$arm"; exit 1; }
  log "replay $arm x$N (max_tokens $MAXTOK)"
  python3 "$HERE/replay.py" --body "$OUT/body-W2-08.json" --label "$arm" --n "$N" --out "$OUT" --max-tokens "$MAXTOK" "${MA[@]}" 2>&1 | tee -a "$OUT/driver.log"
  stop "$arm"
done
log "done"

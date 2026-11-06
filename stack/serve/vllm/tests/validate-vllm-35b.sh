#!/usr/bin/env bash
# stack/serve/vllm/tests/validate-vllm-35b.sh — MANUAL GPU validation for the new amd/Qwen3.5-35B-A3B-MXFP4 + z-lab DFlash setup.
#
#   ./validate-vllm-35b.sh            -> prints what it will do, exits (dry-run, nothing touched)
#   ./validate-vllm-35b.sh --yes      -> runs the validation (GPU; takes a long time)
#
# WHAT IT DOES (in order):
#   1. STOPS whatever vLLM container is on port 8000 -- that is likely the 27b server (qwen38-27b-redhat-
#      mxfp4-dflash) which powers the interactive Claude session. Your session will go down. The 27b server
#      comes back with the old launcher (vllm.sh) after this, the 35b one with stack/serve/vllm/retired/qwen35_sly_dflash.sh.
#   2. Fetches the two PINNED checkpoints (resumable; ~25 GB + 772 MB, nice 19 / idle IO):
#        amd/Qwen3.5-35B-A3B-MXFP4@2e19c657  z-lab/Qwen3.5-35B-A3B-DFlash@52cb554b (exact-release drafter)
#   3. Boots profile sly-amd/qwen35-35b-a3b-mxfp4-dflash (Sly 1.9.1, same engine layer as the 27b):
#      first boot compiles (~10 min). serve_vllm.sh enforces the free-VRAM floor (gpu_exclusive.sh),
#      the VRAM watchdog, and the served-name check.
#   4. Sends one small chat request, then checks: served name, HTTP 200 + non-empty reply, no
#      MEMORY_FAULT / traceback in the container log, and speculative-decode counters (draft vs accepted
#      tokens -> acceptance). If the drafter is dead, accepted stays ~0 even when draft > 0.
#   5. Prints PASS/FAIL per step. On failure the last log lines are dumped -- do NOT treat a green
#      "container up" as success (iron rule 15): check the residency and the counters below.
#
# AFTER A PASS, to get the 27b back:  PORT=8000 stack/serve/vllm/serve_vllm.sh stop  (then the
# 27b vllm.sh as usual). To A/B the CROSS-release drafter (z-lab/Qwen3.6-35B-A3B-DFlash, trained on
# Qwen3.6 weights -- see the profile comment): fetch it
# (fetch_model.sh z-lab/Qwen3.6-35B-A3B-DFlash f181eece646affea2c38b2765f1aaa01a9734ccd), then relaunch with
# DRAFT_DIR=/mnt/Lin1/work/vllm/sly-radiance/models/z-lab__Qwen3.6-35B-A3B-DFlash@f181eece added to the env
# below, and compare accept lengths between the two drafters.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVE="$HERE/bench/engine-bench/vllm/serve_vllm.sh"
FETCH="$HERE/bench/engine-bench/vllm/fetch_model.sh"
PORT=8000
PROFILE=sly-amd/qwen35-35b-a3b-mxfp4-dflash
SERVED_EXPECTED=qwen35-35b-a3b-mxfp4-dflash
VLLM_ROOT=${VLLM_ROOT:-/mnt/Lin1/work/vllm/sly-radiance}

warn() { echo "== $*" >&2; }
pass() { echo "PASS: $*"; }
fail() { echo "FAIL: $*" >&2; FAILURES=$((FAILURES + 1)); }
FAILURES=0

if [ "${1:-}" != "--yes" ]; then
  warn "Dry run. This will STOP the server on port $PORT (currently: the 27b qwen38-27b-redhat-mxfp4-dflash,"
  warn "which powers the interactive Claude session), fetch ~25 GB + 772 MB of pinned checkpoints, boot"
  warn "profile $PROFILE (first boot compiles ~10 min), and send one smoke request."
  warn "Re-run with --yes to proceed."
  exit 0
fi

# ---- 1. stop whatever is on the port (container name is vllm-$PORT for both the 27b and the 35b) ----
echo "== stopping any vllm container on port $PORT (may take a few s; VRAM must drain)"
PORT=$PORT "$SERVE" stop || true
for i in $(seq 30); do ss -ltn | grep -q ":$PORT " || break; sleep 1; done
if ss -ltn | grep -q ":$PORT "; then warn "port $PORT still held after stop -- aborting (ss -ltnp | grep :$PORT)"; exit 1; fi
free_mib() { for d in /sys/class/drm/card*/device; do [ -r "$d/mem_info_vram_total" ] || continue
  echo $(( ($(cat "$d/mem_info_vram_total") - $(cat "$d/mem_info_vram_used")) / 1048576 )); return; done; echo 999999; }
F=$(free_mib); [ "$F" -ge 30000 ] && pass "VRAM drained: $F MiB free" || fail "VRAM not drained: $F MiB free < 30000 MiB floor -- check 'amd-smi process -g 0'"

# ---- 2. pinned fetch (resumable) ----
echo "== fetching pinned checkpoints (cpu nice 19; resumable)"
"$FETCH" amd/Qwen3.5-35B-A3B-MXFP4 2e19c6576db91e5d5a93455415619262218bf8a1 \
          z-lab/Qwen3.5-35B-A3B-DFlash 52cb554b4995dede3e2e1bdb129cdb1f3529332b \
  || fail "fetch_model.sh failed"
[ -f "$VLLM_ROOT/models/amd__Qwen3.5-35B-A3B-MXFP4@2e19c657/config.json" ] \
  && pass "base model present" || fail "base model missing after fetch"
[ -f "$VLLM_ROOT/models/z-lab__Qwen3.5-35B-A3B-DFlash@52cb554b/config.json" ] \
  && pass "drafter present" || fail "drafter missing after fetch"

# ---- 3. boot (same env as qwen35_sly_dflash.sh: Cactus delta 0, util 0.93, one seq, fp8 KV, watchdog) ----
echo "== booting $PROFILE (first boot compiles ~10 min; Ctrl-C safe to interrupt: 'PORT=$PORT $SERVE stop')"
if PROFILE=$PROFILE PORT=$PORT MAXLEN=262000 MAXSEQS=1 KV_DTYPE=fp8 WATCHDOG_MIB=32 GPU_UTIL=0.93 \
   CACTUS_DELTA=0 "$SERVE" start; then
  pass "server up"
else
  fail "boot failed -- last log lines:"; tail -30 "$HERE/bench/.servers/$PORT.log" >&2 || true
  echo "(fix the cause, then re-run this script; it is resumable)"; exit 1
fi

# ---- 4. identity + smoke request + faults + spec-decode counters ----
SERVED=$(curl -sf -m 5 "http://127.0.0.1:$PORT/v1/models" | python3 -c 'import json,sys;print(json.load(sys.stdin)["data"][0]["id"])')
[ "$SERVED" = "$SERVED_EXPECTED" ] && pass "served model: $SERVED" || fail "served model '$SERVED' != expected '$SERVED_EXPECTED'"

CODE=$(curl -s -m 600 -o /tmp/validate-35b-smoke.json -w '%{http_code}' "http://127.0.0.1:$PORT/v1/chat/completions" \
  -H 'content-type: application/json' \
  -d "{\"model\": \"$SERVED_EXPECTED\", \"messages\": [{\"role\": \"user\", \"content\": \"Reply with exactly: 35b-ok\"}], \"max_tokens\": 64}")
if [ "$CODE" = 200 ] && python3 -c '
import json,sys
d=json.load(open("/tmp/validate-35b-smoke.json"))
t=d["choices"][0]["message"]["content"]
sys.exit(0 if isinstance(t,str) and t.strip() else 1)'; then
  pass "smoke request: HTTP 200, reply: $(python3 -c 'import json;print(json.load(open("/tmp/validate-35b-smoke.json"))["choices"][0]["message"]["content"][:120])')"
else
  fail "smoke request: HTTP $CODE / empty reply"; head -c 400 /tmp/validate-35b-smoke.json >&2; echo
fi

LOG=$(PORT=$PORT "$SERVE" logs 2>/dev/null | tail -400)
if echo "$LOG" | grep -qE 'MEMORY_FAULT|Traceback|CUDA|HIP_STATUS_ERROR'; then
  fail "container log shows a fault (MEMORY_FAULT/traceback)"
else
  pass "no MEMORY_FAULT/traceback in container log"
fi

echo "== speculative-decode counters (accepted/draft = accept rate; kv usage):"
curl -s -m 5 "http://127.0.0.1:$PORT/metrics" | grep -E 'spec_decode_num_(draft|accepted)_tokens|kv_cache_usage_perc' | grep -v '^#' || warn "no spec-decode metrics (drafter may not be active -- check the boot log for V2 model runner / dflash errors)"

echo
if [ "$FAILURES" -eq 0 ]; then
  echo "ALL CHECKS PASSED -- the 35b + DFlash setup is validated. Interactive use:"
  echo "  $HERE/bench/engine-bench/vllm/archive/qwen35_sly_dflash.sh start"
  echo "  headless tasks:"
  echo "  $HERE/.claude/skills/local-agent/scripts/local-agent.sh \"your brief\""
else
  warn "$FAILURES check(s) failed. Server left RUNNING for inspection: 'PORT=$PORT $SERVE logs', 'tail $HERE/bench/.servers/$PORT.log'"
fi
exit $([ "$FAILURES" -eq 0 ] && echo 0 || echo 1)

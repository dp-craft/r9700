#!/usr/bin/env bash
# start_vllm.sh — simple vLLM launcher for the R9700 (host venv, no Docker).
# Design + rationale for every flag: docs/brainstorm/vllm-qwen38-r9700/vllm-qwen38-r9700.md (Recommendation).
# Conventions mirror bench/engine-bench/serve_llamacpp.sh (pidfile/log/cmdline in bench/.servers/<port>.*).
# (Repo rule 6: no bench/ tool launches vLLM yet — fold this into bench/engine-bench/ if vLLM becomes regular.)
#
# Usage:
#   MTP=0 ./start_vllm.sh            # start (MTP=1 → --speculative-config mtp, k=SPEC_TOKENS)
#   ./start_vllm.sh stop | status
#
# The GPU is freed MANUALLY by the operator (stop llama-swap etc.). This script never kills anything it did
# not start: it only REFUSES to start when free VRAM < GPU_UTIL × total (vLLM's own startup requirement).
# vLLM runs an EngineCore child process → the server gets its own process group and every exit path kills
# the whole group (killing only the API-server pid would orphan the engine and its VRAM — rule 14).
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

: "${VENV:=$REPO/bench/dl/vllm-venv}"
: "${MODEL:=$HOME/models/vllm/Qwen3.8-27B-INT4}"
: "${NAME:=qwen38-27b-int4}"
: "${PORT:=8000}"
: "${MTP:=0}"
: "${SPEC_TOKENS:=3}"        # recipe value. HIP skinny decode needs M=1+k ≤ 5 AND K·M ≤ 32768 → down_proj (K=17408) runs on Triton for any k ≥ 1
: "${MAX_LEN:=36864}"        # 32768 prompt + 2048 output + chat-template headroom
: "${MAX_BATCHED:=16384}"    # prefill chunk; first knob to raise if 32k prefill disappoints
: "${MAX_SEQS:=4}"
: "${GPU_UTIL:=0.90}"
: "${WAIT:=2400}"            # first boot JIT-compiles Triton/torch.compile kernels (reportedly 15–20 min)

RUNDIR="$REPO/bench/.servers"; mkdir -p "$RUNDIR"
PIDFILE="$RUNDIR/$PORT.pid"; LOGFILE="$RUNDIR/$PORT.log"; CMDFILE="$RUNDIR/$PORT.cmdline"

vram() {  # prints "<used_mib> <total_mib>" of the first amdgpu card
  for d in /sys/class/drm/card*/device; do
    [ -f "$d/mem_info_vram_total" ] || continue
    echo "$(( $(cat "$d/mem_info_vram_used") / 1048576 )) $(( $(cat "$d/mem_info_vram_total") / 1048576 ))"; return
  done
  echo "0 0"
}
port_busy() { ss -ltn "( sport = :$PORT )" 2>/dev/null | grep -q LISTEN; }
kill_group() {  # $1 = pgid: TERM the whole group, escalate to KILL if any member survives 60 s
  local g=$1
  kill -TERM -- "-$g" 2>/dev/null || true
  for _ in $(seq 60); do kill -0 -- "-$g" 2>/dev/null || return 0; sleep 1; done
  kill -KILL -- "-$g" 2>/dev/null || true
}

case "${1:-start}" in
  stop)
    if [ -f "$PIDFILE" ]; then
      kill_group "$(cat "$PIDFILE")"; rm -f "$PIDFILE"
      for _ in $(seq 30); do port_busy || break; sleep 1; done
      port_busy && echo "WARNING: port $PORT still in use after stop" >&2
      read -r U T < <(vram); echo "stopped port $PORT — VRAM used now ${U}/${T} MiB"
    else
      echo "no pidfile for port $PORT"
    fi
    exit 0;;
  status)
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
      echo "running (pid $(cat "$PIDFILE")): $(cat "$CMDFILE" 2>/dev/null)"
    else
      echo "not running"
    fi
    exit 0;;
  start) ;;
  *) echo "usage: $0 [start|stop|status]" >&2; exit 1;;
esac

if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "port $PORT already running (pid $(cat "$PIDFILE")) — stop it first" >&2; exit 1
fi
[ -x "$VENV/bin/vllm" ] || { echo "vllm not found in venv: $VENV" >&2; exit 1; }
[ -f "$MODEL/config.json" ] || { echo "model not found: $MODEL" >&2; exit 1; }
if port_busy; then
  echo "port $PORT is already in use by another process — refusing (ss -ltnp | grep :$PORT)" >&2; exit 1
fi

# Pre-flight: refuse (never kill) when the GPU is not free enough.
read -r USED TOTAL < <(vram)
NEED=$(awk -v t="$TOTAL" -v u="$GPU_UTIL" 'BEGIN{printf "%d", t*u}')
FREE=$(( TOTAL - USED ))
if [ "$FREE" -lt "$NEED" ]; then
  echo "GPU not free: ${FREE} MiB free < ${NEED} MiB needed (GPU_UTIL=$GPU_UTIL × ${TOTAL}) — refusing to start." >&2
  echo "  free it manually, e.g. llama-swap: curl -s http://localhost:9292/unload (GET); holders: amd-smi process" >&2
  exit 1
fi

CMD=("$VENV/bin/vllm" serve "$MODEL" --served-model-name "$NAME" --host 127.0.0.1 --port "$PORT"
     --language-model-only --max-model-len "$MAX_LEN" --max-num-batched-tokens "$MAX_BATCHED"
     --max-num-seqs "$MAX_SEQS" --gpu-memory-utilization "$GPU_UTIL" --mamba-backend triton
     --no-enable-prefix-caching)
if [ "$MTP" = "1" ]; then
  CMD+=(--speculative-config "{\"method\":\"mtp\",\"num_speculative_tokens\":$SPEC_TOKENS}")
fi
if [ -n "${EXTRA_ARGS:-}" ]; then read -r -a XA <<<"$EXTRA_ARGS"; CMD+=("${XA[@]}"); fi

# The official torch wheel links OpenMPI 4 (libmpi.so.40, libmpi_cxx.so.40), absent on this host → a contained
# copy from Ubuntu's libopenmpi3t64/libhwloc15/libevent-pthreads debs lives in $VENV/mpi-libs (no system install;
# `apt install libopenmpi3t64` would drag Ubuntu's ROCm 5.7 runtime into /usr/lib).
# Do NOT put /opt/rocm/lib on LD_LIBRARY_PATH: torch already finds the host ROCm libs via its RUNPATH, and exposing
# /opt/rocm/lib makes the pip amdsmi 26.2.2 (bundles its own lib) load the host libamd_smi.so.27 → import fails.
[ -e "$VENV/mpi-libs/libmpi.so.40" ] || { echo "OpenMPI runtime missing: $VENV/mpi-libs (see SOURCES.txt there)" >&2; exit 1; }
: "${VLLM_ROCM_USE_AITER:=0}"   # AITER compiled kernels lack gfx1201 (aiter#3294); its RDNA4 *Triton* GDN
                               # kernels do gate on (is_rdna_aiter_enabled) → overridable for A/B testing.
export VLLM_ROCM_USE_AITER HSA_OVERRIDE_GFX_VERSION=12.0.1
export LD_LIBRARY_PATH="$VENV/mpi-libs${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
echo "VLLM_ROCM_USE_AITER=$VLLM_ROCM_USE_AITER HSA_OVERRIDE_GFX_VERSION=12.0.1 LD_LIBRARY_PATH=$LD_LIBRARY_PATH ${CMD[*]}" > "$CMDFILE"
# The new session leader writes its OWN pid (== its pgid) before exec'ing vLLM. Recording $! instead is
# wrong whenever setsid has to fork (caller already a group leader, e.g. job control on): $! is then a
# short-lived wrapper and 'stop' would miss the real process group (caught by the stress test).
rm -f "$PIDFILE"
setsid bash -c 'echo $$ > "$0"; exec "$@"' "$PIDFILE" "${CMD[@]}" > "$LOGFILE" 2>&1 < /dev/null &
for _ in $(seq 50); do [ -s "$PIDFILE" ] && break; sleep 0.1; done
[ -s "$PIDFILE" ] || { echo "launch failed (no pidfile) — log:" >&2; tail -5 "$LOGFILE" >&2; exit 1; }
PGID=$(cat "$PIDFILE")
echo "starting on :$PORT (pid/pgid $PGID, MTP=$MTP) — log: $LOGFILE"

for i in $(seq "$WAIT"); do
  if ! kill -0 "$PGID" 2>/dev/null; then
    echo "server DIED during startup — last log lines:" >&2
    tail -15 "$LOGFILE" >&2
    kill_group "$PGID"; rm -f "$PIDFILE"; exit 1     # reap any orphaned children (EngineCore)
  fi
  if curl -sf -m 2 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
    SERVED=$(curl -sf -m 5 "http://127.0.0.1:$PORT/v1/models" \
      | python3 -c 'import json,sys; print(",".join(m["id"] for m in json.load(sys.stdin)["data"]))' 2>/dev/null || true)
    if [ "$SERVED" != "$NAME" ]; then
      echo "port $PORT is serving '$SERVED', expected '$NAME' — aborting" >&2
      kill_group "$PGID"; rm -f "$PIDFILE"; exit 1
    fi
    read -r U T < <(vram)
    echo "up after ${i}s — model: $SERVED — VRAM ${U}/${T} MiB"
    echo "linear kernel(s) selected:"; grep -m5 -E 'LinearKernel' "$LOGFILE" | sed 's/^/  /' || echo "  (none logged)"
    echo "cmdline: $(cat "$CMDFILE")"
    exit 0
  fi
  sleep 1
done
echo "server did not become healthy in ${WAIT}s — stopping it" >&2
kill_group "$PGID"; rm -f "$PIDFILE"; exit 1

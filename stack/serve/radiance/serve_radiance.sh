#!/usr/bin/env bash
# serve_radiance.sh — launcher for the NATIVE radiance runtime (docker image stilldeadcode/radiance,
# https://codeberg.org/StillDeadcode/radiance), serving a single-file .rad model. This is NOT vLLM:
# the vllm-radiance image (serve_vllm.sh) loads HF checkpoint dirs; this one loads `*.rad` containers
# (weights + tokenizer + chat template + DFlash2 drafter in one file). Flags follow the model card
# (HF StillDeadcode/qwen3.8-27b-mxfp4): --tp 1 --max-model-len 200000 --kv-cache-dtype fp8 --max-num-seqs 8
# (those two = the card default; the 27B starters/launchers pass 27b.conf's 260000/2 instead).
#
# Usage:
#   RAD_FILE=/abs/model.rad PORT=8000 ./serve_radiance.sh [start]     # DAEMON (background); the normal path
#   RAD_FILE=/abs/model.rad PORT=10005 CONTAINER_NAME=llama-swap-x ./serve_radiance.sh run   # FOREGROUND, for llama-swap
#   RAD_FILE=/abs/model.rad ./serve_radiance.sh print                 # show docker argv, no GPU
#   PORT=8000 ./serve_radiance.sh stop|status|logs
# `start` (default): docker run -d on the host network, gpu_exclusive.sh first, 5 s /v1/models health poll
# with a container-death check + cleanup on failure, resolved argv recorded in
# stack/serve/var/servers/$PORT.cmdline, stop is graceful (SIGTERM, -t 60) and waits the port out of
# TIME_WAIT (serve_lib.sh wait_port_bindable). `stop|status|logs` are port-scoped (no RAD_FILE needed).
# `run` is for llama-swap (or any process supervisor): the container runs in the foreground (--rm, no -d)
# and the script exits when it does. Like before, `run` does NOT call gpu_exclusive.sh (that unloads
# llama-swap = its own parent); it waits up to FLOOR_WAIT s for FREE_MIB_FLOOR of free VRAM and refuses
# below it (iron rule 14).
# Knobs (env): RAD_FILE (required for start/run/print) IMAGE(stilldeadcode/radiance:1.11.0) PORT(8000)
#   CONTAINER_NAME(radiance-$PORT) MAXLEN(200000) MAXSEQS(8) KV_DTYPE(fp8) TP(1) REASONING_MAP(high=xhigh)
#   SERVED_NAME(start mode: --served-model-name alias; empty = the model's native name)
#   FREE_MIB_FLOOR(30000) FLOOR_WAIT(90, run mode) WAIT(900, start mode) EXTRA_ARGS
#   HIP_FORCE_DEV_KERNARG(0: iron-rule env, CLAUDE.md "ROCm engines") EXCLUSIVE(gpu_exclusive.sh; override in unit tests)
set -euo pipefail

HERE="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
# shellcheck source=../serve_lib.sh
source "$HERE/../serve_lib.sh"

: "${IMAGE:=stilldeadcode/radiance:1.11.0}"
: "${PORT:=8000}"
: "${CONTAINER_NAME:=radiance-$PORT}"
: "${MAXLEN:=200000}"
: "${MAXSEQS:=8}"
: "${KV_DTYPE:=fp8}"
: "${TP:=1}"
: "${REASONING_MAP=high=xhigh}"   # space-separated FROM=TO pairs (one pair may be comma-joined); set empty to pass none
: "${SERVED_NAME:=}"
: "${FREE_MIB_FLOOR:=30000}"
: "${FLOOR_WAIT:=90}"
: "${WAIT:=900}"
: "${EXCLUSIVE:=$REPO/stack/gpu/gpu_exclusive.sh}"
NAME="$CONTAINER_NAME"
RUNDIR="$REPO/stack/serve/var/servers"; mkdir -p "$RUNDIR"
LOGFILE="$RUNDIR/$PORT.log"; CMDFILE="$RUNDIR/$PORT.cmdline"
MODE="${1:-run}"
case "$MODE" in run|print|start|stop|status|logs) ;; *) echo "usage: RAD_FILE=... $0 [start|run|print|stop|status|logs]" >&2; exit 2;; esac

port_holder() {   # describe whatever is LISTENing on :$PORT (wait_port_bindable's HOLDER_DESC)
  local h
  h=$(ss -ltnp 2>/dev/null | grep ":$PORT " | sed -nE 's/.*users:\(\("([^"]*)",pid=([0-9]+).*/\1 pid=\2/p' | sort -u | head -3 | tr '\n' ' ') || true
  echo "${h:-unknown — ss -ltnp | grep :$PORT}"
}

# --- stop / status / logs: port-scoped, no RAD_FILE needed (same contract as serve_vllm.sh) ---
if [ "$MODE" = stop ]; then
  if docker inspect "$NAME" >/dev/null 2>&1; then
    docker logs "$NAME" > "$LOGFILE" 2>&1 || true   # keep the last run's log
    # graceful first (SIGTERM: the engine releases the GPU cleanly; SIGKILL can wedge the card, iron rule 15)
    # the call itself is bounded (docker waits out -t 60, then SIGKILLs and waits for the exit: a process
    # wedged in the driver hangs it), so the rm -f backstop below is always reached
    timeout 90 docker stop -t 60 "$NAME" >/dev/null 2>&1 || true
    # a run-mode container is --rm: the daemon removes it after the stop, so rm -f may lose the race
    # ("No such container" / "removal already in progress") — gone is success, still there is the failure
    if ! rmerr=$(timeout 60 docker rm -f "$NAME" 2>&1 >/dev/null); then
      for _ in 1 2 3 4 5; do timeout 10 docker inspect "$NAME" >/dev/null 2>&1 || break; sleep 1; done
      if timeout 10 docker inspect "$NAME" >/dev/null 2>&1; then
        echo "FAILED to remove $NAME (${rmerr:-docker rm -f timed out} — GPU process may be wedged, iron rule 15)" >&2; exit 1
      fi
    fi
    rm -f "$CMDFILE"
    wait_port_bindable "$PORT" 30 70 port_holder
    # silent on success (starters_test C6 contract; the log is kept at $LOGFILE, the state file is gone)
  else
    if ss -ltn | grep -q ":$PORT "; then echo "no container $NAME, but port $PORT is still held by: $(port_holder)" >&2; exit 1; fi
    rm -f "$CMDFILE"   # stale state of a long-dead run; nothing else to do (silent)
  fi
  exit 0
fi
if [ "$MODE" = status ]; then
  st=$(docker ps --filter "name=^$NAME$" --format '{{.Names}} {{.Image}} {{.Status}}')
  if [ -z "$st" ]; then   # another engine's /v1/models on this port must not look like radiance being up
    echo "radiance not running (no container $NAME)"
    if ss -ltn | grep -q ":$PORT "; then echo "port $PORT is held by: $(port_holder)" >&2; fi
    exit 0   # status query itself succeeded (starters_test C6e contract)
  fi
  echo "$st"
  curl -s -m 3 "http://127.0.0.1:$PORT/v1/models" || true; echo
  exit 0
fi
if [ "$MODE" = logs ]; then docker logs "$NAME"; exit 0; fi

: "${RAD_FILE:?set RAD_FILE=<absolute path to the .rad model>}"
[ "${RAD_FILE:0:1}" = / ] && [ "${RAD_FILE##*.}" = rad ] || { echo "RAD_FILE must be an absolute path to a .rad file (got: $RAD_FILE)" >&2; exit 2; }

vram_free_mib() {
  local d
  for d in /sys/class/drm/card*/device; do
    [ -r "$d/mem_info_vram_total" ] || continue
    echo $(( ($(cat "$d/mem_info_vram_total") - $(cat "$d/mem_info_vram_used")) / 1048576 )); return
  done
  echo 999999
}

RENDER_GID=$(getent group render | cut -d: -f3); VIDEO_GID=$(getent group video | cut -d: -f3)
# Flags/devices mirror the upstream deploy/compose/common.yaml: seccomp=unconfined (io_uring + NUMA mbind),
# memlock unlimited, init, run as the host user, GPU groups.
# Networking: `run` maps 127.0.0.1:$PORT -> in-container 8000 (llama-swap's port convention); `start`
# uses the host network with the in-container port set to $PORT (the old starters' convention).
if [ "$MODE" = run ]; then
  NET=(--rm -p "127.0.0.1:$PORT:8000"); SERVE_NET=(--host 0.0.0.0 --port 8000)
else
  NET=(-d --network host); SERVE_NET=(--host 127.0.0.1 --port "$PORT")
fi
CMD=(docker run "${NET[@]}" --init --name "$NAME"
     --device /dev/kfd --device /dev/dri --group-add "$VIDEO_GID" --group-add "$RENDER_GID"
     --security-opt seccomp=unconfined --ulimit memlock=-1:-1
     --user "$(id -u):$(id -g)"
     -e HIP_FORCE_DEV_KERNARG="${HIP_FORCE_DEV_KERNARG:-0}"
     -v "$(dirname "$RAD_FILE"):/models:ro"
     "$IMAGE" --model "/models/$(basename "$RAD_FILE")" "${SERVE_NET[@]}"
     --tp "$TP" --max-model-len "$MAXLEN" --kv-cache-dtype "$KV_DTYPE" --max-num-seqs "$MAXSEQS")
# Qwen3.8's embedded template takes xhigh|medium|low only and 400s on OpenAI's `high` (opencode sends it).
# The engine maps it before the template sees it and checks TO against the template at startup.
for pair in $REASONING_MAP; do CMD+=(--reasoning-effort-map "$pair"); done
[ -n "$SERVED_NAME" ] && CMD+=(--served-model-name "$SERVED_NAME")
# EXTRA_ARGS is split on whitespace; quotes are NOT honoured (no JSON or quoted values in it)
if [ -n "${EXTRA_ARGS:-}" ]; then read -r -a XA <<<"$EXTRA_ARGS"; CMD+=("${XA[@]}"); fi

if [ "$MODE" = print ]; then printf '%q ' "${CMD[@]}"; echo; exit 0; fi

[ -f "$RAD_FILE" ] || { echo "checkpoint missing in $(dirname "$RAD_FILE")" >&2; exit 1; }
docker image inspect "$IMAGE" >/dev/null 2>&1 || { echo "image not present: $IMAGE (docker pull $IMAGE)" >&2; exit 1; }
if docker inspect "$NAME" >/dev/null 2>&1 && [ "$(docker inspect -f '{{.State.Running}}' "$NAME")" != true ]; then
  # dead leftover of a crashed supervised boot; bounded, and a failure says why (the docker run below then hits the name)
  timeout 60 docker rm -f "$NAME" >/dev/null 2>&1 || echo "warning: could not remove dead leftover container $NAME (docker rm -f failed or timed out)" >&2
fi
if ss -ltn | grep -q ":$PORT "; then echo "port $PORT is in use -- stop that server first (held by: $(port_holder))" >&2; exit 1; fi

if [ "$MODE" = start ]; then
  wait_port_bindable "$PORT" 1 70 port_holder || exit 1   # LISTEN was checked above; this drains TIME_WAIT (the host-network bind fails inside it)
  "$EXCLUSIVE" "$FREE_MIB_FLOOR"
  "${CMD[@]}" >/dev/null
  # state file only once docker run has succeeded (else it describes a server that never started)
  DIGEST=$(docker image inspect -f '{{index .RepoDigests 0}}' "$IMAGE" 2>/dev/null || echo "$IMAGE")
  { printf '%q ' "${CMD[@]}"; echo
    echo "# image=$IMAGE"; echo "# image_digest=$DIGEST"; echo "# started_utc=$(date -u +%FT%TZ)"; } > "$CMDFILE"
  for ((i = 0; i < WAIT; i += 5)); do
    if curl -sf -m 3 "http://127.0.0.1:$PORT/v1/models" >/dev/null; then
      echo "up after ${i}s on port $PORT: $IMAGE ($(basename "$RAD_FILE"))${SERVED_NAME:+ — served under alias $SERVED_NAME}"
      exit 0
    fi
    if [ "$(docker inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null)" != true ]; then
      echo "container exited during boot; last log lines:" >&2
      docker logs --tail 40 "$NAME" >&2
      timeout 60 docker rm -f "$NAME" >/dev/null 2>&1 || true   # a failed boot must not leak the container
      rm -f "$CMDFILE"
      exit 1
    fi
    sleep 5
  done
  echo "not up after ${WAIT}s; last log lines:" >&2
  docker logs --tail 40 "$NAME" >&2
  timeout 60 docker rm -f "$NAME" >/dev/null 2>&1 || true   # a failed boot must not leak the container
  rm -f "$CMDFILE"
  exit 1
fi

# --- run mode: foreground, supervised (llama-swap) ---
for _ in $(seq "$FLOOR_WAIT"); do [ "$(vram_free_mib)" -ge "$FREE_MIB_FLOOR" ] && break; sleep 1; done
f=$(vram_free_mib)
if [ "$f" -lt "$FREE_MIB_FLOOR" ]; then
  echo "refusing to boot $NAME: ${f} MiB free < floor ${FREE_MIB_FLOOR} MiB — holders:" >&2
  amd-smi process -g 0 >&2 2>/dev/null || true; exit 1
fi
echo "running $NAME in the foreground on 127.0.0.1:$PORT ($IMAGE, $(basename "$RAD_FILE"))"
# Docker client as a background job + `wait`, so a TERM from the supervisor removes the container at once.
"${CMD[@]}" & DP=$!
trap 'timeout 60 docker rm -f "$NAME" >/dev/null 2>&1 || echo "warning: could not remove $NAME (docker rm -f failed or timed out)" >&2' TERM INT
rc=0; wait "$DP" || rc=$?
if [ "$rc" -gt 128 ]; then wait "$DP" 2>/dev/null || true; fi
exit "$rc"

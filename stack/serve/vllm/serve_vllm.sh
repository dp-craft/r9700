#!/usr/bin/env bash
# serve_vllm.sh — profile-driven, reproducible launcher for vLLM-family DOCKER images (Sly radiance,
# upstream vLLM ROCm, forks). Same contract as serve_llamacpp.sh: start ONE config, wait for
# /health, record the exact command + image digest + model revision so every number is attributable.
#
# Usage:
#   PROFILE=sly-radiance/qwen38-mxfp4 PORT=8000 ./serve_vllm.sh [start]   # boot (touches the GPU)
#   PROFILE=sly-radiance/qwen38-mxfp4 ./serve_vllm.sh print               # show docker argv, no GPU
#   PORT=8000 ./serve_vllm.sh stop|status|logs
#   PROFILE=... PORT=10005 CONTAINER_NAME=llama-swap-x ./serve_vllm.sh run   # FOREGROUND, for a supervisor
#
# `run` is for llama-swap (or any process supervisor): the container runs in the foreground (--rm, no
# -d) and the script exits when it does. It does NOT call gpu_exclusive.sh -- that unloads llama-swap,
# i.e. its own parent -- but waits up to FLOOR_WAIT s for the same FREE_MIB_FLOOR and refuses below it
# (iron rule 14). The boot watchdog runs until /health answers. Stop it with `docker rm -f <name>`.
#
# Existing-instance handling (all modes): a STOPPED container named vllm-$PORT (crashed boot, host
# restart) is a dead leftover -- auto-removed, and its stack/serve/var/servers/$PORT.container state file with it
# (a state file without a container is stale and removed the same way), so a new `start` never needs a
# manual `stop` first. A LIVE instance on the port (our container or a foreign listener) is stopped only
# after you answer the takeover prompt in `start` mode (TTY only; non-TTY refuses with a message). `run`
# mode keeps the hard refusal -- a supervisor must never block on a prompt or kill a process it does not
# own. Unit tests (no GPU): tests/serve_vllm_test.sh.
#
# A profile is profiles/<engine>/<model>.env (model layer) + profiles/<engine>/_engine.env (image,
# shared env + args). Knobs (env, beat the profile): IMAGE MODEL_DIR MAXLEN MAXSEQS GPU_UTIL KV_DTYPE
#   FREE_MIB_FLOOR PORT(8000) WAIT(1200s; first boot compiles ~10 min) EXTRA_ARGS VLLM_ROOT HF_CACHE
#   EXCLUSIVE(stack/gpu/gpu_exclusive.sh; override in unit tests to stub the free-VRAM floor)
#   WATCHDOG_MIB(256: kill the container if free VRAM drops below this while booting; 0 = off)
#   CONTAINER_NAME(vllm-$PORT) FLOOR_WAIT(90, run mode only)
#   AUTO_PULL(1: `start`/`run` docker-pull a missing IMAGE once, then go on; 0 = refuse instead). Under
#     llama-swap a first pull counts against its healthCheckTimeout -- pre-pull big images by hand.
#   CHAT_TEMPLATE=<host .jinja>  mounted read-only and passed as --chat-template (replaces the profile's)
#   PY_OVERLAY=<host dir>  mounted read-only at /py-overlay and put on PYTHONPATH, so its modules shadow the
#     image's (e.g. overlays/sly-pad-a). Not combinable with KVCACHE=ram.
#   MODEL_CONFIG=<host config.json>  mounted read-only OVER /model/config.json -- fixes a checkpoint's config
#     without touching the fetched snapshot (e.g. overlays/qwen38-mxfp4-mtp-config, see its SOURCE.txt).
#   KVCACHE=ram KVCACHE_RAM_GIB(16)  Sly's GPU->RAM prefix-cache tier (src/<ver>/kv-cache/README.md):
#     the 6 "always" patches applied at container start from KVCACHE_PATCHES (Sly source of the SAME
#     tag), their RADIANCE_* switches, --kv-offloading-size/--kv-offloading-backend native, and a
#     /dev/shm large enough to hold the tier. Off by default; with it off the argv is unchanged.
# New engine/fork: add profiles/<engine>/_engine.env with its IMAGE; new model: one <model>.env.
#
# Profile contract -- checked right after sourcing, in every mode incl. `print`; a violation exits 2
# naming each missing field, before any docker call:
#   scalars (non-empty): IMAGE MODEL_DIR SERVED_NAME MAXLEN GPU_UTIL MAXSEQS KV_DTYPE FREE_MIB_FLOOR
#     (MAXLEN MAXSEQS FREE_MIB_FLOOR integers). Paths: build them from $VLLM_ROOT, never hard-code it.
#   arrays (may be empty, must be declared as arrays): CACHE_MOUNTS ENGINE_ENV MODEL_ENV ENGINE_ARGS MODEL_ARGS
#   CACHE_MOUNTS entries are <host-subdir>:<abs container path>; the host side is created dev-owned
#     under $VLLM_ROOT/cache/<image@tag>/ (docker would create it root-owned).
#   chat template: --chat-template in ENGINE_ARGS/MODEL_ARGS, or CHAT_TEMPLATE=<host .jinja>, or
#     CHAT_TEMPLATE_NONE="<why none: e.g. model dir's own chat_template.jinja>" -- silence is an error,
#     because an image without the template a profile was copied from fails only at the first request.
set -euo pipefail
HERE="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"   # readlink: llama-swap runs it via ~/.config/llama-swap/serve_vllm.sh
REPO="$(cd "$HERE/../../.." && pwd)"

: "${VLLM_ROOT:=/mnt/Lin1/work/vllm/sly-radiance}"
: "${HF_CACHE:=/mnt/Lin1/work/hf}"   # shared with fetch_model.sh; default ACL keeps root-written files dev-writable
: "${PORT:=8000}"
: "${WAIT:=1200}"
: "${WATCHDOG_MIB:=256}"   # boot-time kill switch: free VRAM below this -> docker kill (0 disables)
: "${CONTAINER_NAME:=vllm-$PORT}"
NAME="$CONTAINER_NAME"
RUNDIR="$REPO/stack/serve/var/servers"; mkdir -p "$RUNDIR"
CFILE="$RUNDIR/$PORT.container"; LOGFILE="$RUNDIR/$PORT.log"; CMDFILE="$RUNDIR/$PORT.cmdline"

running() { [ "$(docker inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null)" = true ]; }

# Free VRAM from sysfs (cheap enough to poll at 0.2 s; amd-smi is not). 2026-10-22: the NVFP4 load-time
# requant filled the card to 24 MiB free (+2.9 GiB GTT) and the desktop session sharing the card died
# 22 s later -- --gpu-memory-utilization does not bound the load phase, so nothing in vLLM stops it.
vram_free_mib() {
  local d
  for d in /sys/class/drm/card*/device; do
    [ -r "$d/mem_info_vram_total" ] || continue
    echo $(( ($(cat "$d/mem_info_vram_total") - $(cat "$d/mem_info_vram_used")) / 1048576 )); return
  done
  echo 999999
}
# Runs only while booting; serving stays inside the util budget. Shortens a full-card episode to
# <~0.5 s -- it cannot undo an allocation the desktop already lost inside that window.
watchdog() {
  while sleep 0.2; do
    local f; f=$(vram_free_mib)
    if [ "$f" -lt "$WATCHDOG_MIB" ]; then
      docker kill "$NAME" >/dev/null 2>&1
      echo "free_mib=$f utc=$(date -u +%T.%N | cut -c1-12)" > "$RUNDIR/$PORT.watchdog"; return
    fi
  done
}

case "${1:-start}" in
  stop)
    if docker inspect "$NAME" >/dev/null 2>&1; then
      docker logs "$NAME" > "$LOGFILE" 2>&1 || true
      docker rm -f "$NAME" >/dev/null; rm -f "$CFILE"
      for _ in $(seq 30); do ss -ltn | grep -q ":$PORT " || break; sleep 1; done
      echo "stopped $NAME (log kept: $LOGFILE)"
    else
      rm -f "$CFILE"   # stale state without a container (crash/restart): stop must leave no state behind
      echo "no container $NAME"
    fi
    exit 0;;
  status)
    if running; then echo "running $NAME: $(head -1 "$CMDFILE" 2>/dev/null)"; else echo "not running"; exit 1; fi
    exit 0;;
  logs) docker logs --tail 50 "$NAME"; exit 0;;
  start|print|run) ;;
  *) echo "usage: PROFILE=<engine>/<model> $0 [start|print|run|stop|status|logs]" >&2; exit 2;;
esac

: "${PROFILE:?set PROFILE=<engine>/<model>, e.g. sly-radiance/qwen38-mxfp4 (see $HERE/profiles)}"
PDIR="$HERE/profiles/${PROFILE%%/*}"
[ -f "$HERE/profiles/$PROFILE.env" ] && [ -f "$PDIR/_engine.env" ] || { echo "profile not found: $PROFILE" >&2; exit 2; }
# model layer first, engine layer second: engine knobs are ${VAR:-default}, so the model profile wins
source "$HERE/profiles/$PROFILE.env"
source "$PDIR/_engine.env"

PERR=()
for v in IMAGE MODEL_DIR SERVED_NAME MAXLEN GPU_UTIL MAXSEQS KV_DTYPE FREE_MIB_FLOOR; do
  [ -n "${!v:-}" ] || PERR+=("$v is not set")
done
for v in MAXLEN MAXSEQS FREE_MIB_FLOOR; do
  [ -z "${!v:-}" ] || [[ "${!v}" =~ ^[0-9]+$ ]] || PERR+=("$v must be an integer (got: ${!v})")
done
for v in CACHE_MOUNTS ENGINE_ENV MODEL_ENV ENGINE_ARGS MODEL_ARGS; do
  [[ "$(declare -p "$v" 2>/dev/null)" == "declare -a"* ]] || PERR+=("$v must be declared as an array: $v=(...)")
done
if [[ "$(declare -p CACHE_MOUNTS 2>/dev/null)" == "declare -a"* ]]; then
  for m in ${CACHE_MOUNTS[@]+"${CACHE_MOUNTS[@]}"}; do
    [[ "$m" =~ ^[A-Za-z0-9._-]+:/ ]] || PERR+=("CACHE_MOUNTS entry '$m' must be <host-subdir>:<abs container path>")
  done
fi
CT_DECLARED=0
for a in ${ENGINE_ARGS[@]+"${ENGINE_ARGS[@]}"} ${MODEL_ARGS[@]+"${MODEL_ARGS[@]}"}; do
  [ "$a" = --chat-template ] && CT_DECLARED=1
done
if [ "$CT_DECLARED" = 0 ] && [ -z "${CHAT_TEMPLATE:-}" ] && [ -z "${CHAT_TEMPLATE_NONE:-}" ]; then
  PERR+=("no chat template: add --chat-template to ENGINE_ARGS, pass CHAT_TEMPLATE=<host .jinja>, or set CHAT_TEMPLATE_NONE=\"<reason>\" in the profile")
fi
if [ "${#PERR[@]}" -gt 0 ]; then
  echo "profile $PROFILE violates the contract ($HERE/profiles/$PROFILE.env + $PDIR/_engine.env):" >&2
  printf '  - %s\n' "${PERR[@]}" >&2
  echo "see the 'Profile contract' block in the header of $0" >&2; exit 2
fi

TAG=${IMAGE##*/}; CACHE_DIR="$VLLM_ROOT/cache/${TAG//:/@}"
RENDER_GID=$(getent group render | cut -d: -f3); VIDEO_GID=$(getent group video | cut -d: -f3)

# Chat template override: mount the host file, point --chat-template at it (append if the profile has none).
CT_MOUNT=()
if [ -n "${CHAT_TEMPLATE:-}" ]; then
  [ -f "$CHAT_TEMPLATE" ] || { echo "CHAT_TEMPLATE not found: $CHAT_TEMPLATE" >&2; exit 2; }
  CT_IN="/templates/$(basename "$CHAT_TEMPLATE")"; CT_MOUNT=(-v "$CHAT_TEMPLATE:$CT_IN:ro"); ct_set=0
  for i in "${!ENGINE_ARGS[@]}"; do
    if [ "${ENGINE_ARGS[$i]}" = --chat-template ]; then ENGINE_ARGS[$((i + 1))]="$CT_IN"; ct_set=1; fi
  done
  [ "$ct_set" = 1 ] || ENGINE_ARGS+=(--chat-template "$CT_IN")
fi

# KV-cache RAM tier, verbatim from Sly's serve-mxfp4.sh KVCACHE=ram branch (src/v1.6.0, lines ~970-1006):
# same env switches, same 6 patches (mixed-hit fatal, the rest warn), same two engine flags.
KVC_MOUNT=(); KVC_ENV=(); KVC_ARGS=(); KVC_PRELUDE=""; SHM_GIB=16
case "${KVCACHE:-off}" in
  off) ;;
  ram)
    : "${KVCACHE_RAM_GIB:=16}"; : "${KVCACHE_PATCHES:=$VLLM_ROOT/src/v1.6.0}"
    [ -f "$KVCACHE_PATCHES/kv-cache/patch_offload_mixed_hit.py" ] || {
      echo "KVCACHE=ram: no Sly kv-cache patches under $KVCACHE_PATCHES (must match the image tag)" >&2; exit 2; }
    KVC_MOUNT=(-v "$KVCACHE_PATCHES:/patches:ro")
    KVC_ENV=(RADIANCE_OFFLOAD_MIXED_HIT=1 RADIANCE_OFFLOAD_EAGLE_GROUPS=1 RADIANCE_MAMBA_STORE_STRIDE=4
             RADIANCE_RECONCILE_REASK=1 RADIANCE_SWA_STORE_MAMBA_ALIGN=1 RADIANCE_TOUCH_ALL_GROUPS=1
             RADIANCE_TOUCH_POSITION_ORDER=1 RADIANCE_ALIGN_PROMPT_LAST_BLOCK=1
             RADIANCE_SWA_EAGLE_REPLAY_TAIL=1 RADIANCE_OFFLOAD_BOUNDARY_TRACE=0)
    KVC_ARGS=(--kv-offloading-size "$KVCACHE_RAM_GIB" --kv-offloading-backend native)
    KVC_PRELUDE='set -e; export PYTHONPATH=/patches
python3 /patches/kv-cache/patch_offload_mixed_hit.py
python3 /patches/kv-cache/patch_eagle_groups.py || echo "[kv-cache] WARNING: eagle-groups did not apply"
python3 /patches/kv-cache/patch_mamba_stride.py || echo "[kv-cache] WARNING: mamba-stride did not apply"
python3 /patches/kv-cache/patch_reconcile_reask.py || echo "[kv-cache] WARNING: reconcile-reask did not apply"
python3 /patches/kv-cache/patch_swa_align_touch.py || echo "[kv-cache] WARNING: swa-align/touch did not apply"
python3 /patches/kv-cache/patch_sched_align_last_block.py || echo "[kv-cache] WARNING: align-last-block did not apply"
unset PYTHONPATH; cd /
exec /opt/radiance_entrypoint.sh "$@"'
    # the tier lives in the container's private /dev/shm: room for it plus the 16g the engine had
    SHM_GIB=$(( ${KVCACHE_RAM_GIB%.*} + 16 ));;
  *) echo "KVCACHE must be off or ram (got: $KVCACHE)" >&2; exit 2;;
esac

DETACH=(-d); [ "${1:-start}" = run ] && DETACH=(--rm)
CMD=(docker run "${DETACH[@]}" --name "$NAME"
     --device /dev/kfd --device /dev/dri --group-add "$VIDEO_GID" --group-add "$RENDER_GID"
     --security-opt seccomp=unconfined --security-opt no-new-privileges
     --shm-size "${SHM_GIB}g" -p "127.0.0.1:$PORT:8000"
     -v "$MODEL_DIR:/model:ro"
     -v "$HF_CACHE:/hf" -e HF_HOME=/hf)   # any in-container HF fetch (drafter, processor) lands on Lin1
for m in "${CACHE_MOUNTS[@]}"; do CMD+=(-v "$CACHE_DIR/${m%%:*}:${m#*:}"); done
if [ -n "${DRAFT_DIR:-}" ]; then CMD+=(-v "$DRAFT_DIR:/draft:ro"); fi   # speculative drafter (profile sets it)
if [ -n "${MODEL_CONFIG:-}" ]; then   # corrected config.json shadowing the snapshot's (profile or env sets it)
  [ -f "$MODEL_CONFIG" ] || { echo "MODEL_CONFIG not found: $MODEL_CONFIG" >&2; exit 2; }
  CMD+=(-v "$MODEL_CONFIG:/model/config.json:ro")
fi
if [ -n "${PY_OVERLAY:-}" ]; then   # python modules that shadow the image's (profile or env sets it)
  [ -d "$PY_OVERLAY" ] || { echo "PY_OVERLAY is not a directory: $PY_OVERLAY" >&2; exit 2; }
  [ -z "$KVC_PRELUDE" ] || { echo "PY_OVERLAY and KVCACHE=ram both set PYTHONPATH; use one" >&2; exit 2; }
  CMD+=(-v "$PY_OVERLAY:/py-overlay:ro" -e PYTHONPATH=/py-overlay)
fi
for e in "${ENGINE_ENV[@]}" "${MODEL_ENV[@]}" ${KVC_ENV[@]+"${KVC_ENV[@]}"}; do CMD+=(-e "$e"); done
CMD+=(${CT_MOUNT[@]+"${CT_MOUNT[@]}"} ${KVC_MOUNT[@]+"${KVC_MOUNT[@]}"})
if [ -n "$KVC_PRELUDE" ]; then CMD+=(--entrypoint bash "$IMAGE" -c "$KVC_PRELUDE" _); else CMD+=("$IMAGE"); fi
CMD+=(--model /model --served-model-name "$SERVED_NAME" --host 0.0.0.0 --port 8000
      --max-model-len "$MAXLEN" "${MODEL_ARGS[@]}" "${ENGINE_ARGS[@]}" ${KVC_ARGS[@]+"${KVC_ARGS[@]}"})
if [ -n "${EXTRA_ARGS:-}" ]; then read -r -a XA <<<"$EXTRA_ARGS"; CMD+=("${XA[@]}"); fi

if [ "${1:-start}" = print ]; then
  # Surface the same resolved config `start` records in stack/serve/var/servers/<port>.cmdline, in one command,
  # with no GPU (docker image inspect + local file reads only). `print` is the read-only preview.
  DIGEST=$(docker image inspect -f '{{index .RepoDigests 0}}' "$IMAGE" 2>/dev/null || echo "$IMAGE")
  {
    echo "# resolved config (PROFILE=$PROFILE) — same as what start records in stack/serve/var/servers/$PORT.cmdline (print can't fetch vllm_version/up_after_s without a GPU)"
    echo "#   IMAGE=$IMAGE"
    echo "#   MODEL_DIR=$MODEL_DIR"
    echo "#   SERVED_NAME=$SERVED_NAME  MAXLEN=$MAXLEN  GPU_UTIL=$GPU_UTIL  MAXSEQS=$MAXSEQS  KV_DTYPE=$KV_DTYPE  FREE_MIB_FLOOR=${FREE_MIB_FLOOR}MiB"
    echo "#   DRAFT_DIR=${DRAFT_DIR:-none}  MODEL_CONFIG=${MODEL_CONFIG:-none}  CHAT_TEMPLATE=${CHAT_TEMPLATE:-none}  KVCACHE=${KVCACHE:-off}"
    echo "# image_digest=$DIGEST"
    echo "# profile=$PROFILE $(grep -E '^(repo|revision)=' "$MODEL_DIR/SOURCE.txt" 2>/dev/null | tr '\n' ' ')"
    [ -n "${DRAFT_DIR:-}" ] && echo "# drafter $(grep -E '^(repo|revision)=' "$DRAFT_DIR/SOURCE.txt" 2>/dev/null | tr '\n' ' ')"
    [ -n "${MODEL_CONFIG:-}" ] && echo "# model_config_override=$MODEL_CONFIG sha256=$(sha256sum "$MODEL_CONFIG" | cut -d' ' -f1)"
    echo "# printed_utc=$(date -u +%FT%TZ)"
    echo "docker_argv=$(printf '%q ' "${CMD[@]}")"
  }
  exit 0
fi

# --- preconditions: nothing below this line runs in `print` mode ---
[ -f "$MODEL_DIR/config.json" ] || { echo "model not found: $MODEL_DIR (fetch_model.sh)" >&2; exit 1; }
if [ -n "${DRAFT_DIR:-}" ] && [ ! -f "$DRAFT_DIR/config.json" ]; then echo "drafter not found: $DRAFT_DIR (fetch_model.sh)" >&2; exit 1; fi
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  [ "${AUTO_PULL:-1}" = 1 ] || { echo "image not present: $IMAGE (AUTO_PULL=0 -- docker pull $IMAGE)" >&2; exit 1; }
  echo "image not present: $IMAGE -- pulling once (can take minutes)" >&2
  docker pull "$IMAGE" >&2 || { echo "docker pull $IMAGE failed -- check the tag, registry login and disk (df -h /)" >&2; exit 1; }
fi
# Existing-instance handling. A STOPPED container is a dead leftover (crashed boot, host restart): auto-removed
# here, so a new `start` never requires a manual `stop` (its state file goes with it; a state file without a
# container is stale and removed the same way). A LIVE instance on our port (our container or a foreign
# listener) is stopped only after an explicit takeover answer in `start` mode -- TTY only; non-TTY refuses.
# `run` mode (supervised) keeps the hard refusal: a supervisor must never block on a prompt or kill a
# process it does not own.
container_exists() { docker inspect "$NAME" >/dev/null 2>&1; }
port_held() { ss -ltn | grep -q ":$PORT "; }
running_model() {   # what the server on $PORT actually serves (empty if not healthy or no OpenAI endpoint)
  curl -sf -m 3 "http://127.0.0.1:$PORT/v1/models" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"][0]["id"])' 2>/dev/null
}
if container_exists && ! running; then
  echo "$NAME is a dead leftover (crashed boot or host restart) -- removing it + its state file" >&2
  docker rm -f "$NAME" >/dev/null 2>&1; rm -f "$CFILE"
fi
if [ -f "$CFILE" ] && ! container_exists; then rm -f "$CFILE"; fi   # stale state without a container

if [ "${1:-start}" = start ]; then
  if container_exists || port_held; then
    model=$(running_model) || true
    [ -n "$model" ] || model=$(grep -oP '(?<=--served-model-name )\S+' "$CMDFILE" 2>/dev/null | head -1) || true
    if container_exists; then
      echo "vllm instance $NAME is running on port $PORT with model '${model:-unknown}'"
    else
      echo "a foreign process is holding port $PORT (model: '${model:-unknown}')"
    fi
    if [ ! -t 0 ]; then
      echo "stop it first (PORT=$PORT $0 stop), or rerun from a TTY to confirm the takeover" >&2
      exit 1
    fi
    read -r -p "Stop it and start '$SERVED_NAME' instead? [y/N] " ans || ans=""
    case "${ans:-N}" in
      y|Y|yes|YES) ;;
      *) echo "aborted -- the running instance was not touched" >&2; exit 1;;
    esac
    if container_exists; then docker rm -f "$NAME" >/dev/null 2>&1; rm -f "$CFILE"; fi
    for _ in $(seq 10); do port_held || break; sleep 1; done   # docker releases the port after the rm
    if port_held; then   # still owned: a foreign container publishing the port, or an orphaned process
      foreign=$(docker ps -q --filter "publish=$PORT")
      if [ -n "$foreign" ]; then
        echo "port $PORT is published by foreign container(s): $(docker ps --format '{{.Names}}' $foreign | tr '\n' ' ')" >&2
        echo "removing them per your answer" >&2
        docker rm -f $foreign >/dev/null 2>&1
      else
        pid=$(ss -ltnp 2>/dev/null | grep ":$PORT " | grep -oP 'pid=\K[0-9]+' | head -1) || true
        if [ -n "$pid" ] && [ "$pid" != "$$" ]; then
          echo "port $PORT held by pid $pid ($(ps -o comm= -p "$pid" 2>/dev/null)) -- killing it per your answer" >&2
          kill "$pid" 2>/dev/null || true
        else
          echo "cannot identify the holder of port $PORT -- aborting (ss -ltnp | grep :$PORT)" >&2
          exit 1
        fi
      fi
      for _ in $(seq 30); do port_held || break; sleep 1; done
      port_held && { echo "port $PORT still held -- aborting (ss -ltnp | grep :$PORT)" >&2; exit 1; }
    fi
  fi
else   # run mode: no prompts, no foreign kills -- the supervisor owns the lifecycle
  container_exists && { echo "$NAME exists — PORT=$PORT $0 stop first" >&2; exit 1; }
  port_held && { echo "port $PORT held by a foreign process: ss -ltnp | grep :$PORT" >&2; exit 1; }
fi
if [ "${1:-start}" = run ]; then
  # The supervisor has just stopped the previous model; give its VRAM time to drain, then refuse.
  for _ in $(seq "${FLOOR_WAIT:-90}"); do [ "$(vram_free_mib)" -ge "$FREE_MIB_FLOOR" ] && break; sleep 1; done
  f=$(vram_free_mib)
  if [ "$f" -lt "$FREE_MIB_FLOOR" ]; then
    echo "refusing to boot $NAME: ${f} MiB free < floor ${FREE_MIB_FLOOR} MiB — holders:" >&2
    amd-smi process -g 0 >&2 2>/dev/null || true; exit 1
  fi
else
  "${EXCLUSIVE:-$REPO/stack/gpu/gpu_exclusive.sh}" "$FREE_MIB_FLOOR"   # iron rule 14: free-VRAM floor or refuse (EXCLUSIVE = unit-test stub)
fi
for m in "${CACHE_MOUNTS[@]}"; do mkdir -p "$CACHE_DIR/${m%%:*}"; done   # profile-driven, dev-owned

DIGEST=$(docker image inspect -f '{{index .RepoDigests 0}}' "$IMAGE" 2>/dev/null || echo "$IMAGE")
{ printf '%q ' "${CMD[@]}"; echo
  echo "# image_digest=$DIGEST"
  echo "# profile=$PROFILE $(grep -E '^(repo|revision)=' "$MODEL_DIR/SOURCE.txt" 2>/dev/null | tr '\n' ' ')"
  [ -n "${DRAFT_DIR:-}" ] && echo "# drafter $(grep -E '^(repo|revision)=' "$DRAFT_DIR/SOURCE.txt" 2>/dev/null | tr '\n' ' ')"
  [ -n "${MODEL_CONFIG:-}" ] && echo "# model_config_override=$MODEL_CONFIG sha256=$(sha256sum "$MODEL_CONFIG" | cut -d' ' -f1)"
  echo "# started_utc=$(date -u +%FT%TZ)"; } > "$CMDFILE"
rm -f "$RUNDIR/$PORT.watchdog"
if [ "${1:-start}" = run ]; then
  # Watchdog until /health answers, then serving stays inside the util budget (same as `start`).
  boot_guard() {
    local n=0 f
    while sleep 0.2; do
      f=$(vram_free_mib)
      if [ "$WATCHDOG_MIB" -gt 0 ] && [ "$f" -lt "$WATCHDOG_MIB" ]; then
        docker kill "$NAME" >/dev/null 2>&1
        echo "free_mib=$f utc=$(date -u +%T.%N | cut -c1-12)" > "$RUNDIR/$PORT.watchdog"
        echo "WATCHDOG killed $NAME: VRAM nearly full during boot (${f} MiB free)" >&2; return
      fi
      n=$((n + 1)); [ $((n % 10)) = 0 ] || continue
      curl -sf -m 1 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && return
    done
  }
  boot_guard & BG=$!
  echo "running $NAME in the foreground on 127.0.0.1:$PORT ($PROFILE, $IMAGE)"
  # The docker client runs as a background job and the script `wait`s on it: bash defers a trap
  # until a FOREGROUND child exits, but `wait` is interruptible -- so a TERM from the supervisor
  # removes the container at once instead of hanging until it dies on its own.
  "${CMD[@]}" & DP=$!
  trap 'kill "$BG" 2>/dev/null; docker rm -f "$NAME" >/dev/null 2>&1' TERM INT
  rc=0; wait "$DP" || rc=$?
  if [ "$rc" -gt 128 ]; then wait "$DP" 2>/dev/null || true; fi
  kill "$BG" 2>/dev/null || true
  exit "$rc"
fi
"${CMD[@]}" > "$CFILE"
WD=""; if [ "$WATCHDOG_MIB" -gt 0 ]; then watchdog & WD=$!; trap '[ -n "$WD" ] && kill "$WD" 2>/dev/null' EXIT; fi
echo "starting $NAME on 127.0.0.1:$PORT ($PROFILE, $IMAGE) — first boot compiles, up to ${WAIT}s"

for i in $(seq "$WAIT"); do
  if ! running; then
    docker logs "$NAME" > "$LOGFILE" 2>&1 || true
    if [ -f "$RUNDIR/$PORT.watchdog" ]; then
      echo "WATCHDOG killed $NAME: VRAM nearly full during boot ($(cat "$RUNDIR/$PORT.watchdog"), floor ${WATCHDOG_MIB} MiB)" >&2
    fi
    echo "container DIED during startup — last log lines ($LOGFILE):" >&2; tail -15 "$LOGFILE" >&2
    docker rm -f "$NAME" >/dev/null 2>&1; rm -f "$CFILE"; exit 1
  fi
  if curl -sf -m 2 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
    [ -n "$WD" ] && kill "$WD" 2>/dev/null; WD=""
    SERVED=$(curl -sf -m 5 "http://127.0.0.1:$PORT/v1/models" | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"][0]["id"])' 2>/dev/null || true)
    if [ "$SERVED" != "$SERVED_NAME" ]; then
      echo "port $PORT serves '$SERVED', expected '$SERVED_NAME' — aborting" >&2; "$0" stop; exit 1
    fi
    VER=$(curl -sf -m 5 "http://127.0.0.1:$PORT/version" 2>/dev/null || true)
    echo "# vllm_version=$VER up_after_s=$i" >> "$CMDFILE"
    echo "up after ${i}s — model: $SERVED — vllm: ${VER:-?} — cmdline: $CMDFILE"
    exit 0
  fi
  sleep 1
done
echo "not healthy in ${WAIT}s — stopping" >&2; "$0" stop; exit 1

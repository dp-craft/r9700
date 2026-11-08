#!/usr/bin/env bash
# stack/serve/radiance/start_qwen38_27b_iq4r-l-v4_rad.sh — start/stop native Radiance ("rad") serving
# StillDeadcode/qwen3.8-27b-iqr-v4 @ qwen3.8-27b-iq4r-l-v4.rad (IQR-V4 ladder: 4.793 bpw, source KL
# 0.00297 vs bf16 — 24 % below the official FP8 checkpoint's KL at 55 % of its size) on one card.
# It is the 27B comparison twin of claude-rad-mxfp4.sh — same context config (262000 ctx, 2 seqs,
# user decision 2026-10-25) and same engine flags, so the A/B is quantization-only.
#   start_qwen38_27b_iq4r-l-v4_rad.sh start|stop|status|logs        then: claude --settings ~/.config/claude/local_vllm_direct/settings-redhat.json
# IMAGE pinned to 1.17.0: the IQR-V4 .rad containers REFUSE radiance <= 1.16.0 (model card), so
# 1.17.0 is the floor; the pin keeps the comparison reproducible (iron rule 2).
# Deviations from the MXFP4 twin, none of them model-facing:
#   --gpu-headroom-mib 596 instead of the default 96 — the headroom issue is live (113 MiB free at
#   peak crashed the desktop once; docs/guides/vllm/known-issues.md); HIP_FORCE_DEV_KERNARG=0 (the
#   twin's serve_radiance.sh sets it; an unset value gives random MEMORY_FAULT); EXTRA_ARGS appended last.
# Port and served name come from SETTINGS (default the 27b's settings-redhat.json), so the same config
# works unchanged. The name is an alias: Claude and /v1/models show the 27b's name while IQR answers
# (same pattern as start_ornith_35b_vllm_rad.sh).
# Fetch (18.7 GB, ONE file — not the whole repo, which holds all 15 V4 tiers ~200 GB):
#   /mnt/Lin1/work/vllm/sly-radiance/tools/hf-venv/bin/hf download StillDeadcode/qwen3.8-27b-iqr-v4 \
#     --revision e5f1b3ef70741d705a64a28b852acf3fcefcead7 --include "qwen3.8-27b-iq4r-l-v4.rad" \
#     --local-dir /mnt/Lin1/work/radiance/models/StillDeadcode__qwen3.8-27b-iqr-v4@e5f1b3ef
#   then write SOURCE.txt (repo/revision/date/size) next to it — iron rule 2: an unpinned checkpoint is an unreproducible number.
# serve_vllm.sh does not cover this: it builds vLLM arguments, native Radiance has its own CLI.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SETTINGS=${SETTINGS:-$HOME/.config/claude/local_vllm_direct/settings-redhat.json}
read -r SET_PORT MODEL < <(python3 - "$SETTINGS" <<'EOF'
import json, sys, urllib.parse
e = json.load(open(sys.argv[1]))["env"]
print(urllib.parse.urlparse(e["ANTHROPIC_BASE_URL"]).port or 80, e["ANTHROPIC_MODEL"])
EOF
)
MODEL_DIR=${MODEL_DIR:-/mnt/Lin1/work/radiance/models/StillDeadcode__qwen3.8-27b-iqr-v4@e5f1b3ef}
IMAGE=${IMAGE:-stilldeadcode/radiance:1.17.0}
PORT=${PORT:-$SET_PORT}
MAXLEN=${MAXLEN:-262000}
MAXSEQS=${MAXSEQS:-2}
FREE_MIB_FLOOR=${FREE_MIB_FLOOR:-30000}
WAIT=${WAIT:-900}
NAME=radiance-$PORT
# stack/ lives in the amd repo; the git-toplevel trick broke when this script got copied/symlinked
# out of it (~/.config and dp-forge are their own git repos), so the root is explicit now.
AMD_ROOT=${AMD_ROOT:-/home/dev/work/dp-craft/amd}

case "${1:-start}" in
  start)
    if ss -ltn | grep -q ":$PORT "; then echo "port $PORT is in use -- stop that server first" >&2; exit 1; fi
    [ -f "$MODEL_DIR/qwen3.8-27b-iq4r-l-v4.rad" ] || { echo "checkpoint missing in $MODEL_DIR (see Fetch above)" >&2; exit 1; }
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    "$AMD_ROOT/stack/gpu/gpu_exclusive.sh" "$FREE_MIB_FLOOR"
    # shellcheck disable=SC2086
    docker run -d --name "$NAME" --init --network host --user "$(id -u):$(id -g)" \
      --device /dev/kfd --device /dev/dri \
      --group-add "$(getent group render | cut -d: -f3)" --group-add "$(getent group video | cut -d: -f3)" \
      --security-opt seccomp=unconfined --ulimit memlock=-1 \
      -e HIP_FORCE_DEV_KERNARG=0 \
      -v "$MODEL_DIR":/models:ro "$IMAGE" \
      --model /models/qwen3.8-27b-iq4r-l-v4.rad --host 127.0.0.1 --port "$PORT" --served-model-name "$MODEL" \
      --tp 1 --max-num-seqs "$MAXSEQS" --max-model-len "$MAXLEN" --kv-cache-dtype fp8 --gpu-headroom-mib 596 \
      --reasoning-effort-map high=xhigh ${EXTRA_ARGS:-} >/dev/null
    for ((i = 0; i < WAIT; i += 5)); do
      if curl -sf -m 3 "http://127.0.0.1:$PORT/v1/models" >/dev/null; then
        echo "up after ${i}s on port $PORT: $IMAGE (Qwen3.8-27B IQ4R-L-V4, 4.793 bpw)"
        echo "served under alias $MODEL (settings-redhat.json is shared with the MXFP4 server, so /v1/models shows that name)"
        echo "ready: claude --settings $SETTINGS"; exit 0
      fi
      if [ "$(docker inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null)" != true ]; then
        echo "container exited during boot; last log lines:" >&2; docker logs --tail 40 "$NAME" >&2
        docker rm -f "$NAME" >/dev/null 2>&1 || true   # a failed boot must not leak the container
        exit 1
      fi
      sleep 5
    done
    echo "not up after ${WAIT}s; last log lines:" >&2; docker logs --tail 40 "$NAME" >&2
    docker rm -f "$NAME" >/dev/null 2>&1 || true   # a failed boot must not leak the container
    exit 1;;
  stop) docker stop -t 60 "$NAME" >/dev/null 2>&1 || true; docker rm -f "$NAME" >/dev/null 2>&1 || true
    for _ in $(seq 30); do ss -ltn | grep -q ":$PORT " || break; sleep 1; done
    if ss -ltn | grep -q ":$PORT "; then echo "port $PORT still held" >&2; exit 1; fi
    # TIME_WAIT: closed connections hold :$PORT for the kernel MSL (~60 s) with no LISTEN socket left,
    # so a fresh bind fails EADDRINUSE in that window. Wait it out so "stopped" means the port is actually re-bindable.
    for _ in $(seq 70); do ss -ltn state time-wait 2>/dev/null | grep -q ":$PORT " || break; sleep 1; done
    ;;
  status) docker ps --filter "name=^$NAME$" --format '{{.Names}} {{.Image}} {{.Status}}'
    curl -s -m 3 "http://127.0.0.1:$PORT/v1/models" || true; echo;;
  logs) docker logs "$NAME";;
  *) echo "usage: $0 start|stop|status|logs" >&2; exit 2;;
esac

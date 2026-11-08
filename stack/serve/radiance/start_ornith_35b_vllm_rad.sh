#!/usr/bin/env bash
# stack/serve/radiance/start_ornith_35b_vllm_rad.sh — start/stop native Radiance ("rad") serving
# keptn/ornith-1.5-35b-a3b-w4a8 (own MTP head, K=3) on one card. (was ornith_rad_mtp.sh, renamed 2026-11-08)
#   start_ornith_35b_vllm_rad.sh start|stop|status|logs        then: claude --settings ~/.config/claude/local_vllm_direct/settings-redhat.json
# Flags = the creator's deploy/compose/ornith-1.5-35b-a3b-w4a8-tp1.yaml (codeberg.org/StillDeadcode/radiance) verbatim.
# Deviations from that compose file, none of them model-facing:
#   --host 127.0.0.1 instead of :: (local only, so no API key); no restart policy (a reboot must not hold VRAM);
#   image pinned instead of :latest (iron rule 2); --served-model-name = the usual Claude settings' ANTHROPIC_MODEL;
#   --gpu-headroom-mib 596 instead of the default 96 (see VRAM below); --max-num-seqs 3 instead of 8 (3 parallel at most).
# Claude: port and served name come from SETTINGS (default the 27b's settings-redhat.json), so the same config works
# unchanged. The name is an alias: Claude and /v1/models show the 27b's name while Ornith answers.
# VRAM: Radiance claims all free VRAM minus the headroom, whatever --max-model-len is; the KV cache takes the rest.
# The default 96 left about 232 MiB free (MEASURED), which crashed the desktop once, so the headroom is 500 MiB higher;
# not measured yet. Close Chrome if VRAM gets tight.
# EXTRA_ARGS="--gpu-headroom-mib 2048" is recommended only (docs/guides/vllm/known-issues.md).
# For precise coding the creator suggests --temp 0.6 --presence-penalty 0 (EXTRA_ARGS=... appended last, later flag wins).
# Thinking stays on (operator's rule; added to the compose flags): explicit default, and reasoning_effort none/minimal is
# remapped. A request's own chat_template_kwargs {"enable_thinking":false} still wins; no server flag blocks that.
# Fetch: stack/serve/vllm/fetch_model.sh keptn/ornith-1.5-35b-a3b-w4a8 cfed0f8f07d0ef8d0c7dcf4d29a07eeb6a402472
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
VLLM_ROOT=${VLLM_ROOT:-/mnt/Lin1/work/vllm/sly-radiance}
MODEL_DIR=${MODEL_DIR:-$VLLM_ROOT/models/keptn__ornith-1.5-35b-a3b-w4a8@cfed0f8f}
IMAGE=${IMAGE:-stilldeadcode/radiance:1.16.0}
PORT=${PORT:-$SET_PORT}
FREE_MIB_FLOOR=${FREE_MIB_FLOOR:-30000}
WAIT=${WAIT:-900}
NAME=radiance-$PORT
# stack/ lives in the amd repo; the git-toplevel trick broke when this script got copied/symlinked
# out of it (~/.config and dp-forge are their own git repos), so the root is explicit now.
AMD_ROOT=${AMD_ROOT:-/home/dev/work/dp-craft/amd}

case "${1:-start}" in
  start)
    if ss -ltn | grep -q ":$PORT "; then echo "port $PORT is in use -- stop that server first" >&2; exit 1; fi
    [ -f "$MODEL_DIR/ornith-1.5-35b-a3b-w4a8.rad" ] || { echo "checkpoint missing in $MODEL_DIR (see Fetch above)" >&2; exit 1; }
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    "$AMD_ROOT/stack/gpu/gpu_exclusive.sh" "$FREE_MIB_FLOOR"
    # shellcheck disable=SC2086
    docker run -d --name "$NAME" --init --network host --user "$(id -u):$(id -g)" \
      --device /dev/kfd --device /dev/dri \
      --group-add "$(getent group render | cut -d: -f3)" --group-add "$(getent group video | cut -d: -f3)" \
      --security-opt seccomp=unconfined --ulimit memlock=-1 \
      -v "$MODEL_DIR":/models:ro "$IMAGE" \
      --model /models/ornith-1.5-35b-a3b-w4a8.rad --host 127.0.0.1 --port "$PORT" --served-model-name "$MODEL" \
      --tp 1 --max-num-seqs 3 --max-model-len 262144 --kv-cache-dtype fp8 --gpu-headroom-mib 596 \
      --num-speculative-tokens 3 --max-num-batched-tokens 2048 \
      --temp 1.0 --top-p 0.95 --top-k 20 --presence-penalty 1.5 \
      --chat-template-kwargs '{"enable_thinking":true}' --reasoning-effort-map none=high,minimal=high ${EXTRA_ARGS:-} >/dev/null
    for ((i = 0; i < WAIT; i += 5)); do
      if curl -sf -m 3 "http://127.0.0.1:$PORT/v1/models" >/dev/null; then
        echo "up after ${i}s on port $PORT: $IMAGE (Ornith 1.5-35B-A3B w4a8, own MTP K=3)"
        echo "served under alias $MODEL (settings-redhat.json is shared with the 27B server, so /v1/models shows that name)"
        echo "ready: claude --settings $SETTINGS"; exit 0
      fi
      if [ "$(docker inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null)" != true ]; then
        echo "container exited during boot; last log lines:" >&2; docker logs --tail 40 "$NAME" >&2; exit 1
      fi
      sleep 5
    done
    echo "not up after ${WAIT}s; 'docker logs $NAME'" >&2; exit 1;;
  stop) docker stop -t 60 "$NAME" >/dev/null 2>&1 || true; docker rm -f "$NAME" >/dev/null 2>&1 || true
    for _ in $(seq 30); do ss -ltn | grep -q ":$PORT " || break; sleep 1; done
    if ss -ltn | grep -q ":$PORT "; then echo "port $PORT still held" >&2; exit 1; fi;;
  status) docker ps --filter "name=^$NAME$" --format '{{.Names}} {{.Image}} {{.Status}}'
    curl -s -m 3 "http://127.0.0.1:$PORT/v1/models" || true; echo;;
  logs) docker logs "$NAME";;
  *) echo "usage: $0 start|stop|status|logs" >&2; exit 2;;
esac

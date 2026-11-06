#!/usr/bin/env bash
# ornith_sly_dflash.sh — start/stop Sly 1.9.1 serving Capicua25x/Ornith-1.5-35B-A3B-MXFP4-Quark-RDNA4 + the official
# ornith-ai/Ornith-1.5-35B-A3B-DFlash drafter (K=3) on one card, through serve_vllm.sh.
# ARCHIVED 2026-11-04: slower than ornith_rad_mtp.sh, and its checkpoints were deleted. Run the Fetch lines below (repo root) first.
#   bench/engine-bench/vllm/archive/ornith_sly_dflash.sh start|stop|status|logs     then: claude --settings ~/.config/claude/local_vllm_direct/settings-redhat.json
# Settings = the MEASURED arm bench/runs/2026-11-04-1802-ornith15-sly-dflash/ornith-k3-s8: Radiance's serving values
# (K=3, 8 seqs, batched 2048, ctx 262144, fp8 KV, temp 1.0, top_p 0.95, top_k 20, presence 1.5) on Sly's own stack.
# This is the slower Ornith setup: 95/71/67 t/s at 10k/50k/100k against 220/205/175 on ornith_rad_mtp.sh.
# MTP is not available here: triton_unfused, triton and aiter all fail at load on this checkpoint (docs/vllm/known-issues.md).
# triton_unfused follows the checkpoint card's gfx12 advice; the default backend falls back to slow emulation.
# Claude: port and served name come from SETTINGS (default the 27b's settings-redhat.json), so the same config works
# unchanged. The name is an alias: Claude and /v1/models show the 27b's name while Ornith answers.
# Fetch: bench/engine-bench/vllm/fetch_model.sh Capicua25x/Ornith-1.5-35B-A3B-MXFP4-Quark-RDNA4 9e488f46c0f7969f84c9923ee0256311cd50316e
#        bench/engine-bench/vllm/fetch_model.sh ornith-ai/Ornith-1.5-35B-A3B-DFlash 942d20fee84d04c9ecbf18e9c6fc4144914a1d5d
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVE="$HERE/../serve_vllm.sh"
SETTINGS=${SETTINGS:-$HOME/.config/claude/local_vllm_direct/settings-redhat.json}
read -r SET_PORT MODEL < <(python3 - "$SETTINGS" <<'EOF'
import json, sys, urllib.parse
e = json.load(open(sys.argv[1]))["env"]
print(urllib.parse.urlparse(e["ANTHROPIC_BASE_URL"]).port or 80, e["ANTHROPIC_MODEL"])
EOF
)
VLLM_ROOT=${VLLM_ROOT:-/mnt/Lin1/work/vllm/sly-radiance}
MODEL_DIR=$VLLM_ROOT/models/Capicua25x__Ornith-1.5-35B-A3B-MXFP4-Quark-RDNA4@9e488f46
DRAFT_DIR=$VLLM_ROOT/models/ornith-ai__Ornith-1.5-35B-A3B-DFlash@942d20fe
PORT=${PORT:-$SET_PORT}
XA='--moe-backend triton_unfused --max-num-batched-tokens 2048 --override-generation-config {"temperature":1.0,"top_p":0.95,"top_k":20,"min_p":0.0,"presence_penalty":1.5}'

case "${1:-start}" in
  start)
    [ -f "$MODEL_DIR/model.safetensors" ] && [ -f "$DRAFT_DIR/model.safetensors" ] || {
      echo "checkpoints missing under $VLLM_ROOT/models (see Fetch above)" >&2; exit 1; }
    PROFILE=sly-amd/qwen35-35b-a3b-mxfp4-dflash PORT=$PORT \
      MODEL_DIR=$MODEL_DIR DRAFT_DIR=$DRAFT_DIR SERVED_NAME=$MODEL \
      SPEC_K=3 MAXLEN=262144 MAXSEQS=8 KV_DTYPE=fp8 WATCHDOG_MIB=32 GPU_UTIL=0.93 CACTUS_DELTA=0 \
      EXTRA_ARGS="$XA ${EXTRA_ARGS:-}" "$SERVE" start
    echo "ready: claude --settings $SETTINGS";;
  stop|status|logs) PORT=$PORT "$SERVE" "$1";;
  *) echo "usage: $0 start|stop|status|logs" >&2; exit 2;;
esac

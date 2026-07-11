#!/usr/bin/env bash
# vLLM sweep: 35B-A3B-AWQ × KV {fp8, fp16} at CTX. 27B-AWQ attempt (documents kernel block).
source "$(dirname "$0")/config.sh"; source "$(dirname "$0")/lib.sh"
NAME=vllm-bench

one() { # <label> <model_dir> <kv> <model_tag>
  local label="$1" mdir="$2" kv="$3" tag="$4"
  local kvarg=""; [ "$kv" = fp8 ] && kvarg="--kv-cache-dtype fp8"
  local cfg
  cfg=$(printf '{"model":"%s","format":"AWQ 4-bit","ctx":%d,"kv_bits":"%s","gpu_mem_util":0.92,"cudagraphs":true,"engine":"vLLM 0.19.1"}' \
        "$tag" "$CTX" "$([ "$kv" = fp8 ] && echo 8 || echo 16)")
  echo ">>> vLLM $label (kv=$kv)"
  docker rm -f $NAME 2>/dev/null >/dev/null
  docker run -d --name $NAME \
    --device /dev/kfd --device /dev/dri --group-add $RENDER_GID --group-add $VIDEO_GID \
    --ipc=host --shm-size=8g --memory=26g --memory-swap=26g \
    -e HSA_OVERRIDE_GFX_VERSION=$HSA -e PYTORCH_ALLOC_CONF=expandable_segments:True \
    -v "$mdir":/model:ro -v "$HARNESS/.hf-cache":/root/.cache/huggingface -p 8000:8000 \
    "$IMG" vllm serve /model --served-model-name m --quantization awq --dtype float16 \
    --max-model-len $CTX --gpu-memory-utilization 0.92 $kvarg >/dev/null 2>&1
  local g; g=$(start_guard "docker kill $NAME" "$HARNESS/guard_vllm_${label}.log")
  if wait_http "http://127.0.0.1:8000/health" 480; then
     sleep 2
     python3 "$HARNESS/probe.py" vllm m "$label" "$cfg" "$RESULTS" || echo "  PROBE FAIL $label"
  else
     local reason; reason=$(docker logs $NAME 2>&1 | grep -iE 'out of memory|Failed to find a kernel|not supported|Value error|No available memory' | tail -1 | tr -d '"' | cut -c1-160)
     echo "{\"runtime\":\"vllm\",\"label\":\"$label\",\"status\":\"LOAD_FAIL\",\"reason\":\"$reason\",$(echo "$cfg"|sed 's/^{//')" >> "$RESULTS"
     echo "  LOAD FAIL $label: $reason"
  fi
  kill "$g" 2>/dev/null; docker rm -f $NAME 2>/dev/null >/dev/null; sleep 3
}

mkdir -p "$HARNESS/.hf-cache"
one "vllm_35B_fp8"  "$AWQ_35B" fp8  "35B-A3B-AWQ"
one "vllm_35B_fp16" "$AWQ_35B" fp16 "35B-A3B-AWQ"
one "vllm_27B_fp8"  "$AWQ_27B" fp8  "27B-AWQ"   # documents WNA16/group_size=32 ROCm kernel block
echo "=== vLLM phase done ==="

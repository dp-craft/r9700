#!/usr/bin/env bash
# Warm Vulkan (RADV) measurement: a warmup probe (compiles shaders) precedes the measured probe,
# so prefill isn't penalized by one-time SPIR-V compilation. ub2048/b8192, KV f16, 64K.
source "$(dirname "$0")/config.sh"; source "$(dirname "$0")/lib.sh"
PORT=8899
V="$REPO/bench/llamacpp-vulkan"
pkill -9 -f llama-server 2>/dev/null; sleep 2

run_warm() { # <gguf> <tag> <label>
  local gguf="$1" tag="$2" label="$3"
  local cfg
  cfg=$(printf '{"model":"%s","format":"GGUF Q4","ctx":%d,"kv_bits":"f16","ub":2048,"batch":8192,"flash_attn":"on","ngl":99,"backend":"Vulkan-RADV-warm","mtp":false}' "$tag" "$CTX")
  LD_LIBRARY_PATH="$V" "$V/llama-server" -m "$gguf" --host 127.0.0.1 --port $PORT \
     -c "$CTX" --flash-attn on -ctk f16 -ctv f16 -ngl 99 -b 8192 -ub 2048 --no-webui > "$HARNESS/log_vkw_${label}.log" 2>&1 &
  local pid=$!
  local g; g=$(start_guard "kill $pid 2>/dev/null" "$HARNESS/guard_vkw_${label}.log")
  if wait_http "http://127.0.0.1:$PORT/health" 360; then
    python3 "$HARNESS/probe.py" llamacpp $PORT "${label}_warmup" '{"_warm":true}' /tmp/vk_scratch.jsonl >/dev/null 2>&1
    python3 "$HARNESS/probe.py" llamacpp $PORT "$label" "$cfg" "$RESULTS"
  else
    echo "  LOAD FAIL $label"; tail -5 "$HARNESS/log_vkw_${label}.log"
  fi
  kill -9 $pid 2>/dev/null; kill "$g" 2>/dev/null; sleep 3
}

run_warm "$GGUF_35B" "35B-A3B" "vkw_35B"
run_warm "$GGUF_27B" "27B-MTP" "vkw_27B"
echo "=== vk warm done ==="

#!/usr/bin/env bash
# Backend comparison at a fixed good config: same GGUF, same ctx/ub/KV, different llama.cpp build.
# Usage: RESULTS=/path bash run_backend.sh <build_dir> <backend_label> [ub] [fa_on|fa_off]
#   e.g. run_backend.sh /home/dev/work/dippe/amd/bench/llamacpp-vulkan     Vulkan-b9950
#        run_backend.sh /home/dev/work/dippe/amd/bench/llamacpp-rocm-b9950 ROCm7.2-b9950
source "$(dirname "$0")/config.sh"; source "$(dirname "$0")/lib.sh"
PORT=8899
BUILD="$1"; BE="$2"; UB="${3:-2048}"; FA="${4:-fa_on}"; KV="${KV:-f16}"
faflag="--flash-attn on"; [ "$FA" = fa_off ] && faflag="--flash-attn off"
batch="${BB:-16384}"; [ "$UB" -gt "$batch" ] && batch=$UB

one() { # <label> <gguf> <model_tag>
  local label="$1" gguf="$2" tag="$3"
  local cfg
  cfg=$(printf '{"model":"%s","format":"GGUF Q4","ctx":%d,"kv_bits":"%s","ub":%d,"batch":%d,"flash_attn":"%s","ngl":99,"backend":"%s","mtp":false}' \
        "$tag" "$CTX" "$KV" "$UB" "$batch" "$FA" "$BE")
  echo ">>> $BE $label (ub=$UB $FA)"
  LD_LIBRARY_PATH="$BUILD" "$BUILD/llama-server" -m "$gguf" --host 127.0.0.1 --port $PORT \
     -c "$CTX" $faflag -ctk "$KV" -ctv "$KV" -ngl 99 -b "$batch" -ub "$UB" --no-webui \
     > "$HARNESS/log_be_${BE}_${label}.log" 2>&1 &
  local pid=$!
  local g; g=$(start_guard "kill $pid 2>/dev/null" "$HARNESS/guard_be_${BE}_${label}.log")
  if wait_http "http://127.0.0.1:$PORT/health" 360; then
     sleep 2
     python3 "$HARNESS/probe.py" llamacpp $PORT "$label" "$cfg" "$RESULTS" || echo "  PROBE FAIL $label"
  else
     echo "{\"runtime\":\"llamacpp\",\"label\":\"$label\",\"status\":\"LOAD_FAIL\",$(echo "$cfg"|sed 's/^{//')" >> "$RESULTS"
     echo "  LOAD FAIL/timeout $label"; tail -8 "$HARNESS/log_be_${BE}_${label}.log"
  fi
  kill $pid 2>/dev/null; kill "$g" 2>/dev/null; wait $pid 2>/dev/null; sleep 4
}

echo "build=$BUILD backend=$BE"; "$BUILD/llama-server" --version 2>&1 | head -1
one "be_${BE}_35B" "$GGUF_35B" "35B-A3B"
one "be_${BE}_27B" "$GGUF_27B" "27B-MTP"
echo "=== backend $BE done ==="

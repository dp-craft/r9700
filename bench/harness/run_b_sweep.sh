#!/usr/bin/env bash
# llama.cpp logical-batch (-b) sweep at fixed -ub 2048, KV f16, on the b1295 build.
# Research (llama.cpp Disc #21043) says -b 16384 -ub 2048 is the R9700 MoE optimum; verify.
# Usage: RESULTS=/path bash run_b_sweep.sh
source "$(dirname "$0")/config.sh"; source "$(dirname "$0")/lib.sh"
PORT=8899; KV=f16; UB=2048
BS=(${BS:-2048 4096 8192 16384})

one() { # <label> <gguf> <b> <tag>
  local label="$1" gguf="$2" b="$3" tag="$4"
  local cfg
  cfg=$(printf '{"model":"%s","format":"GGUF Q4","ctx":%d,"kv_bits":"%s","ub":%d,"batch":%d,"flash_attn":"on","ngl":99,"backend":"ROCm/HIP","mtp":false}' \
        "$tag" "$CTX" "$KV" "$UB" "$b")
  echo ">>> b-sweep $label (b=$b ub=$UB)"
  LD_LIBRARY_PATH="$LC" "$LC/llama-server" -m "$gguf" --host 127.0.0.1 --port $PORT \
     -c "$CTX" --flash-attn on -ctk "$KV" -ctv "$KV" -ngl 99 -b "$b" -ub "$UB" -fit off --no-webui \
     > "$HARNESS/log_bsw_${label}.log" 2>&1 &
  local pid=$!
  local g; g=$(start_guard "kill $pid 2>/dev/null" "$HARNESS/guard_bsw_${label}.log")
  if wait_http "http://127.0.0.1:$PORT/health" 360; then
     sleep 2; python3 "$HARNESS/probe.py" llamacpp $PORT "$label" "$cfg" "$RESULTS" || echo "  PROBE FAIL $label"
  else
     echo "{\"runtime\":\"llamacpp\",\"label\":\"$label\",\"status\":\"LOAD_FAIL\",$(echo "$cfg"|sed 's/^{//')" >> "$RESULTS"
     echo "  LOAD FAIL $label"; tail -4 "$HARNESS/log_bsw_${label}.log"
  fi
  kill $pid 2>/dev/null; kill "$g" 2>/dev/null; wait $pid 2>/dev/null; sleep 4
}

for b in "${BS[@]}"; do one "b_35B_${b}" "$GGUF_35B" "$b" "35B-A3B"; done
for b in "${BS[@]}"; do one "b_27B_${b}" "$GGUF_27B" "$b" "27B-MTP"; done
echo "=== b sweep done ==="

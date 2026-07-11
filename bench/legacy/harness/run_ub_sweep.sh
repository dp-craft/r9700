#!/usr/bin/env bash
# llama.cpp micro-batch (-ub) sweep to find the prefill plateau on RDNA4/gfx1201.
# Holds KV=f16 (best decode; fits 64K) and sweeps -ub, with -b matched to max(2048,ub).
# Prefill scales UP with ub on this build; this finds where it stops improving / OOMs.
# Usage: RESULTS=/path/file.jsonl bash run_ub_sweep.sh
source "$(dirname "$0")/config.sh"; source "$(dirname "$0")/lib.sh"
PORT=8899
KV=f16
UBS=(${UBS:-512 1024 2048 4096 8192})

one() { # <label> <gguf> <ub> <model_tag>
  local label="$1" gguf="$2" ub="$3" tag="$4"
  local batch=$(( ub > 2048 ? ub : 2048 ))
  local cfg
  cfg=$(printf '{"model":"%s","format":"GGUF Q4","ctx":%d,"kv_bits":"%s","ub":%d,"batch":%d,"flash_attn":"on","ngl":99,"backend":"ROCm/HIP","mtp":false}' \
        "$tag" "$CTX" "$KV" "$ub" "$batch")
  echo ">>> llama.cpp $label (kv=$KV ub=$ub b=$batch)"
  LD_LIBRARY_PATH="$LC" "$LC/llama-server" -m "$gguf" --host 127.0.0.1 --port $PORT \
     -c "$CTX" --flash-attn on -ctk "$KV" -ctv "$KV" -ngl 99 -b "$batch" -ub "$ub" -fit off --no-webui \
     > "$HARNESS/log_ub_${label}.log" 2>&1 &
  local pid=$!
  local g; g=$(start_guard "kill $pid 2>/dev/null" "$HARNESS/guard_ub_${label}.log")
  if wait_http "http://127.0.0.1:$PORT/health" 360; then
     sleep 2
     python3 "$HARNESS/probe.py" llamacpp $PORT "$label" "$cfg" "$RESULTS" || echo "  PROBE FAIL $label"
  else
     echo "{\"runtime\":\"llamacpp\",\"label\":\"$label\",\"status\":\"LOAD_FAIL\",$(echo "$cfg"|sed 's/^{//')" >> "$RESULTS"
     echo "  LOAD FAIL/timeout $label"; tail -4 "$HARNESS/log_ub_${label}.log"
  fi
  kill $pid 2>/dev/null; kill "$g" 2>/dev/null; wait $pid 2>/dev/null; sleep 4
}

for ub in "${UBS[@]}"; do one "ub_35B_${ub}" "$GGUF_35B" "$ub" "35B-A3B"; done
for ub in "${UBS[@]}"; do one "ub_27B_${ub}" "$GGUF_27B" "$ub" "27B-MTP"; done
echo "=== ub sweep done ==="

#!/usr/bin/env bash
# MTP speculative decode on 27B, Vulkan (RADV) vs ROCm (b1295), matched config:
#   -ub 2048 -b 8192 -fa on -ctk/-ctv f16 --spec-type draft-mtp --spec-draft-n-max 3
# Vulkan gets a warm-up probe (SPIR-V compile) before the measured one.
# Usage: RESULTS=/path bash run_mtp_backend.sh
source "$(dirname "$0")/config.sh"; source "$(dirname "$0")/lib.sh"
PORT=8899
pkill -x llama-server 2>/dev/null; sleep 2

run() { # <build_dir> <backend> <warm0|1>
  local build="$1" be="$2" warm="$3"
  local cfg
  cfg=$(printf '{"model":"27B-MTP","format":"GGUF Q4","ctx":%d,"kv_bits":"f16","ub":2048,"batch":8192,"flash_attn":"on","ngl":99,"backend":"%s","mtp":true}' "$CTX" "$be")
  echo ">>> MTP $be (27B, ub2048/b8192/f16)"
  LD_LIBRARY_PATH="$build" "$build/llama-server" -m "$GGUF_27B" --host 127.0.0.1 --port $PORT \
     -c "$CTX" -ngl 99 -b 8192 -ub 2048 --flash-attn on -ctk f16 -ctv f16 \
     --spec-type draft-mtp --spec-draft-n-max 3 --no-webui \
     > "$HARNESS/log_mtp_${be}.log" 2>&1 &
  local pid=$!
  local g; g=$(start_guard "kill $pid 2>/dev/null" "$HARNESS/guard_mtp_${be}.log")
  if wait_http "http://127.0.0.1:$PORT/health" 360; then
    [ "$warm" = 1 ] && python3 "$HARNESS/probe.py" llamacpp $PORT "mtp_${be}_warmup" '{"_w":1}' /tmp/mtp_scratch.jsonl >/dev/null 2>&1
    python3 "$HARNESS/probe.py" llamacpp $PORT "mtp_${be}" "$cfg" "$RESULTS" || echo "  PROBE FAIL $be"
  else
    echo "  LOAD FAIL $be"; tail -8 "$HARNESS/log_mtp_${be}.log"
  fi
  kill -9 $pid 2>/dev/null; kill "$g" 2>/dev/null; sleep 4
}

run "$REPO/bench/llamacpp-vulkan" "Vulkan-RADV-MTP" 1
run "$REPO/bench/llamacpp"        "ROCm-b1295-MTP"  0
echo "=== MTP backend test done ==="

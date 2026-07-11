#!/usr/bin/env bash
# 35B MTP + dpm=high delta batch. All at -ub 2048 -b 8192 -fa on -ctk/-ctv f16, 64K.
# Vulkan runs get a warm-up probe (SPIR-V compile). Records draft acceptance for MTP runs.
# Usage: RESULTS=/path bash run_mtp35.sh
source "$(dirname "$0")/config.sh"; source "$(dirname "$0")/lib.sh"
PORT=8899
VK="$REPO/bench/llamacpp-vulkan"; RC="$REPO/bench/llamacpp"
pkill -x llama-server 2>/dev/null; sleep 2

launch() { # <build> <gguf> <mtp0|1>
  local build="$1" gguf="$2" mtp="$3" extra=""
  [ "$mtp" = 1 ] && extra="--spec-type draft-mtp --spec-draft-n-max 3"
  LD_LIBRARY_PATH="$build" "$build/llama-server" -m "$gguf" --host 127.0.0.1 --port $PORT \
     -c "$CTX" -ngl 99 -b 8192 -ub 2048 --flash-attn on -ctk f16 -ctv f16 $extra --no-webui \
     > "$HARNESS/log_m35_${LBL}.log" 2>&1 &
  echo $!
}

run() { # <label> <build> <gguf> <backend> <mtp0|1> <warm0|1> <tag>
  LBL="$1"; local build="$2" gguf="$3" be="$4" mtp="$5" warm="$6" tag="$7"
  local cfg
  cfg=$(printf '{"model":"%s","format":"GGUF Q4","ctx":%d,"kv_bits":"f16","ub":2048,"batch":8192,"flash_attn":"on","ngl":99,"backend":"%s","mtp":%s,"dpm":"high"}' \
        "$tag" "$CTX" "$be" "$([ "$mtp" = 1 ] && echo true || echo false)")
  echo ">>> $1 ($be mtp=$mtp)"
  local pid; pid=$(launch "$build" "$gguf" "$mtp")
  local g; g=$(start_guard "kill $pid 2>/dev/null" "$HARNESS/guard_m35_${LBL}.log")
  if wait_http "http://127.0.0.1:$PORT/health" 360; then
    [ "$warm" = 1 ] && python3 "$HARNESS/probe.py" llamacpp $PORT "${1}_w" '{"_w":1}' /tmp/m35.jsonl >/dev/null 2>&1
    python3 "$HARNESS/probe.py" llamacpp $PORT "$1" "$cfg" "$RESULTS" || echo "  PROBE FAIL $1"
  else
    echo "  LOAD FAIL $1"; tail -8 "$HARNESS/log_m35_${LBL}.log"
  fi
  kill -9 $pid 2>/dev/null; kill "$g" 2>/dev/null; sleep 4
}

# dpm=high delta on the prior headline configs (same models/config as the auto runs)
run "hi_35B_vk"        "$VK" "$GGUF_35B"     "Vulkan-RADV"      0 1 "35B-A3B"      # vs auto 3137/113
run "hi_27B_vk_mtp"    "$VK" "$GGUF_27B"     "Vulkan-RADV-MTP"  1 1 "27B-MTP"      # vs auto 843/72.2
# 35B MTP on the new unsloth MTP-preserved GGUF
run "m35_vk_nomtp"     "$VK" "$GGUF_35B_MTP" "Vulkan-RADV"      0 1 "35B-A3B-MTPgguf"  # MTP baseline
run "m35_vk_mtp"       "$VK" "$GGUF_35B_MTP" "Vulkan-RADV-MTP"  1 1 "35B-A3B-MTPgguf"  # headline
run "m35_rocm_mtp"     "$RC" "$GGUF_35B_MTP" "ROCm-b1295-MTP"   1 0 "35B-A3B-MTPgguf"  # backend compare
echo "=== 35B MTP + dpm batch done ==="

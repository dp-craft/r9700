#!/usr/bin/env bash
# Consolidated canonical batch @ current dpm state (auto). Same config everywhere:
#   ctx=64K, ub=2048, b=8192, KV f16, ngl=99, flash-attn on. Vulkan runs get a warmup probe.
# Covers: llama.cpp Vulkan (verify), llama.cpp ROCm (verify), Vulkan+MTP 35B & 27B (fill gap @auto).
source "$(dirname "$0")/config.sh"; source "$(dirname "$0")/lib.sh"
VK="$REPO/bench/llamacpp-vulkan"; ROCM="$REPO/bench/llamacpp-rocm-b9950"
PORT=8899
DPM=$(cat /sys/class/drm/card1/device/power_dpm_force_performance_level 2>/dev/null || echo "?")
echo "### dpm state = $DPM ###"

run() { # <label> <build> <gguf> <tag> <backend> <mtp:0|1> <warm:0|1>
  local label="$1" build="$2" gguf="$3" tag="$4" be="$5" mtp="$6" warm="$7"
  local specarg=""; [ "$mtp" = 1 ] && specarg="--spec-type draft-mtp --spec-draft-n-max 3"
  local cfg
  cfg=$(printf '{"model":"%s","format":"GGUF Q4","ctx":%d,"kv_bits":"f16","ub":2048,"batch":8192,"flash_attn":"on","ngl":99,"backend":"%s","mtp":%s,"dpm":"%s"}' \
        "$tag" "$CTX" "$be" "$([ "$mtp" = 1 ] && echo true || echo false)" "$DPM")
  echo ">>> $label ($be mtp=$mtp)"
  LD_LIBRARY_PATH="$build" "$build/llama-server" -m "$gguf" --host 127.0.0.1 --port $PORT \
     -c "$CTX" --flash-attn on -ctk f16 -ctv f16 -ngl 99 -b 8192 -ub 2048 $specarg --no-webui \
     > "$HARNESS/log_fin_${label}.log" 2>&1 &
  local pid=$!
  local g; g=$(start_guard "kill $pid 2>/dev/null" "$HARNESS/guard_fin_${label}.log")
  if wait_http "http://127.0.0.1:$PORT/health" 360; then
     sleep 2
     [ "$warm" = 1 ] && python3 "$HARNESS/probe.py" llamacpp $PORT "${label}_w" '{"_w":1}' /tmp/fin_scratch.jsonl >/dev/null 2>&1
     python3 "$HARNESS/probe.py" llamacpp $PORT "$label" "$cfg" "$RESULTS" || echo "  PROBE FAIL $label"
  else
     echo "  LOAD FAIL $label"; tail -6 "$HARNESS/log_fin_${label}.log"
  fi
  kill $pid 2>/dev/null; kill "$g" 2>/dev/null; wait $pid 2>/dev/null; sleep 4
}

# --- verify top llama.cpp Vulkan (warm) ---
run "fin35_vk"       "$VK"   "$GGUF_35B"     "35B-A3B" "Vulkan-RADV"     0 1
run "fin27_vk"       "$VK"   "$GGUF_27B"     "27B-MTP" "Vulkan-RADV"     0 1
# --- verify top llama.cpp ROCm ---
run "fin35_rocm"     "$ROCM" "$GGUF_35B"     "35B-A3B" "ROCm-b9950"      0 0
run "fin27_rocm"     "$ROCM" "$GGUF_27B"     "27B-MTP" "ROCm-b9950"      0 0
# --- MTP @ auto (fill gap): 35B same-model delta + 27B reconfirm ---
run "fin35_vk_nomtp" "$VK"   "$GGUF_35B_MTP" "35B-A3B-MTPgguf" "Vulkan-RADV"     0 1
run "fin35_vk_mtp"   "$VK"   "$GGUF_35B_MTP" "35B-A3B-MTPgguf" "Vulkan-RADV-MTP" 1 1
run "fin27_vk_mtp"   "$VK"   "$GGUF_27B"     "27B-MTP"         "Vulkan-RADV-MTP" 1 1
echo "=== llama final batch done (dpm=$DPM) ==="

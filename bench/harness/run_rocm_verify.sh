source "$(dirname "$0")/config.sh"; source "$(dirname "$0")/lib.sh"
PORT=8899; DPM=$(cat /sys/class/drm/card1/device/power_dpm_force_performance_level 2>/dev/null || echo "?")
run() { local label="$1" gguf="$2" tag="$3"
  local cfg; cfg=$(printf '{"model":"%s","format":"GGUF Q4","ctx":%d,"kv_bits":"f16","ub":2048,"batch":8192,"flash_attn":"on","ngl":99,"backend":"ROCm-b1295","mtp":false,"dpm":"%s"}' "$tag" "$CTX" "$DPM")
  echo ">>> $label (ROCm/HIP \$LC)"
  LD_LIBRARY_PATH="$LC" "$LC/llama-server" -m "$gguf" --host 127.0.0.1 --port $PORT -c "$CTX" \
     --flash-attn on -ctk f16 -ctv f16 -ngl 99 -b 8192 -ub 2048 --no-webui > "$HARNESS/log_rocmv_${label}.log" 2>&1 &
  local pid=$!; local g; g=$(start_guard "kill $pid 2>/dev/null" "$HARNESS/guard_rocmv_${label}.log")
  if wait_http "http://127.0.0.1:$PORT/health" 360; then sleep 2
     python3 "$HARNESS/probe.py" llamacpp $PORT "$label" "$cfg" "$RESULTS" || echo "  PROBE FAIL $label"
  else echo "  LOAD FAIL $label"; tail -6 "$HARNESS/log_rocmv_${label}.log"; fi
  kill $pid 2>/dev/null; kill "$g" 2>/dev/null; wait $pid 2>/dev/null; sleep 4
}
echo "### dpm=$DPM, build=$LC ###"; "$LC/llama-server" --version 2>&1 | head -1
run "fin35_rocm" "$GGUF_35B" "35B-A3B"
run "fin27_rocm" "$GGUF_27B" "27B-MTP"
echo "=== rocm verify done ==="

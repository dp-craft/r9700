#!/usr/bin/env bash
# ollama with its experimental Vulkan backend (OLLAMA_VULKAN=1, 0.12.6+). Probes 35B + 27B at
# num_batch 2048 (the ROCm-optimal), KV q8_0, 64K. A/B vs ollama-ROCm.
source "$(dirname "$0")/config.sh"; source "$(dirname "$0")/lib.sh"
pkill -x ollama 2>/dev/null; sleep 2
OLLAMA_VULKAN=1 OLLAMA_FLASH_ATTENTION=1 OLLAMA_KV_CACHE_TYPE=q8_0 OLLAMA_CONTEXT_LENGTH=$CTX \
  OLLAMA_MAX_LOADED_MODELS=1 OLLAMA_NUM_PARALLEL=1 OLLAMA_MODELS="$OLLAMA_MODELS" \
  nohup ollama serve > "$HARNESS/ollama_serve_vulkan.log" 2>&1 &
sleep 3; wait_http "http://127.0.0.1:11434/api/tags" 30
echo "=== vulkan device line in serve log ==="; grep -iE 'vulkan|radv|gfx1201|library' "$HARNESS/ollama_serve_vulkan.log" | head -6

one() { # <label> <ref> <tag>
  local label="$1" ref="$2" tag="$3"
  local cfg
  cfg=$(printf '{"model":"%s","format":"GGUF Q4","ctx":%d,"kv_bits":"q8_0","num_batch":2048,"flash_attn":"on","engine":"ollama","backend":"Vulkan-RADV"}' "$tag" "$CTX")
  echo ">>> ollama-vulkan $label"
  curl -s http://127.0.0.1:11434/api/generate -d "{\"model\":\"$ref\",\"prompt\":\"hi\",\"stream\":false,\"options\":{\"num_predict\":1,\"num_ctx\":$CTX,\"num_batch\":2048}}" >/dev/null
  NUM_BATCH=2048 python3 "$HARNESS/probe.py" ollama "$ref" "$label" "$cfg" "$RESULTS" || echo "  PROBE FAIL $label"
  curl -s http://127.0.0.1:11434/api/generate -d "{\"model\":\"$ref\",\"keep_alive\":0}" >/dev/null
  sleep 3
}
one "ollvk_35B" q35 "35B-A3B"
one "ollvk_27B" q27 "27B-MTP"
pkill -x ollama 2>/dev/null
echo "=== ollama vulkan done ==="

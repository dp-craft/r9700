#!/usr/bin/env bash
# ollama sweep: KV {q8_0,f16} at CTX. Imports the SAME local GGUF files via `ollama create`
# (no re-download), so it benchmarks the identical weights llama.cpp uses.
source "$(dirname "$0")/config.sh"; source "$(dirname "$0")/lib.sh"

start_ollama() { # <kv>
  pkill -f 'ollama serve' 2>/dev/null; sleep 2
  OLLAMA_FLASH_ATTENTION=1 OLLAMA_KV_CACHE_TYPE="$1" OLLAMA_CONTEXT_LENGTH=$CTX \
    OLLAMA_MAX_LOADED_MODELS=1 OLLAMA_NUM_PARALLEL=1 OLLAMA_MODELS="$OLLAMA_MODELS" \
    nohup ollama serve > "$HARNESS/ollama_serve_$1.log" 2>&1 &
  sleep 3; wait_http "http://127.0.0.1:11434/api/tags" 30
}

import_models() {
  printf 'FROM %s\n' "$GGUF_35B" > "$HARNESS/Modelfile_35"
  printf 'FROM %s\n' "$GGUF_27B" > "$HARNESS/Modelfile_27"
  OLLAMA_MODELS="$OLLAMA_MODELS" ollama create q35 -f "$HARNESS/Modelfile_35" >/dev/null 2>&1
  OLLAMA_MODELS="$OLLAMA_MODELS" ollama create q27 -f "$HARNESS/Modelfile_27" >/dev/null 2>&1
  echo "ollama models: $(OLLAMA_MODELS=$OLLAMA_MODELS ollama list 2>/dev/null | awk 'NR>1{print $1}' | tr '\n' ' ')"
}

one() { # <label> <ollama_model> <kv> <model_tag>
  local label="$1" ref="$2" kv="$3" tag="$4"
  local cfg
  cfg=$(printf '{"model":"%s","format":"GGUF Q4","ctx":%d,"kv_bits":"%s","flash_attn":"on","engine":"ollama"}' "$tag" "$CTX" "$kv")
  echo ">>> ollama $label (kv=$kv)"
  curl -s http://127.0.0.1:11434/api/generate -d "{\"model\":\"$ref\",\"prompt\":\"hi\",\"stream\":false,\"options\":{\"num_predict\":1,\"num_ctx\":$CTX}}" >/dev/null
  local g; g=$(start_guard "pkill -f 'ollama serve'" "$HARNESS/guard_oll_${label}.log")
  python3 "$HARNESS/probe.py" ollama "$ref" "$label" "$cfg" "$RESULTS" || echo "  PROBE FAIL $label"
  kill "$g" 2>/dev/null
  curl -s http://127.0.0.1:11434/api/generate -d "{\"model\":\"$ref\",\"keep_alive\":0}" >/dev/null
  sleep 3
}

start_ollama q8_0 || { echo "ollama start failed"; exit 1; }
import_models
for kv in q8_0 f16; do
  start_ollama "$kv" || { echo "ollama restart failed for $kv"; continue; }
  one "oll_35B_${kv}" q35 "$kv" "35B-A3B"
  one "oll_27B_${kv}" q27 "$kv" "27B-MTP"
done
pkill -f 'ollama serve' 2>/dev/null
echo "=== ollama phase done ==="

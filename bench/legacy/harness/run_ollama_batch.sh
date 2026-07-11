#!/usr/bin/env bash
# ollama num_batch sweep. num_batch is ollama's ONLY prefill lever (= llama.cpp -b, default 512;
# no ubatch knob). KV fixed q8_0, FA on, 64K. Tests 512/1024/2048 for 35B + 27B.
# Usage: RESULTS=/path bash run_ollama_batch.sh
source "$(dirname "$0")/config.sh"; source "$(dirname "$0")/lib.sh"
NBS=(${NBS:-512 1024 2048})

start_ollama() {
  pkill -f 'ollama serve' 2>/dev/null; sleep 2
  OLLAMA_FLASH_ATTENTION=1 OLLAMA_KV_CACHE_TYPE=q8_0 OLLAMA_CONTEXT_LENGTH=$CTX \
    OLLAMA_MAX_LOADED_MODELS=1 OLLAMA_NUM_PARALLEL=1 OLLAMA_MODELS="$OLLAMA_MODELS" \
    nohup ollama serve > "$HARNESS/ollama_serve_batch.log" 2>&1 &
  sleep 3; wait_http "http://127.0.0.1:11434/api/tags" 30
}
import() {
  local have
  have=$(OLLAMA_MODELS="$OLLAMA_MODELS" ollama list 2>/dev/null | awk 'NR>1{print $1}')
  if echo "$have" | grep -q '^q35' && echo "$have" | grep -q '^q27'; then
    echo "models q35/q27 already imported; skipping re-create"; return
  fi
  printf 'FROM %s\n' "$GGUF_35B" > "$HARNESS/Modelfile_35"
  printf 'FROM %s\n' "$GGUF_27B" > "$HARNESS/Modelfile_27"
  OLLAMA_MODELS="$OLLAMA_MODELS" ollama create q35 -f "$HARNESS/Modelfile_35" >/dev/null 2>&1
  OLLAMA_MODELS="$OLLAMA_MODELS" ollama create q27 -f "$HARNESS/Modelfile_27" >/dev/null 2>&1
}
one() { # <label> <ref> <nb> <tag>
  local label="$1" ref="$2" nb="$3" tag="$4"
  local cfg
  cfg=$(printf '{"model":"%s","format":"GGUF Q4","ctx":%d,"kv_bits":"q8_0","num_batch":%d,"flash_attn":"on","engine":"ollama","backend":"ROCm"}' "$tag" "$CTX" "$nb")
  echo ">>> ollama $label (num_batch=$nb)"
  # warm/load at this num_batch so the reported eval isn't polluted by a reload
  curl -s http://127.0.0.1:11434/api/generate -d "{\"model\":\"$ref\",\"prompt\":\"hi\",\"stream\":false,\"options\":{\"num_predict\":1,\"num_ctx\":$CTX,\"num_batch\":$nb}}" >/dev/null
  local g; g=$(start_guard "pkill -f 'ollama serve'" "$HARNESS/guard_ollb_${label}.log")
  NUM_BATCH=$nb python3 "$HARNESS/probe.py" ollama "$ref" "$label" "$cfg" "$RESULTS" || echo "  PROBE FAIL $label"
  kill "$g" 2>/dev/null
  curl -s http://127.0.0.1:11434/api/generate -d "{\"model\":\"$ref\",\"keep_alive\":0}" >/dev/null
  sleep 3
}

start_ollama || { echo "ollama start failed"; exit 1; }
import
for nb in "${NBS[@]}"; do
  one "ollb_35B_nb${nb}" q35 "$nb" "35B-A3B"
  one "ollb_27B_nb${nb}" q27 "$nb" "27B-MTP"
done
pkill -f 'ollama serve' 2>/dev/null
echo "=== ollama num_batch sweep done ==="

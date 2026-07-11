#!/usr/bin/env bash
# Clean, monitored ollama re-verify: fresh serve, visible create, nb2048 probe for both models.
source "$(dirname "$0")/config.sh"; source "$(dirname "$0")/lib.sh"
export OLLAMA_MODELS=/home/dev/models-local/ollama
mkdir -p "$OLLAMA_MODELS"
pkill -x ollama 2>/dev/null; sleep 2
OLLAMA_FLASH_ATTENTION=1 OLLAMA_KV_CACHE_TYPE=q8_0 OLLAMA_CONTEXT_LENGTH=$CTX \
  OLLAMA_MAX_LOADED_MODELS=1 OLLAMA_NUM_PARALLEL=1 \
  nohup ollama serve > "$HARNESS/ollama_serve_clean.log" 2>&1 &
sleep 3; wait_http "http://127.0.0.1:11434/api/tags" 30 || { echo "serve failed"; exit 1; }
echo "serve up"

for m in "q35 $GGUF_35B" "q27 $GGUF_27B"; do
  set -- $m; name="$1"; gguf="$2"
  printf 'FROM %s\n' "$gguf" > "$HARNESS/Modelfile_$name"
  echo ">>> creating $name from $gguf"
  t0=$(date +%s)
  timeout 400 ollama create "$name" -f "$HARNESS/Modelfile_$name" 2>&1 | tail -3
  echo "  create rc=${PIPESTATUS[0]} elapsed=$(( $(date +%s) - t0 ))s  blobstore=$(du -sh $OLLAMA_MODELS 2>/dev/null | cut -f1)"
done
echo "=== models ==="; ollama list

one() { local label="$1" ref="$2" nb="$3" tag="$4"
  local cfg; cfg=$(printf '{"model":"%s","format":"GGUF Q4","ctx":%d,"kv_bits":"q8_0","num_batch":%d,"flash_attn":"on","engine":"ollama","backend":"ROCm7.2","dpm":"auto"}' "$tag" "$CTX" "$nb")
  echo ">>> ollama $label (num_batch=$nb)"
  curl -s http://127.0.0.1:11434/api/generate -d "{\"model\":\"$ref\",\"prompt\":\"hi\",\"stream\":false,\"options\":{\"num_predict\":1,\"num_ctx\":$CTX,\"num_batch\":$nb}}" >/dev/null
  NUM_BATCH=$nb python3 "$HARNESS/probe.py" ollama "$ref" "$label" "$cfg" "$RESULTS" || echo "  PROBE FAIL $label"
  curl -s http://127.0.0.1:11434/api/generate -d "{\"model\":\"$ref\",\"keep_alive\":0}" >/dev/null; sleep 3
}
one "ollv2_35B_nb2048" q35 2048 "35B-A3B"
one "ollv2_27B_nb2048" q27 2048 "27B-MTP"
pkill -x ollama 2>/dev/null
echo "=== ollama clean verify done ==="

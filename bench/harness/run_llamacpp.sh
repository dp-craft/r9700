#!/usr/bin/env bash
# llama.cpp sweep: KV {q8_0,f16} × ub {32,64,512} + MTP, at CTX. Same GGUF files as ollama.
source "$(dirname "$0")/config.sh"; source "$(dirname "$0")/lib.sh"
PORT=8899

one() { # <label> <gguf> <kv> <ub> <mtp0|1> <model_tag>
  local label="$1" gguf="$2" kv="$3" ub="$4" mtp="$5" tag="$6"
  local extra="" mtpf=false
  [ "$mtp" = 1 ] && { extra="--spec-type draft-mtp --spec-draft-n-max 3"; mtpf=true; }
  local cfg
  cfg=$(printf '{"model":"%s","format":"GGUF Q4","ctx":%d,"kv_bits":"%s","ub":%d,"batch":2048,"flash_attn":"on","ngl":99,"mtp":%s}' \
        "$tag" "$CTX" "$kv" "$ub" "$mtpf")
  echo ">>> llama.cpp $label (kv=$kv ub=$ub mtp=$mtp)"
  LD_LIBRARY_PATH="$LC" "$LC/llama-server" -m "$gguf" --host 127.0.0.1 --port $PORT \
     -c "$CTX" --flash-attn on -ctk "$kv" -ctv "$kv" -ngl 99 -b 2048 -ub "$ub" -fit off --no-webui $extra \
     > "$HARNESS/log_ll_${label}.log" 2>&1 &
  local pid=$!
  local g; g=$(start_guard "kill $pid 2>/dev/null" "$HARNESS/guard_ll_${label}.log")
  if wait_http "http://127.0.0.1:$PORT/health" 360; then
     sleep 2
     python3 "$HARNESS/probe.py" llamacpp $PORT "$label" "$cfg" "$RESULTS" || echo "  PROBE FAIL $label"
  else
     echo "{\"runtime\":\"llamacpp\",\"label\":\"$label\",\"status\":\"LOAD_FAIL\",$(echo "$cfg"|sed 's/^{//')" >> "$RESULTS"
     echo "  LOAD FAIL/timeout $label"; tail -4 "$HARNESS/log_ll_${label}.log"
  fi
  kill $pid 2>/dev/null; kill "$g" 2>/dev/null; wait $pid 2>/dev/null; sleep 4
}

# ── 35B-A3B (HauhauCS blob — identical file used by ollama) ──
one "ll_35B_q8_ub32"  "$GGUF_35B" q8_0 32  0 "35B-A3B"
one "ll_35B_q8_ub64"  "$GGUF_35B" q8_0 64  0 "35B-A3B"
one "ll_35B_q8_ub512" "$GGUF_35B" q8_0 512 0 "35B-A3B"
one "ll_35B_f16_ub64" "$GGUF_35B" f16  64  0 "35B-A3B"
# ── 27B-MTP (unsloth blob — identical file used by ollama; MTP-capable) ──
one "ll_27B_q8_ub32"  "$GGUF_27B" q8_0 32  0 "27B-MTP"
one "ll_27B_q8_ub64"  "$GGUF_27B" q8_0 64  0 "27B-MTP"
one "ll_27B_q8_ub512" "$GGUF_27B" q8_0 512 0 "27B-MTP"
one "ll_27B_f16_ub64" "$GGUF_27B" f16  64  0 "27B-MTP"
one "ll_27B_q8_mtp"   "$GGUF_27B" q8_0 64  1 "27B-MTP"
echo "=== llama.cpp phase done ==="

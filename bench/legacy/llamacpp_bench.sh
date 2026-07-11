#!/usr/bin/env bash
# llama.cpp (lemonade gfx120X build) benchmark az R9700-on.
# Ugyanazt a coding promptot méri MTP nélkül és MTP-vel (--spec-type draft-mtp).
set -u
T="$(readlink -f /home/dev/.ollama)"
LC="$T/gguf-bench/llamacpp"
MODEL="${MODEL:-$T/models/blobs/sha256-a5ef62184c1729c38c9565b502303ac88e2fad3b1c3c6aa430d9e273bdd7f917}"
PORT=8899
NUM_CTX=${NUM_CTX:-102400}
NPRED=${NPRED:-256}
OUT=${OUT:-/home/dev/work/dippe/amd/bench/llamacpp_results.jsonl}
: > "$OUT"
export LD_LIBRARY_PATH="$LC"
PROMPT='Write a production-quality Python function merge_intervals(intervals) that merges overlapping intervals. Include type hints and a docstring. Output only the code.'

run_case () {
  local label="$1"; shift
  echo "### $label"
  "$LC/llama-server" -m "$MODEL" --host 127.0.0.1 --port $PORT \
    -c $NUM_CTX --flash-attn on -ctk q8_0 -ctv q8_0 -ngl 99 \
    --no-webui "$@" > "/tmp/lls_${label}.log" 2>&1 &
  local pid=$!
  # várunk a health-re (max 180s: nagy modell + KV alloc)
  for i in $(seq 1 90); do
    sleep 2
    curl -s "http://127.0.0.1:$PORT/health" 2>/dev/null | grep -q '"status":"ok"' && break
    kill -0 $pid 2>/dev/null || { echo "  SZERVER KILÉPETT"; tail -5 "/tmp/lls_${label}.log"; return; }
  done
  # completion + timings
  local resp=$(curl -s --max-time 180 "http://127.0.0.1:$PORT/completion" \
    -d "{\"prompt\":\"$PROMPT\",\"n_predict\":$NPRED,\"temperature\":0.2,\"cache_prompt\":false}")
  echo "$resp" | python3 -c "
import sys,json
d=json.load(sys.stdin)
t=d.get('timings',{})
rec={'runtime':'llama.cpp','case':'$label',
     'prefill_tok_s':round(t.get('prompt_per_second',0),1),
     'decode_tok_s':round(t.get('predicted_per_second',0),1),
     'gen_toks':t.get('predicted_n',0),
     'draft_accept':t.get('draft_n_accepted'),'draft_n':t.get('draft_n')}
print('  prefill: %6.1f tok/s | decode: %6.1f tok/s | gen: %d' % (rec['prefill_tok_s'],rec['decode_tok_s'],rec['gen_toks']))
if rec['draft_n']: print('  MTP draft: accepted %s / %s' % (rec['draft_accept'],rec['draft_n']))
open('$OUT','a').write(json.dumps(rec)+'\n')
" 2>&1
  kill $pid 2>/dev/null; wait $pid 2>/dev/null; sleep 3
}

run_case "baseline_no_mtp"
run_case "mtp" --spec-type draft-mtp --spec-draft-n-max 3
echo "### KÉSZ -> $OUT"

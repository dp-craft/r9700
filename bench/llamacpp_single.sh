#!/usr/bin/env bash
# llama.cpp decode-mérés több GGUF-ra (baseline, MTP nélkül). Logok a nagy lemezre.
set -u
T="$(readlink -f /home/dev/.ollama)"; LC="$T/gguf-bench/llamacpp"
LOGDIR="$T/gguf-bench/logs"; mkdir -p "$LOGDIR"
export LD_LIBRARY_PATH="$LC"
PORT=8899; NUM_CTX=${NUM_CTX:-102400}; NPRED=${NPRED:-256}
OUT=/home/dev/work/dippe/amd/bench/llamacpp_results.jsonl
PROMPT='Write a production-quality Python function merge_intervals(intervals) that merges overlapping intervals. Include type hints and a docstring. Output only the code.'

# argumentumok: LABEL=BLOB párok
while (($#)); do
  LABEL="$1"; BLOB="$2"; shift 2
  echo "### $LABEL"
  "$LC/llama-server" -m "$BLOB" --host 127.0.0.1 --port $PORT \
    -c $NUM_CTX --flash-attn on -ctk q8_0 -ctv q8_0 -ngl 99 --no-webui \
    > "$LOGDIR/${LABEL}.log" 2>&1 &
  pid=$!
  ok=0
  for i in $(seq 1 120); do
    sleep 2
    curl -s "http://127.0.0.1:$PORT/health" 2>/dev/null | grep -q '"status":"ok"' && { ok=1; break; }
    kill -0 $pid 2>/dev/null || { echo "  SZERVER KILÉPETT"; tail -4 "$LOGDIR/${LABEL}.log"; break; }
  done
  if [ "$ok" = 1 ]; then
    resp=$(curl -s --max-time 180 "http://127.0.0.1:$PORT/completion" \
      -d "{\"prompt\":\"$PROMPT\",\"n_predict\":$NPRED,\"temperature\":0.2,\"cache_prompt\":false}")
    echo "$resp" | python3 -c "
import sys,json
d=json.load(sys.stdin); t=d.get('timings',{})
print('  decode: %6.1f tok/s | prefill: %6.1f | gen %d' % (round(t.get('predicted_per_second',0),1),round(t.get('prompt_per_second',0),1),t.get('predicted_n',0)))
open('$OUT','a').write(json.dumps({'runtime':'llama.cpp','case':'$LABEL','decode_tok_s':round(t.get('predicted_per_second',0),1),'prefill_tok_s':round(t.get('prompt_per_second',0),1),'gen_toks':t.get('predicted_n',0)})+'\n')
"
  fi
  kill $pid 2>/dev/null; wait $pid 2>/dev/null; sleep 3
done
echo "### KÉSZ"

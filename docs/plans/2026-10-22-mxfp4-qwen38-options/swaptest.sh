#!/bin/bash
# swaptest.sh MODEL_ID [LABEL]
#   Send the 5 fault-repro prompts through llama-swap (:9292, Anthropic /v1/messages) to MODEL_ID,
#   one after another (they share a prefix; see vllmtest.sh header). Works for any llama-swap row (llama.cpp or vLLM). Prints
#   [LABEL] RESULT PASS|FAULT@pN|HTTP_FAIL@pN  and appends to results.tsv. Unloads llama-swap at the end.
#   A hung GPU (memory fault -> /health still ok) shows up as a curl timeout (900 s) or a
#   MEMORY_FAULT / "Memory access fault" / ErrorDeviceLost line in llama-swap's upstream log.
set -u
H=$(cd "$(dirname "$0")" && pwd)
id=$1; label=${2:-$id}; LOG=$H/logs/$label; mkdir -p "$H/logs"
FAULT_RE='MEMORY_FAULT|Memory access fault|ErrorDeviceLost|EngineDeadError'
res=PASS; times=""
for i in 0 1 2 3 4; do
  python3 -c "import json;d=json.load(open('$H/fixtures/p$i.json'));d['model']='$id';json.dump(d,open('$LOG.req.json','w'))"
  curl -s -m 900 http://127.0.0.1:9292/v1/messages -H 'content-type: application/json' -H 'anthropic-version: 2023-06-01' \
    -d @"$LOG.req.json" -o "$LOG.p$i.out" -w "%{http_code} %{time_total}" > "$LOG.p$i.code"
  read code t < "$LOG.p$i.code"
  if [ "$code" != 200 ]; then
    curl -s -m 3 http://127.0.0.1:9292/logs/stream/upstream > "$LOG.swap.log" 2>/dev/null
    grep -qE "$FAULT_RE" "$LOG.swap.log" && res="FAULT@p$i" || res="HTTP_FAIL@p$i($code)"; break
  fi
  times="$times p$i=${t%.*}s"
done
curl -s http://127.0.0.1:9292/unload >/dev/null
echo "[$label] RESULT $res $times"
printf "%s\t%s\t%s\t%s\t%s\n" "$(date +%F_%T)" "$label" "llama-swap $id" "$res" "$times" >> "$H/results.tsv"

#!/bin/bash
# vllmtest.sh LABEL PROFILE [ENV=VAL ...]
#   Boot a serve_vllm.sh profile on :8000 (ctx 150000, 1 seq, KV_DTYPE default fp8), send 
#   the 5 fault-repro prompts (fixtures/p0..p4.json). They SHARE a prefix: identical system prompt + run-id, and the corpus is cut at
#   100k/60k/80k/120k/140k chars of the same text, so p1/p2 are prefix-cache hits on p0, and p3/p4 each prefill only ~20k new chars
#   (~5k tokens) on top of a cached ~30k-token prefix -- the incremental agentic pattern, not cold prompts,
#   one after another, stop on the
#   first GPU memory fault. Prints one line:  [LABEL] RESULT PASS|FAULT@pN|BOOT_FAILED|HTTP_FAIL@pN
#   ENV=VAL pairs are appended to the profile's MODEL_ENV (container env) via a temp profile.
#   Knobs (env on the command line): IMAGE, KV_DTYPE, MAXLEN, MAXSEQS, GPU_UTIL, EXTRA_ARGS -- passed to serve_vllm.sh.
#   ROUNDS=N (default 1): send p0..p4 N times in the same boot; rounds >1 get a fresh run-id prefix so the
#   prefix cache cannot serve them from round 1 (round N repeats the same shared-prefix pattern). ROUNDS=2 = 10 requests per boot.
#   VLLM_DISABLE_COMPILE_CACHE=1 is ALWAYS added: the AOT compile cache is NOT keyed on RADIANCE_*
#   env vars, so without it a boot reuses a graph built for different settings (seen 2026-10-22:
#   KeyError 'radiance_wref' after flipping RADIANCE_MXFP4_W4A8).
#   Results append to results.tsv next to this script. Kills only its own container (vllm-8000).
set -u
H=$(cd "$(dirname "$0")" && pwd)
VD=/home/dev/work/dp-craft/amd/bench/engine-bench/vllm
label=$1; prof=$2; shift 2
eng=${prof%%/*}; P=$VD/profiles/$eng
tmp=_vt_$label
{ echo "source \"\$(dirname \"\${BASH_SOURCE[0]}\")/${prof#*/}.env\""
  echo 'MODEL_ENV+=("VLLM_DISABLE_COMPILE_CACHE=1")'
  for e in "$@"; do echo "MODEL_ENV+=(\"$e\")"; done; } > "$P/$tmp.env"
LOG=$H/logs/$label; mkdir -p "$H/logs"
cleanup() { PORT=8000 "$VD/serve_vllm.sh" stop >/dev/null 2>&1; rm -f "$P/$tmp.env"; }
trap cleanup EXIT
curl -s http://127.0.0.1:9292/unload >/dev/null; sleep 3          # llama-swap: GET, not POST
t0=$(date +%s)
PROFILE=$eng/$tmp PORT=8000 MAXLEN=${MAXLEN:-150000} MAXSEQS=${MAXSEQS:-1} KV_DTYPE=${KV_DTYPE:-fp8} \
  "$VD/serve_vllm.sh" start > "$LOG.boot" 2>&1
if [ $? -ne 0 ]; then
  docker logs vllm-8000 > "$LOG.server" 2>&1
  res=BOOT_FAILED; why=$(grep -E "Error|error:" "$LOG.boot" "$LOG.server" 2>/dev/null | grep -v '  File' | tail -1 | cut -c1-160)
  echo "[$label] RESULT $res  ($why)"; printf "%s\t%s\t%s\t%s\t%s\n" "$(date +%F_%T)" "$label" "$prof $*" "$res" "$why" >> "$H/results.tsv"; exit 1
fi
boot=$(( $(date +%s) - t0 ))
served=$(curl -s http://127.0.0.1:8000/v1/models | python3 -c 'import json,sys;print(json.load(sys.stdin)["data"][0]["id"])')
echo "[$label] up after ${boot}s, served=$served, env: $*"
res=PASS; times=""
for r in $(seq 1 ${ROUNDS:-1}); do
for i in 0 1 2 3 4; do
  python3 -c "import json,re,secrets;t=open('$H/fixtures/p$i.json').read()
if $r>1: t=re.sub(r'run-id [0-9a-f]+','run-id '+secrets.token_hex(6),t)
d=json.loads(t);d['model']='$served';json.dump(d,open('$LOG.req.json','w'))"
  curl -s -m 900 http://127.0.0.1:8000/v1/messages -H 'content-type: application/json' -H 'anthropic-version: 2023-06-01' \
    -d @"$LOG.req.json" -o "$LOG.p$i.out" -w "%{http_code} %{time_total}" > "$LOG.p$i.code" &
  cpid=$!
  while kill -0 $cpid 2>/dev/null; do
    docker logs vllm-8000 2>&1 | grep -q MEMORY_FAULT && { kill $cpid 2>/dev/null; res="FAULT@r${r}p$i"; break; }
    sleep 2
  done
  wait $cpid 2>/dev/null
  [ "$res" = PASS ] || break
  read code t < "$LOG.p$i.code"; times="$times r${r}p$i=${t%.*}s"
  [ "$code" = 200 ] || { res="HTTP_FAIL@r${r}p$i($code)"; break; }
done
[ "$res" = PASS ] || break
done
docker logs vllm-8000 > "$LOG.server" 2>&1
kern=$(grep -oE 'kernel: void [a-z0-9_]+' "$LOG.server" | head -1)
echo "[$label] RESULT $res  boot=${boot}s $times $kern"
printf "%s\t%s\t%s\t%s\t%s\n" "$(date +%F_%T)" "$label" "$prof $* GPU_UTIL=${GPU_UTIL:-0.90} EXTRA_ARGS=${EXTRA_ARGS:-} IMAGE=${IMAGE:-default} ROUNDS=${ROUNDS:-1}" "$res" "boot=${boot}s$times $kern" >> "$H/results.tsv"

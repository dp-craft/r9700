#!/bin/bash
# warm_start.sh -- `serve_vllm.sh start`, then replay real Claude Code first requests (warmup/claude-first/*.json)
# and REBOOT the container if the GPU faults; repeat up to WARM_TRIES (default 5). Same env as serve_vllm.sh
# (PROFILE PORT MAXLEN ...). Exit 0 = a server that survived the warmup is up; non-zero = gave up.
# Why (2026-10-22, Sly radiance 1.5.1/1.6.0 MXFP4 W4A8): the prefill GEMM faults on the down_proj weight
# address with bit 44 cleared -- a per-boot buffer-placement bug, ~50% of boots, always on the FIRST real
# request. Every boot that survived its first request stayed clean, so a faulting boot is thrown away
# before anyone uses it. Each try costs one boot (~2.5 min) + one ~30k-token prefill.
set -u
VD=$(cd "$(dirname "$0")" && pwd)
PORT=${PORT:-8000}; NAME=${CONTAINER_NAME:-vllm-$PORT}; TRIES=${WARM_TRIES:-5}
REQS=("$VD"/warmup/claude-first/*.json)
[ -f "${REQS[0]}" ] || { echo "warm_start: no warmup requests in $VD/warmup/claude-first" >&2; exit 2; }
for t in $(seq 1 "$TRIES"); do
  "$VD/serve_vllm.sh" start || exit $?
  served=$(curl -s "http://127.0.0.1:$PORT/v1/models" | python3 -c 'import json,sys;print(json.load(sys.stdin)["data"][0]["id"])')
  ok=1
  for r in "${REQS[@]}"; do
    python3 -c 'import json,sys;d=json.load(open(sys.argv[1]));d["model"]=sys.argv[2];d["max_tokens"]=32;d["stream"]=False;d.pop("thinking",None);json.dump(d,sys.stdout)' \
      "$r" "$served" > "/tmp/warm-$PORT.json"
    curl -s -m 600 "http://127.0.0.1:$PORT/v1/messages" -H 'content-type: application/json' -H 'anthropic-version: 2023-06-01' \
      -d @"/tmp/warm-$PORT.json" -o /dev/null -w '%{http_code}' > "/tmp/warm-$PORT.code" & cp=$!
    while kill -0 $cp 2>/dev/null; do
      docker logs "$NAME" 2>&1 | grep -q MEMORY_FAULT && { kill $cp 2>/dev/null; ok=0; break; }
      sleep 2
    done
    wait $cp 2>/dev/null
    [ $ok = 1 ] && [ "$(cat "/tmp/warm-$PORT.code")" != 200 ] && { echo "warm_start: warmup HTTP $(cat "/tmp/warm-$PORT.code")" >&2; ok=0; }
    [ $ok = 1 ] || break
  done
  rm -f "/tmp/warm-$PORT.json" "/tmp/warm-$PORT.code"
  if [ $ok = 1 ]; then echo "warm_start: OK after $t boot(s)"; exit 0; fi
  echo "warm_start: boot $t faulted/failed in warmup -> rebooting" >&2
  "$VD/serve_vllm.sh" stop >/dev/null 2>&1
done
echo "warm_start: gave up after $TRIES boots" >&2; exit 1

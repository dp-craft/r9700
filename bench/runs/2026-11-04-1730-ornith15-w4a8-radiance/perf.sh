#!/usr/bin/env bash
# Ornith-1.5-35B-A3B w4a8 on native Radiance 1.16.0, one card, creator's flags (radiance-ornith.start.sh).
# Same probe as bench/runs/2026-11-04-1557-35b-perf-10k-50k-100k so the numbers compare. Leaves the server UP on port 8000.
set -u
REPO=/home/dev/work/dp-craft/amd; RUN="$(cd "$(dirname "$0")" && pwd)"; PORT=8000; GEN=$REPO/bench/workloads/generated
START=$REPO/radiance-ornith.start.sh; U=http://127.0.0.1:$PORT
d=$RUN/ornith15-w4a8; mkdir -p "$d"; rm -f "$d"/*.jsonl
python3 $REPO/bench/lib/vram_sampler.py --out "$d/gpu_samples.csv" --interval 1 >/dev/null 2>&1 & S=$!
# host side: swap in use, then per-second si/so (swap), bi/bo (disk), free/cache, with timestamps
{ swapon --show; free -m; } >"$d/host_before.txt" 2>&1
vmstat -n -t -S M 1 >"$d/vmstat.txt" 2>&1 & V=$!
PORT=$PORT "$START" start </dev/null >"$d/start.txt" 2>&1; rc=$?
echo "boot_rc=$rc" | tee -a "$RUN/progress.txt"
if [ "$rc" = 0 ]; then
  served=$(curl -sf -m 5 "$U/v1/models" | python3 -c 'import json,sys;print(json.load(sys.stdin)["data"][0]["id"])'); echo "served=$served" >>"$d/start.txt"
  w=1
  for n in 10000 50000 100000; do
    python3 $REPO/bench/lib/capture_engine.py probe --url "$U/v1" --model "$served" \
      --prompt-file "$GEN/codereview-$n.txt" --max-tokens 256 --temperature 1.0 --concurrency 1 --reps 3 --warmup $w \
      --prefix-mode unique --api chat --engine radiance --label "ornith15-w4a8-$n" --timeout 1500 >>"$d/results.jsonl" 2>>"$d/probe.err"
    echo "$n probe_rc=$? rows=$(wc -l <"$d/results.jsonl")" | tee -a "$RUN/progress.txt"; w=0
  done
  curl -s -m 600 "$U/v1/chat/completions" -H 'content-type: application/json' -d "{\"model\":\"$served\",\"messages\":[{\"role\":\"user\",\"content\":\"What is 17*23? Then write a one-line Python function that reverses a string.\"}],\"max_tokens\":3000,\"temperature\":0.2}" >"$d/sanity.json"
  curl -s -m 600 "$U/v1/chat/completions" -H 'content-type: application/json' -d "{\"model\":\"$served\",\"messages\":[{\"role\":\"user\",\"content\":\"Read the file src/main.py using the tool.\"}],\"max_tokens\":3000,\"temperature\":0.2,\"tools\":[{\"type\":\"function\",\"function\":{\"name\":\"read_file\",\"description\":\"Read a file\",\"parameters\":{\"type\":\"object\",\"properties\":{\"path\":{\"type\":\"string\"}},\"required\":[\"path\"]}}}]}" >"$d/toolcall.json"
  curl -s -m 5 "$U/metrics" >"$d/metrics.txt"; curl -s -m 5 "$U/stats" >"$d/stats.json"
fi
kill $S $V 2>/dev/null; wait $S $V 2>/dev/null
{ swapon --show; free -m; grep -E "^(Mlocked|Unevictable|Shmem):" /proc/meminfo; } >"$d/host_after.txt" 2>&1
docker logs radiance-$PORT >"$d/server.log" 2>&1
docker inspect radiance-$PORT --format '{{.Config.Image}} {{.Image}} {{json .Args}}' >"$d/cmdline.txt" 2>&1
echo DONE | tee -a "$RUN/progress.txt"

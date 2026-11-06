#!/usr/bin/env bash
# Sly baseline on the SAME probe as campaigns/perf/2026-11-04-1527-ornith15-radiance-vs-sly/results/2026-11-04-1730-ornith15-w4a8-radiance and 2026-11-04-1557-35b-perf-10k-50k-100k:
# RedHatAI Qwen3.8-27B MXFP4 + DFlash2 k=7 (profile sly-redhat/redhat-mxfp4-dflash), same launcher env as vllm-35b.start.sh.
# Sly cannot load the Ornith .rad (docs/guides/vllm/known-issues.md), so the 27B is the Sly measurement this run adds.
set -u
REPO=/home/dev/work/dp-craft/amd; RUN="$(cd "$(dirname "$0")" && pwd)"
SERVE=$REPO/stack/serve/vllm/serve_vllm.sh; PORT=8010; GEN=$REPO/bench/workloads/tmp; U=http://127.0.0.1:$PORT
d=$RUN/sly-27b-dflash; mkdir -p "$d"; rm -f "$REPO/stack/serve/var/servers/$PORT.log"
python3 $REPO/stack/gpu/vram_sampler.py --out "$d/gpu_samples.csv" --interval 1 >/dev/null 2>&1 & S=$!
{ swapon --show; free -m; } >"$d/host_before.txt" 2>&1
vmstat -n -t -S M 1 >"$d/vmstat.txt" 2>&1 & V=$!
PROFILE=sly-redhat/redhat-mxfp4-dflash PORT=$PORT MAXLEN=262000 MAXSEQS=1 KV_DTYPE=fp8 WATCHDOG_MIB=32 GPU_UTIL=0.93 CACTUS_DELTA=0 WAIT=1200 CHAT_TEMPLATE=/home/dev/work/dp-craft/amd/stack/serve/vllm/templates/dp-sharp-chat_template.jinja \
  "$SERVE" start </dev/null >"$d/start.txt" 2>&1; rc=$?
echo "boot_rc=$rc" | tee -a "$RUN/progress.txt"
if [ "$rc" = 0 ]; then
  served=$(curl -sf -m 5 "$U/v1/models" | python3 -c 'import json,sys;print(json.load(sys.stdin)["data"][0]["id"])')
  w=1
  for n in 10000 50000 100000; do
    python3 $REPO/bench/core/capture_engine.py probe --url "$U/v1" --model "$served" \
      --prompt-file "$GEN/codereview-$n.txt" --max-tokens 256 --temperature 1.0 --concurrency 1 --reps 3 --warmup $w \
      --prefix-mode unique --api chat --engine vllm --label "sly-27b-dflash-$n" --timeout 1500 >>"$d/results.jsonl" 2>>"$d/probe.err"
    echo "$n probe_rc=$? rows=$(wc -l <"$d/results.jsonl")" | tee -a "$RUN/progress.txt"; w=0
  done
  curl -s -m 600 "$U/v1/chat/completions" -H 'content-type: application/json' -d "{\"model\":\"$served\",\"messages\":[{\"role\":\"user\",\"content\":\"What is 17*23? Then write a one-line Python function that reverses a string.\"}],\"max_tokens\":3000,\"temperature\":0.2}" >"$d/sanity.json"
  curl -s -m 5 "$U/metrics" | grep -E 'spec_decode_num_(drafts|draft_tokens|accepted_tokens)_total|prompt_tokens_(total|cached_total)|prefix_cache_(hits|queries)_total' | grep -v '^#' | sed -E 's/\{[^}]*\}//' >"$d/spec.txt"
  docker logs vllm-$PORT 2>&1 | grep -E 'MEMORY_FAULT|Memory Fault|Traceback' | grep -vc triton_bundler | sed 's/^/non_bundler_fault_lines=/' >>"$d/spec.txt"
fi
PORT=$PORT "$SERVE" stop >/dev/null 2>&1
kill $S $V 2>/dev/null; wait $S $V 2>/dev/null
{ swapon --show; free -m; } >"$d/host_after.txt" 2>&1
cp "$REPO/stack/serve/var/servers/$PORT.log" "$d/server.log" 2>/dev/null; cp "$REPO/stack/serve/var/servers/$PORT.cmdline" "$d/cmdline.txt" 2>/dev/null
echo DONE | tee -a "$RUN/progress.txt"

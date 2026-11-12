#!/usr/bin/env bash
# Cold-prefill performance at 10k / 50k / 100k for the 35B (prefill, decode, TTFT, total) via capture_engine probe.
# Same settings as vllm-35b.start.sh. prefix-mode unique = every request misses the prefix cache, so prefill is the
# whole prompt. One untimed warm-up at the first depth so kernel JIT is excluded.
set -u
REPO=/home/dev/work/dp-craft/amd; RUN="$(cd "$(dirname "$0")" && pwd)"
SERVE=$REPO/stack/serve/vllm/serve_vllm.sh; PORT=8010; GEN=$REPO/bench/workloads/tmp
arm() {  # arm <label> <profile>
  local label=$1 profile=$2 d=$RUN/$1; mkdir -p "$d"; rm -f "$REPO/stack/serve/var/servers/$PORT.log"
  python3 $REPO/stack/gpu/vram_sampler.py --out "$d/gpu_samples.csv" --interval 1 >/dev/null 2>&1 & local S=$!
  env PROFILE=$profile PORT=$PORT MAXLEN=262000 MAXSEQS=1 KV_DTYPE=fp8 WATCHDOG_MIB=32 GPU_UTIL=0.93 CACTUS_DELTA=0 WAIT=1200 \
    "$SERVE" start </dev/null >"$d/start.txt" 2>&1; local rc=$?
  echo "$label boot_rc=$rc" | tee -a "$RUN/progress2.txt"
  if [ "$rc" = 0 ]; then
    local served w=1; served=$(curl -sf -m 5 "http://127.0.0.1:$PORT/v1/models" | python3 -c 'import json,sys;print(json.load(sys.stdin)["data"][0]["id"])')
    for n in 10000 50000 100000; do
      python3 $REPO/bench/core/capture_engine.py probe --url "http://127.0.0.1:$PORT/v1" --model "$served" \
        --prompt-file "$GEN/codereview-$n.txt" --max-tokens 256 --temperature 1.0 --concurrency 1 --reps 3 --warmup $w \
        --prefix-mode unique --api chat --engine vllm --label "$label-$n" --timeout 1500 >>"$d/results.jsonl" 2>>"$d/probe.err"
      echo "$label $n probe_rc=$? rows=$(wc -l <"$d/results.jsonl")" | tee -a "$RUN/progress2.txt"; w=0
    done
    curl -s -m 5 "http://127.0.0.1:$PORT/metrics" | grep -E 'spec_decode_num_(drafts|draft_tokens|accepted_tokens)_total|prompt_tokens_(total|cached_total)|prefix_cache_(hits|queries)_total' | grep -v '^#' | sed -E 's/\{[^}]*\}//' >"$d/spec.txt"
    docker logs vllm-$PORT 2>&1 | grep -E 'MEMORY_FAULT|Memory Fault|Traceback' | grep -vc triton_bundler | sed 's/^/non_bundler_fault_lines=/' >>"$d/spec.txt"
  fi
  PORT=$PORT "$SERVE" stop >/dev/null 2>&1
  kill $S 2>/dev/null; wait $S 2>/dev/null
  cp "$REPO/stack/serve/var/servers/$PORT.log" "$d/server.log" 2>/dev/null; cp "$REPO/stack/serve/var/servers/$PORT.cmdline" "$d/cmdline.txt" 2>/dev/null
}
arm mtp-k4 sly-amd/qwen35-35b-a3b-mxfp4-mtp
arm nospec sly-amd/qwen35-35b-a3b-mxfp4
echo DONE | tee -a "$RUN/progress2.txt"

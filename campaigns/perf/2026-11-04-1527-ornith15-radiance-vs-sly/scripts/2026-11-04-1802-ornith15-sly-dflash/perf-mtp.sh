#!/usr/bin/env bash
# Ornith 1.5 MXFP4 on Sly with the model's own MTP head at K=3: the same drafter type and K as the native Radiance run,
# every other setting as perf.sh. Separate file because perf.sh was still running when this arm was requested (iron rule 14).
# The graph-capture lines are saved because the earlier 35B MTP arm captured 0 graphs and so was not a valid test.
# Backend differs from perf.sh by necessity: triton_unfused FAILED at load (ornith-mtp-k3-s8-FAILED-unfused) because this
# checkpoint's MTP-layer experts are unquantized and oracle/unquantized.py rejects it. triton and aiter are the only
# ROCm-capable backends both the MXFP4 and the unquantized selectors accept.
set -u
REPO=/home/dev/work/dp-craft/amd; RUN="$(cd "$(dirname "$0")" && pwd)"
SERVE=$REPO/stack/serve/vllm/serve_vllm.sh; PORT=8010; GEN=$REPO/bench/workloads/tmp; U=http://127.0.0.1:$PORT
M=/mnt/Lin1/work/vllm/sly-radiance/models
XA='--max-num-batched-tokens 2048 --override-generation-config {"temperature":1.0,"top_p":0.95,"top_k":20,"min_p":0.0,"presence_penalty":1.5}'

arm() {  # arm <label> <moe-backend>; returns the boot rc
  local label=$1 moe=$2 seqs=8 d=$RUN/$1 rc served w=1 n; mkdir -p "$d"; rm -f "$REPO/stack/serve/var/servers/$PORT.log"
  python3 $REPO/stack/gpu/vram_sampler.py --out "$d/gpu_samples.csv" --interval 1 >/dev/null 2>&1 & local S=$!
  { swapon --show; free -m; } >"$d/host_before.txt" 2>&1
  vmstat -n -t -S M 1 >"$d/vmstat.txt" 2>&1 & local V=$!
  PROFILE=sly-amd/qwen35-35b-a3b-mxfp4-mtp PORT=$PORT \
    MODEL_DIR=$M/Capicua25x__Ornith-1.5-35B-A3B-MXFP4-Quark-RDNA4@9e488f46 SERVED_NAME=ornith15-mxfp4-mtp \
    SPEC_K=3 MAXLEN=262144 MAXSEQS=$seqs KV_DTYPE=fp8 WATCHDOG_MIB=32 GPU_UTIL=0.93 CACTUS_DELTA=0 WAIT=600 EXTRA_ARGS="--moe-backend $moe $XA" \
    "$SERVE" start </dev/null >"$d/start.txt" 2>&1; rc=$?
  echo "$label boot_rc=$rc" | tee -a "$RUN/progress-mtp.txt"
  if [ "$rc" = 0 ]; then
    docker logs vllm-$PORT 2>&1 | tr '\r' '\n' | grep -E 'Capturing CUDA graphs' | tail -1 | cut -c1-120 >"$d/graphs.txt"
    served=$(curl -sf -m 5 "$U/v1/models" | python3 -c 'import json,sys;print(json.load(sys.stdin)["data"][0]["id"])')
    for n in 10000 50000 100000; do
      python3 $REPO/bench/core/capture_engine.py probe --url "$U/v1" --model "$served" \
        --prompt-file "$GEN/codereview-$n.txt" --max-tokens 256 --temperature 1.0 --concurrency 1 --reps 3 --warmup $w \
        --prefix-mode unique --api chat --engine vllm --label "$label-$n" --timeout 600 >>"$d/results.jsonl" 2>>"$d/probe.err"
      echo "$label $n probe_rc=$? rows=$(wc -l <"$d/results.jsonl")" | tee -a "$RUN/progress-mtp.txt"; w=0
    done
    curl -s -m 600 "$U/v1/chat/completions" -H 'content-type: application/json' -d "{\"model\":\"$served\",\"messages\":[{\"role\":\"user\",\"content\":\"What is 17*23? Then write a one-line Python function that reverses a string.\"}],\"max_tokens\":3000,\"temperature\":0.2}" >"$d/sanity.json"
    curl -s -m 600 "$U/v1/chat/completions" -H 'content-type: application/json' -d "{\"model\":\"$served\",\"messages\":[{\"role\":\"user\",\"content\":\"Read the file src/main.py using the tool.\"}],\"max_tokens\":3000,\"temperature\":0.2,\"tools\":[{\"type\":\"function\",\"function\":{\"name\":\"read_file\",\"description\":\"Read a file\",\"parameters\":{\"type\":\"object\",\"properties\":{\"path\":{\"type\":\"string\"}},\"required\":[\"path\"]}}}]}" >"$d/toolcall.json"
    curl -s -m 5 "$U/metrics" | grep -E 'spec_decode_num_(drafts|draft_tokens|accepted_tokens)_total|prompt_tokens_(total|cached_total)|prefix_cache_(hits|queries)_total' | grep -v '^#' | sed -E 's/\{[^}]*\}//' >"$d/spec.txt"
    docker logs vllm-$PORT 2>&1 | grep -E 'MEMORY_FAULT|Memory Fault|Traceback' | grep -vc triton_bundler | sed 's/^/non_bundler_fault_lines=/' >>"$d/spec.txt"
  fi
  PORT=$PORT "$SERVE" stop >/dev/null 2>&1
  kill $S $V 2>/dev/null; wait $S $V 2>/dev/null
  { swapon --show; free -m; } >"$d/host_after.txt" 2>&1
  cp "$REPO/stack/serve/var/servers/$PORT.log" "$d/server.log" 2>/dev/null; cp "$REPO/stack/serve/var/servers/$PORT.cmdline" "$d/cmdline.txt" 2>/dev/null
  return "$rc"
}

arm ornith-mtp-k3-triton triton || arm ornith-mtp-k3-aiter aiter
echo DONE | tee -a "$RUN/progress-mtp.txt"

#!/usr/bin/env bash
# Ornith 1.5 on Sly with settings as near as Sly allows to the creator's native Radiance config, on the SAME probe as
# bench/runs/2026-11-04-1730-ornith15-w4a8-radiance, 2026-11-04-1740-27b-sly-baseline and 2026-11-04-1557-35b-perf-10k-50k-100k.
# Sly cannot load the .rad, so weights = Capicua25x Quark MXFP4 (not the .rad's gptq w4 experts + fp8 attention).
# Drafter = official ornith-ai DFlash. Radiance's MTP K=3 is replaced by DFlash at the same K=3.
# Matched to Radiance: K=3, 8 seqs, batched tokens 2048, ctx 262144, fp8 KV, temp 1.0, top_p 0.95, top_k 20, presence 1.5.
# Sly-specific and unchanged: R4D_HYBRID attention, triton_unfused MoE (the card's gfx12 advice), util 0.93.
# Second arm changes K only (K=7 = the Sly profiles' value). A boot failure at 8 seqs retries once at 1 seq and says so.
set -u
REPO=/home/dev/work/dp-craft/amd; RUN="$(cd "$(dirname "$0")" && pwd)"
SERVE=$REPO/bench/engine-bench/vllm/serve_vllm.sh; PORT=8010; GEN=$REPO/bench/workloads/generated; U=http://127.0.0.1:$PORT
M=/mnt/Lin1/work/vllm/sly-radiance/models
XA='--moe-backend triton_unfused --max-num-batched-tokens 2048 --override-generation-config {"temperature":1.0,"top_p":0.95,"top_k":20,"min_p":0.0,"presence_penalty":1.5}'

arm() {  # arm <label> <K> <seqs>; returns the boot rc
  local label=$1 k=$2 seqs=$3 d=$RUN/$1 rc served w=1 n; mkdir -p "$d"; rm -f "$REPO/bench/.servers/$PORT.log"
  python3 $REPO/bench/lib/vram_sampler.py --out "$d/gpu_samples.csv" --interval 1 >/dev/null 2>&1 & local S=$!
  { swapon --show; free -m; } >"$d/host_before.txt" 2>&1
  vmstat -n -t -S M 1 >"$d/vmstat.txt" 2>&1 & local V=$!
  PROFILE=sly-amd/qwen35-35b-a3b-mxfp4-dflash PORT=$PORT \
    MODEL_DIR=$M/Capicua25x__Ornith-1.5-35B-A3B-MXFP4-Quark-RDNA4@9e488f46 \
    DRAFT_DIR=$M/ornith-ai__Ornith-1.5-35B-A3B-DFlash@942d20fe SERVED_NAME=ornith15-mxfp4-dflash \
    SPEC_K=$k MAXLEN=262144 MAXSEQS=$seqs KV_DTYPE=fp8 WATCHDOG_MIB=32 GPU_UTIL=0.93 CACTUS_DELTA=0 WAIT=1200 EXTRA_ARGS="$XA" \
    "$SERVE" start </dev/null >"$d/start.txt" 2>&1; rc=$?
  echo "$label boot_rc=$rc" | tee -a "$RUN/progress.txt"
  if [ "$rc" = 0 ]; then
    served=$(curl -sf -m 5 "$U/v1/models" | python3 -c 'import json,sys;print(json.load(sys.stdin)["data"][0]["id"])')
    for n in 10000 50000 100000; do
      python3 $REPO/bench/lib/capture_engine.py probe --url "$U/v1" --model "$served" \
        --prompt-file "$GEN/codereview-$n.txt" --max-tokens 256 --temperature 1.0 --concurrency 1 --reps 3 --warmup $w \
        --prefix-mode unique --api chat --engine vllm --label "$label-$n" --timeout 600 >>"$d/results.jsonl" 2>>"$d/probe.err"
      echo "$label $n probe_rc=$? rows=$(wc -l <"$d/results.jsonl")" | tee -a "$RUN/progress.txt"; w=0
    done
    curl -s -m 600 "$U/v1/chat/completions" -H 'content-type: application/json' -d "{\"model\":\"$served\",\"messages\":[{\"role\":\"user\",\"content\":\"What is 17*23? Then write a one-line Python function that reverses a string.\"}],\"max_tokens\":3000,\"temperature\":0.2}" >"$d/sanity.json"
    curl -s -m 600 "$U/v1/chat/completions" -H 'content-type: application/json' -d "{\"model\":\"$served\",\"messages\":[{\"role\":\"user\",\"content\":\"Read the file src/main.py using the tool.\"}],\"max_tokens\":3000,\"temperature\":0.2,\"tools\":[{\"type\":\"function\",\"function\":{\"name\":\"read_file\",\"description\":\"Read a file\",\"parameters\":{\"type\":\"object\",\"properties\":{\"path\":{\"type\":\"string\"}},\"required\":[\"path\"]}}}]}" >"$d/toolcall.json"
    curl -s -m 5 "$U/metrics" | grep -E 'spec_decode_num_(drafts|draft_tokens|accepted_tokens)_total|prompt_tokens_(total|cached_total)|prefix_cache_(hits|queries)_total' | grep -v '^#' | sed -E 's/\{[^}]*\}//' >"$d/spec.txt"
    docker logs vllm-$PORT 2>&1 | grep -E 'MEMORY_FAULT|Memory Fault|Traceback' | grep -vc triton_bundler | sed 's/^/non_bundler_fault_lines=/' >>"$d/spec.txt"
  fi
  PORT=$PORT "$SERVE" stop >/dev/null 2>&1
  kill $S $V 2>/dev/null; wait $S $V 2>/dev/null
  { swapon --show; free -m; } >"$d/host_after.txt" 2>&1
  cp "$REPO/bench/.servers/$PORT.log" "$d/server.log" 2>/dev/null; cp "$REPO/bench/.servers/$PORT.cmdline" "$d/cmdline.txt" 2>/dev/null
  return "$rc"
}

arm ornith-k3-s8 3 8 || arm ornith-k3-s1 3 1
arm ornith-k7-s8 7 8 || arm ornith-k7-s1 7 1
echo DONE | tee -a "$RUN/progress.txt"

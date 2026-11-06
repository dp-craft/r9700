#!/usr/bin/env bash
# Boot-fit sweep for sly-amd/qwen35-35b-a3b-mxfp4-dflash: one boot per trial, records what the engine reports
# (needed vs available KV) + sampled VRAM. Same settings as vllm-35b.start.sh except the per-trial override.
# Hand-written: no tool covers boot-fit sweeps (gen_campaign.py probes servers that are already up).
set -u
REPO=/home/dev/work/dp-craft/amd; RUN="$(cd "$(dirname "$0")" && pwd)"
SERVE=$REPO/bench/engine-bench/vllm/serve_vllm.sh; PORT=8010; LOG=$REPO/bench/.servers/$PORT.log
SUM=$RUN/summary.txt
trial() {  # trial <label> <env assignments...>
  local label=$1; shift; local d=$RUN/$label; mkdir -p "$d"; rm -f "$LOG"
  python3 $REPO/bench/lib/vram_sampler.py --out "$d/gpu_samples.csv" --interval 1 >/dev/null 2>&1 & local S=$!
  local t0=$(date +%s)
  env PROFILE=sly-amd/qwen35-35b-a3b-mxfp4-dflash PORT=$PORT MAXLEN=262000 MAXSEQS=1 KV_DTYPE=fp8 \
      WATCHDOG_MIB=32 GPU_UTIL=0.93 CACTUS_DELTA=0 WAIT=1200 "$@" "$SERVE" start </dev/null >"$d/start.txt" 2>&1
  local rc=$?; local dt=$(( $(date +%s)-t0 ))
  PORT=$PORT "$SERVE" stop >/dev/null 2>&1
  kill $S 2>/dev/null; wait $S 2>/dev/null
  cp "$LOG" "$d/server.log" 2>/dev/null; cp "$REPO/bench/.servers/$PORT.cmdline" "$d/cmdline.txt" 2>/dev/null
  { echo "== $label [$*] rc=$rc boot_s=$dt"
    sed 's/\x1b\[[0-9;]*m//g' "$d/server.log" 2>/dev/null | grep -E "MoE backend|Model loading took|Graph capturing finished|Available KV cache memory|GPU KV cache size|GiB KV cache is needed|Initial profiling/warmup run took|MEMORY_FAULT|Memory Fault" \
      | grep -v 'dflash' | sed -E 's/^\(EngineCore pid=[0-9]+\) //; s/^ERROR.*ValueError/ValueError/; s/ Try increasing.*//' | cut -c1-210 | awk '!s[$0]++'
    grep -E 'WATCHDOG|refusing|abort|not healthy' "$d/start.txt" | cut -c1-200
    awk -F, 'NR==1{for(i=1;i<=NF;i++){if($i~/vram_used/)v=i;if($i~/gtt_used/)g=i}} NR>1{if($v+0>mv)mv=$v+0;if($g+0>mg)mg=$g+0} END{print "peak_vram_used="mv" peak_gtt_used="mg" (csv units)"}' "$d/gpu_samples.csv" 2>/dev/null
  } >>"$SUM"
}
trial gs5       KV_GROUP_SIZE=5
trial gs1       KV_GROUP_SIZE=1
trial gs5-k7    KV_GROUP_SIZE=5 SPEC_K=7
trial gs5-triton KV_GROUP_SIZE=5 "EXTRA_ARGS=--moe-backend triton"
echo "SWEEP DONE" >>"$SUM"
cat "$SUM"

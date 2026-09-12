#!/usr/bin/env bash
# bootmatrix.sh — answer the KV-pool / window questions WITHOUT running a workload.
#
# WHY BOOT-ONLY: every number this needs (Available KV cache memory, GPU KV cache size,
# Maximum concurrency, and the check_enough_kv_cache_memory refusal with its estimated
# achievable max_model_len) is printed by vLLM right after the memory-profiling pass and
# BEFORE torch.compile graph capture. So each arm aborts the moment that line appears:
# ~2-3 min/arm instead of the ~5 min a full boot costs, and a REFUSED boot is a result,
# not a failure (it names the ceiling we are trying to find).
#
# SAFETY (CLAUDE.md rule 14): boots only under its OWN container name, never touches a
# llama-swap-* container, and gates on a free-VRAM floor before every arm.
set -u
cd /home/dev/work/dp-craft/amd
STAMP=$(date +%Y-%m-%d-%H%M)
R=bench/runs/${STAMP}-vllm-window-bootmatrix
IMG=stilldeadcode/vllm-radiance:0.9.3
MODEL=/home/dev/models/vllm/Qwen3.8-27B-INT4
CACHE=/home/dev/work/dp-craft/amd/bench/dl/radiance-cache
NAME=radiance-bootprobe          # OURS. Never 'radiance', never 'llama-swap-*'.
RG=$(getent group render | cut -d: -f3); VG=$(getent group video | cut -d: -f3)
FLOOR=${FLOOR:-29000}
mkdir -p "$R"
LOG="$R/bootmatrix.log"
exec > >(tee -a "$LOG") 2>&1
echo "===== vLLM window boot-matrix  $(date +%F\ %T) ====="
echo "image=$IMG model=$MODEL floor=${FLOOR}MiB"
echo

# Absolute guarantee we only ever remove our own probe container.
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM

boot_arm() {  # $1=slug  $2=label  $3=ctx  $4=mtp(0=off)  $5=np  $6=kvdtype(auto|fp8)  rest=extra vllm args
  local slug="$1" label="$2" ctx="$3" mtp="$4" np="$5" kvd="$6"; shift 6
  local A="$R/$slug"; mkdir -p "$A"
  echo "########## $slug — $label  ($(date +%T))"
  echo "   ctx=$ctx mtp=$mtp np=$np kv=$kvd extra='$*'"

  # Rule 14: assert the POSITIVE precondition, and name the holder if it fails.
  if ! bash bench/lib/gpu_exclusive.sh "$FLOOR" > "$A/gpu_exclusive.log" 2>&1; then
    echo "   SKIPPED — GPU not exclusive:"; tail -3 "$A/gpu_exclusive.log" | sed 's/^/      /'
    echo "$slug SKIPPED not-exclusive" >> "$R/summary.txt"; return 0
  fi
  cleanup

  local spec=() kv=()
  [ "$mtp" -gt 0 ] && spec=(--speculative-config "{\"method\":\"mtp\",\"num_speculative_tokens\":$mtp,\"attention_backend\":\"R4D\",\"disable_padded_drafter_batch\":true}")
  [ "$kvd" != "auto" ] && kv=(--kv-cache-dtype "$kvd")

  docker run -d --name "$NAME" --rm \
    --device /dev/kfd --device /dev/dri --group-add "$RG" --group-add "$VG" \
    --shm-size 4g --cap-add SYS_PTRACE --security-opt seccomp=unconfined \
    -p 127.0.0.1:8000:8000 -v "$MODEL":/model:ro -v "$CACHE":/cache \
    -e HF_HUB_OFFLINE=1 -e VLLM_NO_USAGE_STATS=1 \
    -e VLLM_ROCM_USE_AITER=1 -e VLLM_ROCM_USE_AITER_UNIFIED_ATTENTION=1 \
    -e VLLM_ROCM_USE_AITER_MHA=0 -e VLLM_ROCM_USE_AITER_MLA=0 -e VLLM_ROCM_USE_AITER_MOE=0 \
    -e VLLM_ROCM_USE_AITER_LINEAR=0 -e VLLM_ROCM_USE_AITER_FP8BMM=0 \
    -e VLLM_ROCM_USE_AITER_FP4BMM=0 -e VLLM_ROCM_USE_AITER_RMSNORM=0 \
    -e VLLM_CACHE_ROOT=/cache/vllm -e TORCHINDUCTOR_CACHE_DIR=/cache/inductor \
    -e TRITON_CACHE_DIR=/cache/triton -e AITER_ROOT_DIR=/cache/aiter \
    -e TRITON_CACHE_AUTOTUNING=1 \
    -e RADIANCE_FAST_DRAFT=1 -e RADIANCE_DRAFT_TAU=0.28 -e RADIANCE_SKINNY_GEMM=all \
    "$IMG" /model --served-model-name qwen38-27b-int4 --host 0.0.0.0 --port 8000 \
      --language-model-only --max-model-len "$ctx" --max-num-batched-tokens 16384 \
      --max-num-seqs "$np" --gpu-memory-utilization 0.90 \
      --attention-backend R4D --enable-prefix-caching --mamba-cache-mode align \
      "${kv[@]}" "${spec[@]}" --no-async-scheduling "$@" \
      > "$A/container_id.txt" 2>&1 \
    || { echo "   docker run REFUSED:"; sed 's/^/      /' "$A/container_id.txt"
         echo "$slug DOCKER-REFUSED" >> "$R/summary.txt"; return 0; }

  # Gate on the POSITIVE: the pool line, or an explicit refusal. Never on absence of error.
  local t0=$(date +%s) verdict="TIMEOUT" deadline=900
  while [ $(( $(date +%s)-t0 )) -lt $deadline ]; do
    docker logs "$NAME" > "$A/server.log" 2>&1
    if   grep -q "GPU KV cache size:" "$A/server.log"; then verdict="POOL-SIZED"; break
    elif grep -qE "larger than the available KV cache memory|No available memory for the cache blocks|To serve at least one request with the model's max seq len" "$A/server.log"; then verdict="REFUSED"; break
    elif ! docker ps --filter "name=^${NAME}$" --format '{{.Names}}' | grep -q "$NAME"; then verdict="EXITED"; break
    fi
    sleep 5
  done
  docker logs "$NAME" > "$A/server.log" 2>&1
  local dt=$(( $(date +%s)-t0 ))
  echo "   verdict=$verdict after ${dt}s"
  {
    echo "arm=$slug ctx=$ctx mtp=$mtp np=$np kv=$kvd verdict=$verdict secs=$dt"
    grep -ohE "Available KV cache memory: [0-9.]+ GiB|GPU KV cache size: [0-9,]+ tokens|Maximum concurrency for [0-9,]+ tokens per request: [0-9.]+x|Model loading took [0-9.]+ GiB|Setting attention block size to [0-9]+ tokens" "$A/server.log" | sort -u | sed 's/^/   /'
    # A refusal carries the achievable ceiling — that IS the measurement.
    grep -ohE "the estimated maximum model length is [0-9]+|larger than the available KV cache memory[^\"]{0,60}|No available memory for the cache blocks" "$A/server.log" | sort -u | head -3 | sed 's/^/   ! /'
  } | tee -a "$R/summary.txt"
  echo
  cleanup; sleep 8
}

# --- the matrix -------------------------------------------------------------------------
# Group 1 — does the SHIPPED row (ctx 114688 / mtp 3) boot, and if not what is the ceiling?
boot_arm w1-ctx112k-mtp3      "shipped row as generated"            114688 3 4 auto
boot_arm w2-ctx112k-mtp3-fp8  "fp8 KV as the window enabler"        114688 3 4 fp8
boot_arm w3-ctx112k-mtp0      "is MTP the blocker?"                 114688 0 4 auto
boot_arm w4-ctx112k-mtp3-np1  "is max-num-seqs the lever?"          114688 3 1 auto
# Group 2 — the KV-accounting question, all at the ONE window we already have data for.
# c3 is the cell that was missing: MTP off WITH prefix caching + align (the 197,973-token
# figure was taken with prefix caching OFF, so it was never a like-for-like MTP-off ceiling).
boot_arm c1-ctx36k-mtp8       "re-measure shipped baseline (spread)" 36864 8 4 auto
boot_arm c2-ctx36k-mtp3       "MTP-3 pool at the known window"       36864 3 4 auto
boot_arm c3-ctx36k-mtp0       "MTP-0, prefix caching ON (confound)"  36864 0 4 auto
boot_arm c4-ctx36k-mtp8-fp8   "fp8 KV delta at a fixed window"       36864 8 4 fp8

echo "===== done $(date +%T) — summary: $R/summary.txt ====="
cat "$R/summary.txt"

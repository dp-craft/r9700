#!/usr/bin/env bash
# bootarm_c3.sh — re-run the ONE arm whose diagnostics bootmatrix.sh lost.
#
# THE BUG BEING FIXED: bootmatrix.sh ran the probe with `docker run --rm`. When a
# container exits, the daemon removes it immediately, so the next `docker logs` fails
# and its error message OVERWRITES server.log -- destroying the very output that would
# say why the arm exited. c3 (MTP-0 with prefix caching ON, the missing confound cell)
# hit exactly that: verdict=EXITED after 206s with a 66-byte server.log reading
# "No such container". Two changes here: keep the container (no --rm, cleanup removes
# it), and never overwrite a good server.log with a failed docker-logs call.
set -u
cd /home/dev/work/dp-craft/amd
R=${R:-bench/runs/2026-09-12-1844-vllm-window-bootmatrix}
A="$R/c3-ctx36k-mtp0-rerun"; mkdir -p "$A"
IMG=stilldeadcode/vllm-radiance:0.9.3
MODEL=/home/dev/models/vllm/Qwen3.8-27B-INT4
CACHE=/home/dev/work/dp-craft/amd/bench/dl/radiance-cache
NAME=radiance-bootprobe
RG=$(getent group render | cut -d: -f3); VG=$(getent group video | cut -d: -f3)
FLOOR=${FLOOR:-29000}
CTX=36864; NP=4

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM

# Only replace server.log when the capture actually succeeded (the bug above).
snap() { if docker logs "$NAME" > "$A/.log.tmp" 2>&1; then mv "$A/.log.tmp" "$A/server.log"; else rm -f "$A/.log.tmp"; fi; }

echo "########## c3-ctx36k-mtp0 RERUN — MTP off, prefix caching ON  ($(date +%T))"
if ! bash bench/lib/gpu_exclusive.sh "$FLOOR" > "$A/gpu_exclusive.log" 2>&1; then
  echo "   SKIPPED — GPU not exclusive:"; tail -3 "$A/gpu_exclusive.log" | sed 's/^/      /'; exit 0
fi
cleanup

docker run -d --name "$NAME" \
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
    --language-model-only --max-model-len "$CTX" --max-num-batched-tokens 16384 \
    --max-num-seqs "$NP" --gpu-memory-utilization 0.90 \
    --attention-backend R4D --enable-prefix-caching --mamba-cache-mode align \
    --no-async-scheduling > "$A/container_id.txt" 2>&1 \
  || { echo "   docker run REFUSED:"; sed 's/^/      /' "$A/container_id.txt"; exit 0; }

t0=$(date +%s); verdict=TIMEOUT
while [ $(( $(date +%s)-t0 )) -lt 900 ]; do
  snap
  if   grep -q "GPU KV cache size:" "$A/server.log" 2>/dev/null; then verdict=POOL-SIZED; break
  elif grep -qE "larger than the available KV cache memory|No available memory for the cache blocks|To serve at least one request with the model's max seq len" "$A/server.log" 2>/dev/null; then verdict=REFUSED; break
  elif [ "$(docker inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null)" != "true" ]; then verdict=EXITED; break
  fi
  sleep 5
done
snap
echo "   verdict=$verdict after $(( $(date +%s)-t0 ))s  exit_code=$(docker inspect -f '{{.State.ExitCode}}' "$NAME" 2>/dev/null)"
{
  echo "arm=c3-ctx36k-mtp0-rerun ctx=$CTX mtp=0 np=$NP kv=auto verdict=$verdict"
  grep -ohE "Available KV cache memory: [0-9.]+ GiB|GPU KV cache size: [0-9,]+ tokens|Maximum concurrency for [0-9,]+ tokens per request: [0-9.]+x|Model loading took [0-9.]+ GiB|Setting attention block size to [0-9]+ tokens" "$A/server.log" | sort -u | sed 's/^/   /'
} | tee -a "$R/summary.txt"
[ "$verdict" = "EXITED" ] && { echo "   --- last 30 log lines (why it died) ---"; tail -30 "$A/server.log" | cut -c1-200 | sed 's/^/   /'; }

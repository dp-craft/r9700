#!/usr/bin/env bash
# A/B diagnostic: is vLLM 35B-AWQ decode slowness caused by the container memory cap
# or by unoptimized ROCm kernels? Run with different --memory, sample GPU live during decode.
source "$(dirname "$0")/config.sh"; source "$(dirname "$0")/lib.sh"
MEMFLAG="$1"   # e.g. "--memory=31g --memory-swap=31g"  or empty for no cap
TAG="${2:-relaxed}"
docker rm -f vllm-ab 2>/dev/null >/dev/null
echo ">>> starting vLLM 35B-AWQ fp16, memflag='[$MEMFLAG]' tag=$TAG"
docker run -d --name vllm-ab \
  --device /dev/kfd --device /dev/dri --group-add $RENDER_GID --group-add $VIDEO_GID \
  --ipc=host --shm-size=8g $MEMFLAG \
  -e HSA_OVERRIDE_GFX_VERSION=$HSA -e PYTORCH_ALLOC_CONF=expandable_segments:True \
  -v "$AWQ_35B":/model:ro -v "$HARNESS/.hf-cache":/root/.cache/huggingface -p 8000:8000 \
  "$IMG" vllm serve /model --served-model-name m --quantization awq --dtype float16 \
  --max-model-len $CTX --gpu-memory-utilization 0.92 >/dev/null 2>&1

if ! wait_http "http://127.0.0.1:8000/health" 480; then
  echo "LOAD FAIL"; docker logs vllm-ab 2>&1 | tail -20; docker rm -f vllm-ab >/dev/null 2>&1; exit 1
fi
echo "server up; warmup + timed 200-tok greedy decode with live GPU/host sampling"

# background sampler: GPU use%/power + container mem/cpu, ~1s cadence
( for i in $(seq 1 25); do
    u=$(rocm-smi --showuse --showpower 2>/dev/null | grep -iE 'GPU use|Average Graphics Package' | awk -F: '{print $NF}' | tr -d ' \n' )
    s=$(docker stats --no-stream --format '{{.MemUsage}}|{{.CPUPerc}}' vllm-ab 2>/dev/null)
    echo "  t${i}s use/pow=$u  cont=$s"
    sleep 1
  done ) > "$HARNESS/ab_samples_${TAG}.log" 2>&1 &
SAMP=$!

python3 - "$TAG" <<'PY'
import sys, time, json, urllib.request
tag=sys.argv[1]
def call(nt):
    body=json.dumps({"model":"m","prompt":"Write a Python function that merges overlapping intervals and explain it step by step:\n","max_tokens":nt,"temperature":0}).encode()
    r=urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:8000/v1/completions",body,{"Content-Type":"application/json"}),timeout=600)
    return json.loads(r.read())
call(8)  # warmup
t0=time.time(); out=call(200); dt=time.time()-t0
n=out["usage"]["completion_tokens"]
print(f"RESULT[{tag}] tokens={n} time={dt:.2f}s decode={n/dt:.1f} tok/s")
PY

wait $SAMP 2>/dev/null
echo "=== GPU/host samples during decode ($TAG) ==="; cat "$HARNESS/ab_samples_${TAG}.log"
docker rm -f vllm-ab >/dev/null 2>&1

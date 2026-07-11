#!/usr/bin/env bash
# Retry 27B vLLM with AUTO quant detection (model is compressed-tensors, not awq).
# Clean GPU use%/power sampling during a 200-token decode.
source "$(dirname "$0")/config.sh"; source "$(dirname "$0")/lib.sh"
KV="${1:-fp16}"; kvarg=""; [ "$KV" = fp8 ] && kvarg="--kv-cache-dtype fp8"
docker rm -f vllm-27 2>/dev/null >/dev/null
echo ">>> 27B compressed-tensors, KV=$KV (auto quant detect, no --quantization flag)"
docker run -d --name vllm-27 \
  --device /dev/kfd --device /dev/dri --group-add $RENDER_GID --group-add $VIDEO_GID \
  --ipc=host --shm-size=8g --memory=30g --memory-swap=30g \
  -e HSA_OVERRIDE_GFX_VERSION=$HSA -e PYTORCH_ALLOC_CONF=expandable_segments:True \
  -v "$AWQ_27B":/model:ro -v "$HARNESS/.hf-cache":/root/.cache/huggingface -p 8000:8000 \
  "$IMG" vllm serve /model --served-model-name m --dtype float16 \
  --max-model-len $CTX --gpu-memory-utilization 0.92 $kvarg >/dev/null 2>&1

if ! wait_http "http://127.0.0.1:8000/health" 480; then
  echo "LOAD FAIL — reason:"; docker logs vllm-27 2>&1 | grep -iE 'error|not supported|kernel|group_size|ValueError|quant|memory|assert' | tail -6 | cut -c1-170
  docker rm -f vllm-27 >/dev/null 2>&1; exit 1
fi
echo "server up; timed 200-tok decode + clean GPU sampling"
( for i in $(seq 1 20); do
    read use pow < <(rocm-smi --showuse --showpower 2>/dev/null | awk -F: '/GPU use/{u=$NF} /Average Graphics Package/{p=$NF} END{print u, p}')
    cpu=$(docker stats --no-stream --format '{{.CPUPerc}}' vllm-27 2>/dev/null)
    echo "  t${i}s GPUuse=${use}% pow=${pow}W cpu=${cpu}"
    sleep 1
  done ) > "$HARNESS/vllm27_samples.log" 2>&1 &
SAMP=$!
python3 - <<'PY'
import time, json, urllib.request
def call(nt):
    body=json.dumps({"model":"m","prompt":"Write a Python function that merges overlapping intervals and explain it step by step:\n","max_tokens":nt,"temperature":0}).encode()
    r=urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:8000/v1/completions",body,{"Content-Type":"application/json"}),timeout=600)
    return json.loads(r.read())
call(8)
t0=time.time(); out=call(200); dt=time.time()-t0
n=out["usage"]["completion_tokens"]
print(f"RESULT[27B] tokens={n} time={dt:.2f}s decode={n/dt:.1f} tok/s")
PY
wait $SAMP 2>/dev/null
echo "=== 27B GPU/CPU samples ==="; cat "$HARNESS/vllm27_samples.log"
docker rm -f vllm-27 >/dev/null 2>&1

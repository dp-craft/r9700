#!/usr/bin/env bash
# PyTorch/"unsloth-family" path: load AWQ weights via HF transformers generate() on ROCm.
# Reuses already-downloaded AWQ weights (no 60GB BF16 download). Best-effort; documents outcome.
source "$(dirname "$0")/config.sh"; source "$(dirname "$0")/lib.sh"

cat > "$HARNESS/_hf_probe.py" <<'PY'
import time, json, os, torch
from transformers import AutoModelForCausalLM, AutoTokenizer
M="/model"; OUT="/out/results.jsonl"
try:
    tok=AutoTokenizer.from_pretrained(M, trust_remote_code=True)
    t0=time.time()
    model=AutoModelForCausalLM.from_pretrained(M, torch_dtype=torch.float16, device_map="cuda", trust_remote_code=True)
    load=time.time()-t0
    ids=tok("def merge_intervals(intervals):", return_tensors="pt").to("cuda")
    model.generate(**ids, max_new_tokens=8)  # warmup
    t1=time.time(); out=model.generate(**ids, max_new_tokens=64, do_sample=False); dt=time.time()-t1
    n=out.shape[1]-ids.input_ids.shape[1]
    rec={"runtime":"transformers-hf","model":os.environ.get("TAG","?"),"format":"AWQ 4-bit",
         "engine":"transformers generate()","load_s":round(load,1),"decode_tok_s":round(n/dt,1),"status":"OK"}
except Exception as e:
    rec={"runtime":"transformers-hf","model":os.environ.get("TAG","?"),"format":"AWQ 4-bit",
         "engine":"transformers generate()","status":"FAIL","error":str(e)[:200]}
print(json.dumps(rec)); open(OUT,"a").write(json.dumps(rec)+"\n")
PY

try_hf() { # <model_dir> <tag> <results_file>
  echo ">>> transformers-HF $2"
  docker rm -f hfprobe 2>/dev/null >/dev/null
  timeout 700 docker run --rm --name hfprobe \
    --device /dev/kfd --device /dev/dri --group-add $RENDER_GID --group-add $VIDEO_GID \
    --ipc=host --shm-size=8g --memory=26g --memory-swap=26g \
    -e HSA_OVERRIDE_GFX_VERSION=$HSA -e PYTORCH_ALLOC_CONF=expandable_segments:True -e TAG="$2" \
    -v "$1":/model:ro -v "$HARNESS":/out -v "$HARNESS/_hf_probe.py":/probe.py:ro \
    "$IMG" python3 /probe.py 2>&1 | tail -6
}

try_hf "$AWQ_35B" "35B-A3B-AWQ" "$RESULTS"
try_hf "$AWQ_27B" "27B-AWQ" "$RESULTS"
echo "=== transformers-HF phase done ==="

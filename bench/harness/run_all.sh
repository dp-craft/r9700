#!/usr/bin/env bash
# ── Master orchestrator ─────────────────────────────────────────────────────
# Runs the full unified matrix into a timestamped results file, GPU-exclusive.
#   1. environment capture   2. llama.cpp   3. ollama   4. vLLM   5. transformers/HF
# Usage: run_all.sh [phase]   (phase ∈ all|llamacpp|ollama|vllm|unsloth)
set -u
HARNESS="$(cd "$(dirname "$0")" && pwd)"
source "$HARNESS/config.sh"; source "$HARNESS/lib.sh"
STAMP=$(date +%Y-%m-%d_%H%M)
export RESULTS="$HARNESS/results_${STAMP}.jsonl"
PHASE="${1:-all}"
echo "results -> $RESULTS   phase=$PHASE"

env_capture() {
  local aspm rocm ver
  aspm=$(cat /sys/module/pcie_aspm/parameters/policy 2>/dev/null | tr -d '\n')
  rocm=$(cat /opt/rocm/.info/version 2>/dev/null || echo '?')
  ver=$("$LC/llama-server" --version 2>&1 | head -1 | tr -d '\n')
  python3 - "$RESULTS" "$aspm" "$rocm" "$ver" "$IMG" "$CTX" <<'PY'
import json,sys
_,out,aspm,rocm,ver,img,ctx=sys.argv
open(out,"a").write(json.dumps({"_meta":True,"pcie_aspm":aspm,"rocm":rocm,"llamacpp":ver,
  "gpu":"AMD Radeon AI PRO R9700 (gfx1201, RDNA4, 31.86GiB)","vllm_image":img,
  "ctx":int(ctx),"n_decode":256,"prefill_prompt":"~3K tok unique-prefixed","host_ram_gb":31,
  "note":"post disk-rebuild; llama.cpp b1295; PCIe ASPM=performance"})+"\n")
PY
  echo "env captured"
}

case "$PHASE" in
  all)      env_capture; bash "$HARNESS/run_llamacpp.sh"; bash "$HARNESS/run_ollama.sh"; bash "$HARNESS/run_vllm.sh"; bash "$HARNESS/run_unsloth.sh";;
  llamacpp) bash "$HARNESS/run_llamacpp.sh";;
  ollama)   bash "$HARNESS/run_ollama.sh";;
  vllm)     bash "$HARNESS/run_vllm.sh";;
  unsloth)  bash "$HARNESS/run_unsloth.sh";;
esac
echo "=========================================================="
echo "DONE. Results: $RESULTS"
python3 - "$RESULTS" <<'PY'
import json,sys
rows=[json.loads(l) for l in open(sys.argv[1]) if l.strip() and '"_meta"' not in l]
print(f"{'label':<24}{'model':<15}{'kv':<5}{'ub':<5}{'prefill':>9}{'decode':>9}{'vram':>8}")
for r in rows:
    print(f"{r.get('label','')[:23]:<24}{str(r.get('model',''))[:14]:<15}{str(r.get('kv_bits','')):<5}{str(r.get('ub','')):<5}{str(r.get('prefill_tok_s',r.get('status','')))[:8]:>9}{str(r.get('decode_tok_s','')):>9}{str(r.get('vram_used_mb','')):>8}")
PY

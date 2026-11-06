#!/usr/bin/env bash
# depthcurve_bigwindow.sh — PHASE B. Run only AFTER bootmatrix.sh has named a config that boots.
#
# Parameterised on purpose: set CTX/MTP/NP/KVD to the winning bootmatrix arm. Defaults are the
# shipped row. Answers the question that actually decides anything: at the prompt size the
# dp-forge spec-pipeline really sends (~75k; fixture codereview-100000 brackets it), does the
# vLLM row beat the llama.cpp 200k row it would replace?
#
# Rule 16: 4 depths, log-log fit, exponent + R^2 reported beside the rates.
# Rule 2 : PREFIX_MODE=unique so prefill is honest (shared inflates it ~2.4x).
set -u
cd /home/dev/work/dp-craft/amd
CTX=${CTX:-114688}; MTP=${MTP:-3}; NP=${NP:-4}; KVD=${KVD:-auto}
DEPTHS=${DEPTHS:-"8000 20000 40000 100000"}; REPS=${REPS:-3}; MAXTOK=${MAXTOK:-256}
LCPP_MODEL=${LCPP_MODEL:-qwen38-27b-q4kxl-q8-mtp-ctx200000-kvq8-mtp-sharp-planning}
STAMP=$(date +%Y-%m-%d-%H%M)
R=bench/runs/${STAMP}-vllm-bigwindow-depthcurve
IMG=stilldeadcode/vllm-radiance:0.9.3
MODEL=/home/dev/models/vllm/Qwen3.8-27B-INT4
CACHE=/home/dev/work/dp-craft/amd/bench/dl/radiance-cache
NAME=radiance-depthcurve        # OURS only.
RG=$(getent group render | cut -d: -f3); VG=$(getent group video | cut -d: -f3)
mkdir -p "$R"; exec > >(tee -a "$R/depthcurve.log") 2>&1
echo "===== big-window depth curve  $(date +%F\ %T) ====="
echo "vllm: ctx=$CTX mtp=$MTP np=$NP kv=$KVD | depths=$DEPTHS reps=$REPS max_tokens=$MAXTOK"
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM

point() {  # $1=arm dir  $2=url  $3=model  $4=depth
  local A="$1" url="$2" model="$3" d="$4"
  local pf="bench/workloads/generated/codereview-${d}.txt"
  [ -f "$pf" ] || { echo "  DEPTH $d SKIPPED — no fixture $pf"; return 0; }
  python3 bench/lib/capture_engine.py probe --url "$url" --model "$model" \
    --prompt-file "$pf" --max-tokens "$MAXTOK" --temperature 0.2 \
    --reps "$REPS" --warmup 1 --prefix-mode unique --api chat --timeout 1800 \
    --label "d${d}" --engine "$(basename "$A")" >> "$A/results.jsonl" 2>> "$A/probe.err"
  # capture_engine writes one kind=request row per rep (prompt_tokens/ttft_s/total_s); there is no
  # aggregate row, so reading prompt_tok/ttft_p50 printed None for every depth (2026-09-12 19:43 run).
  python3 - "$A/results.jsonl" "$d" <<'PY'
import json,sys,statistics as st
rows=[json.loads(l) for l in open(sys.argv[1]) if l.strip()]
g=[x for x in rows if x.get("label")==f"d{sys.argv[2]}" and x.get("kind")=="request"]
m=lambda k: round(st.mean([x[k] for x in g if x.get(k) is not None]),2) if g else None
print(f"  DEPTH {sys.argv[2]:>6} ptok={m('prompt_tokens')} prefill={m('prefill_tok_s')} "
      f"decode={m('decode_tok_s')} ttft={m('ttft_s')} wall={m('total_s')} n={len(g)}")
PY
}

########## ARM A — llama.cpp 200k via llama-swap (the incumbent it must beat)
A="$R/llamacpp-200k"; mkdir -p "$A"
echo; echo "##### ARM A: llama.cpp $LCPP_MODEL  $(date +%T)"
curl -s -m 5 "http://127.0.0.1:9292/unload" >/dev/null    # GET, not POST (rule 14)
hc=$(curl -s -o /dev/null -w '%{http_code}' -m 900 http://127.0.0.1:9292/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d "{\"model\":\"$LCPP_MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}],\"max_tokens\":1}")
if [ "$hc" != "200" ]; then echo "  ABORT — warmup http=$hc (rule 18: no data beats bad data)"; else
  setsid bash -c 'echo $$ > "$0"; exec "$@"' "$A/sampler.pid" \
    python3 bench/lib/vram_sampler.py --out "$A/gpu_samples.csv" > "$A/sampler.log" 2>&1 </dev/null &
  for d in $DEPTHS; do point "$A" http://127.0.0.1:9292/v1 "$LCPP_MODEL" "$d"; done
  kill -TERM "$(cat "$A/sampler.pid")" 2>/dev/null
fi
curl -s -m 5 "http://127.0.0.1:9292/unload" >/dev/null

########## ARM B — vLLM/radiance, booted directly (not via llama-swap, so ctx/mtp are ours)
B="$R/radiance-ctx${CTX}-mtp${MTP}-kv${KVD}"; mkdir -p "$B"
echo; echo "##### ARM B: radiance ctx=$CTX mtp=$MTP np=$NP kv=$KVD  $(date +%T)"
if ! bash bench/lib/gpu_exclusive.sh 29000 > "$B/gpu_exclusive.log" 2>&1; then
  echo "  ABORT — GPU not exclusive:"; tail -3 "$B/gpu_exclusive.log"; exit 1; fi
cleanup
spec=(); [ "$MTP" -gt 0 ] && spec=(--speculative-config "{\"method\":\"mtp\",\"num_speculative_tokens\":$MTP,\"attention_backend\":\"R4D\",\"disable_padded_drafter_batch\":true}")
kv=();   [ "$KVD" != "auto" ] && kv=(--kv-cache-dtype "$KVD")
setsid bash -c 'echo $$ > "$0"; exec "$@"' "$B/sampler.pid" \
  python3 bench/lib/vram_sampler.py --out "$B/gpu_samples.csv" > "$B/sampler.log" 2>&1 </dev/null &
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
  -e TRITON_CACHE_DIR=/cache/triton -e AITER_ROOT_DIR=/cache/aiter -e TRITON_CACHE_AUTOTUNING=1 \
  -e RADIANCE_FAST_DRAFT=1 -e RADIANCE_DRAFT_TAU=0.28 -e RADIANCE_SKINNY_GEMM=all \
  "$IMG" /model --served-model-name qwen38-27b-int4 --host 0.0.0.0 --port 8000 \
    --language-model-only --max-model-len "$CTX" --max-num-batched-tokens 16384 \
    --max-num-seqs "$NP" --gpu-memory-utilization 0.90 \
    --attention-backend R4D --enable-prefix-caching --mamba-cache-mode align \
    "${kv[@]}" "${spec[@]}" --no-async-scheduling > "$B/container_id.txt" 2>&1 || {
      echo "  docker run refused:"; cat "$B/container_id.txt"; exit 1; }
t0=$(date +%s); ok=0
while [ $(( $(date +%s)-t0 )) -lt 1200 ]; do
  curl -sf -m 3 http://127.0.0.1:8000/health >/dev/null 2>&1 && { ok=1; break; }
  docker ps --filter "name=^${NAME}$" --format '{{.Names}}' | grep -q "$NAME" || break
  sleep 5
done
docker logs "$NAME" > "$B/server.log" 2>&1
grep -ohE "Available KV cache memory: [0-9.]+ GiB|GPU KV cache size: [0-9,]+ tokens|Maximum concurrency[^\"]*" "$B/server.log" | sort -u | sed 's/^/  /'
if [ $ok -ne 1 ]; then echo "  BOOT FAILED after $(( $(date +%s)-t0 ))s"; tail -25 "$B/server.log"
else
  echo "  boot ok after $(( $(date +%s)-t0 ))s"
  for d in $DEPTHS; do point "$B" http://127.0.0.1:8000/v1 qwen38-27b-int4 "$d"; done
  # MTP is only worth running if the draft is being accepted — report tau per run (rule: a
  # speculation number without its acceptance length is a synthetic headline).
  docker logs "$NAME" > "$B/server.log" 2>&1
  echo "  -- draft acceptance --"
  grep -ohE "acceptance length[^,]*|Mean acceptance length: [0-9.]+" "$B/server.log" | tail -3 | sed 's/^/  /'
fi
kill -TERM "$(cat "$B/sampler.pid")" 2>/dev/null; cleanup

########## fits + charts (rule 16 / tools-first)
python3 - "$R" <<'PY'
import json,glob,math,os,sys
R=sys.argv[1]
for arm in sorted(glob.glob(os.path.join(R,"*","results.jsonl"))):
    rows=[json.loads(l) for l in open(arm) if l.strip()]
    by={}
    for r in rows:
        if r.get("kind")=="request" and r.get("prompt_tokens"): by.setdefault(r["label"],[]).append(r)
    mean=lambda g,k: sum(x[k] for x in g)/len(g)
    pts=[(mean(g,"prompt_tokens"),mean(g,"prefill_tok_s"),mean(g,"decode_tok_s")) for g in by.values()]
    if len(pts)<3: print(f"{os.path.basename(os.path.dirname(arm))}: <3 usable points, no fit"); continue
    def fit(i):
        xs=[math.log(p[0]) for p in pts if p[i]]; ys=[math.log(p[i]) for p in pts if p[i]]
        n=len(xs); mx=sum(xs)/n; my=sum(ys)/n
        sxy=sum((x-mx)*(y-my) for x,y in zip(xs,ys)); sxx=sum((x-mx)**2 for x in xs)
        b=sxy/sxx; a=my-b*mx
        ss=sum((y-my)**2 for y in ys); rs=sum((y-(a+b*x))**2 for x,y in zip(xs,ys))
        return b, (1-rs/ss if ss else float('nan'))
    bp,rp=fit(1); bd,rd=fit(2)
    print(f"{os.path.basename(os.path.dirname(arm))}: prefill exponent {bp:+.3f} (R2 {rp:.2f}) | "
          f"decode exponent {bd:+.3f} (R2 {rd:.2f}) | n={len(pts)}")
PY
python3 bench/lib/report.py "$R" 2>&1 | tail -3 || echo "  (report.py: see the known chart gap)"
echo "===== done $(date +%T) — $R ====="

#!/usr/bin/env bash
# run_capture.sh — Campaign 2 (quality tuning) driver. Sweeps SERVER configs (model × mtp × kv ×
# EXTRA_ARGS: reasoning-budget / spec-draft flags) and, per server, SAMPLING points (temp/top_p/top_k
# via capture.py). Reuses the finetune-quality capture.py + graders (no duplication). Streams each
# config's replies + telemetry into out/outputs.jsonl, samples VRAM/power per server, resumable
# (per-sampling markers in out/done/), continues past a failed server (out/failures.txt).
#
#   bash run_capture.sh                       # all configs
#   ONLY='jr-*'  bash run_capture.sh          # subset by config name glob (server 'name' field)
#   REPS=3 bash run_capture.sh                # majority-vote the noisy temp>0 grades
#   CONTEXT_PREFIX=codereview-16000.txt bash run_capture.sh   # prepend a fixed agentic code context
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
FT="$REPO/campaigns/2026-07-12-27b-finetune-quality"   # source of capture.py + graders (reused)
SERVE="$REPO/bench/engine-bench/serve_llamacpp.sh"
: "${MODELS_DIR:=/home/dev/models/gguf}"
: "${PORT:=8081}" ; : "${CTX:=32768}" ; : "${UB:=2048}" ; : "${B:=4096}" ; : "${BACKEND:=vulkan}"
: "${REPS:=1}" ; : "${MAX_TOKENS:=8192}" ; : "${ONLY:=}" ; : "${CONTEXT_PREFIX:=}"
OUTDIR="$HERE/out" ; mkdir -p "$OUTDIR/done"
OUT="$OUTDIR/outputs.jsonl" ; VRAM="$OUTDIR/vram.jsonl"
SAMPLER="$REPO/bench/lib/vram_sampler.py"
TASKS="$HERE/tasks/tasks.jsonl"
# optional: build a tasks file whose prompts are prefixed with a fixed code context (agentic depth)
if [ -n "$CONTEXT_PREFIX" ]; then
  echo "NOTE: CONTEXT_PREFIX=$CONTEXT_PREFIX — prepending to every task prompt (agentic operating point)"
  TASKS="$OUTDIR/tasks-ctx.jsonl"
  python3 - "$HERE/tasks/tasks.jsonl" "$REPO/bench/workloads/generated/$CONTEXT_PREFIX" "$TASKS" <<'PY'
import json,sys
src,ctxf,out=sys.argv[1],sys.argv[2],sys.argv[3]
ctx=open(ctxf).read()
with open(out,"w") as o:
    for l in open(src):
        if not l.strip(): continue
        t=json.loads(l)
        t["prompt"]="[CONTEXT — existing system + code, treat as background]\n"+ctx+"\n\n[TASK]\n"+t["prompt"]
        o.write(json.dumps(t)+"\n")
PY
fi

want () { [ -z "$ONLY" ] && return 0; local g; IFS=',' read -ra gs <<<"$ONLY"; for g in "${gs[@]}"; do case "$1" in $g) return 0;; esac; done; return 1; }

# expand configs.jsonl -> alternating SERVER / SAMPLE lines (tab-separated), in file order
emit () {
python3 - "$HERE/configs.jsonl" <<'PY'
import json,sys
for l in open(sys.argv[1]):
    if not l.strip(): continue
    c=json.loads(l)
    labels=",".join(s["label"] for s in c["samplings"])
    print("\t".join(["SERVER",c["name"],c["model"],str(c["mtp"]),c["kv"],c.get("extra_args",""),labels]))
    for s in c["samplings"]:
        print("\t".join(["SAMPLE",s["label"],str(s["temp"]),str(s["top_p"]),str(s["top_k"])]))
PY
}

CUR_UP=0
stop_cur () { [ "$CUR_UP" = 1 ] && { PORT="$PORT" bash "$SERVE" stop >/dev/null 2>&1 || true; CUR_UP=0; }; }
trap stop_cur EXIT

while IFS=$'\t' read -r kind a b c d e f; do
  if [ "$kind" = SERVER ]; then
    stop_cur
    name="$a"; model="$MODELS_DIR/$b"; mtp="$c"; kv="$d"; xargs="$e"; labels="$f"
    if ! want "$name"; then echo "skip (ONLY): server $name"; SKIP_SRV=1; continue; fi
    SKIP_SRV=0
    # if every sampling label already done, don't even load the model
    alldone=1; IFS=',' read -ra L <<<"$labels"; for lb in "${L[@]}"; do [ -f "$OUTDIR/done/$lb" ] || alldone=0; done
    if [ "$alldone" = 1 ]; then echo "skip (done): server $name — all samplings complete"; SKIP_SRV=1; continue; fi
    [ -f "$model" ] || { echo "MISSING MODEL: $model" | tee -a "$OUTDIR/failures.txt"; SKIP_SRV=1; continue; }
    echo ">>> server $name (mtp=$mtp kv=$kv extra_args='${xargs:-none}')"
    if MODEL="$model" BACKEND="$BACKEND" PORT="$PORT" CTX="$CTX" NP=1 UB="$UB" B="$B" FA=on \
         KV="$kv" MTP="$mtp" EXTRA_ARGS="$xargs" bash "$SERVE" start; then
      CUR_UP=1
      # start a VRAM/power sampler for this server
      csv="$OUTDIR/gpu_$name.csv"; python3 "$SAMPLER" --out "$csv" --interval 0.5 >/dev/null 2>&1 &
      SPID=$!
    else
      echo "SERVER-FAILED: $name" | tee -a "$OUTDIR/failures.txt"; SKIP_SRV=1
    fi
  elif [ "$kind" = SAMPLE ]; then
    [ "${SKIP_SRV:-0}" = 1 ] && continue
    label="$a"; temp="$b"; top_p="$c"; top_k="$d"
    if [ -f "$OUTDIR/done/$label" ]; then echo "  skip (done): $label"; continue; fi
    if ! want "$label" && ! want "${name:-}"; then echo "  skip (ONLY): $label"; continue; fi
    echo "  capture $label (temp=$temp top_p=$top_p top_k=$top_k reps=$REPS)"
    if python3 "$FT/capture.py" --config "$label" --tasks "$TASKS" --out "$OUT" \
         --base-url "http://127.0.0.1:$PORT" --reps "$REPS" --max-tokens "$MAX_TOKENS" \
         --temp "$temp" --top-p "$top_p" --top-k "$top_k"; then
      touch "$OUTDIR/done/$label"
    else echo "  CAPTURE-FAILED: $label" | tee -a "$OUTDIR/failures.txt"; fi
    # fold this server's VRAM/power peaks (once, on the first sampling)
    if [ ! -f "$OUTDIR/.vram_$name" ] && [ -f "$OUTDIR/gpu_$name.csv" ]; then
      python3 - "$name" "$model" "$mtp" "$kv" "$xargs" "$OUTDIR/gpu_$name.csv" >> "$VRAM" <<'PY'
import sys,json,csv
name,model,mtp,kv,xargs,csvf=sys.argv[1:7]
rows=list(csv.DictReader(open(csvf))) if __import__('os').path.exists(csvf) else []
def col(*n):
    for x in n:
        if rows and x in rows[0]: return x
    return None
vc=col('vram_used_mib','vram_mib','used_mib'); gc=col('gtt_used_mib','gtt_mib'); pc=col('power_w','power')
def mx(k):
    v=[float(r[k]) for r in rows if k and r.get(k)]; return max(v) if v else None
def av(k):
    v=[float(r[k]) for r in rows if k and r.get(k)]; return round(sum(v)/len(v),1) if v else None
print(json.dumps({"config":name,"model":model,"mtp":int(mtp),"kv":kv,"extra_args":xargs,
  "peak_vram_used_mib":mx(vc),"peak_gtt_used_mib":mx(gc),"avg_power_w":av(pc),"samples":len(rows)}))
PY
      touch "$OUTDIR/.vram_$name"
    fi
  fi
done < <(emit)
stop_cur

echo "=== deterministic scoring ==="
python3 "$FT/graders/score_deterministic.py" --tasks "$TASKS" --outputs "$OUT" \
  --out "$OUTDIR/scores_deterministic.jsonl" || true
echo "done. Phase B (LLM-judge of the 3 rubric tasks) + Phase C (aggregate/write-up) are Claude's — see README."

#!/usr/bin/env bash
# run_capture.sh — depth driver for the "27B capability + parameter-effects at depth" campaign.
# For each cell in configs.jsonl (model × depth×KV × reasoning-budget), at fixed Qwen3.6-thinking
# sampling (temp 0.6 / top_p 0.95 / top_k 20 / min_p 0): start ONE llama-server, sample VRAM across
# the whole probe, send every TS-TDD task via capture.py (the corpus is a shared cached prefix →
# only the first task per server pays the deep prefill), stop the server. Resumable (per-cell done
# markers), continues past a failed cell. Then batch-grade (real tsc/eslint/vitest) + make charts.
#
# ONE script, no human interaction: capture -> grade (tsc/eslint/vitest) -> blind LLM judge -> charts ->
# auto-write analysis.md via the benchmark-results skill. The judge + summary run `claude` THROUGH tmux
# (headless/background claude is restricted), so a tmux session must exist first:
#     tmux new-session -d -s claude-run       # do this ONCE, then:
#     bash run_capture.sh                     # 10 core cells x 6 matrix tasks x REPS=2, fully automatic
#   ONLY='un-d64*' REPS=1 bash run_capture.sh # subset / quick
#   SMOKE=1 bash run_capture.sh               # also include the 2 easy smoke tasks
#   RUN_OPTIN=1 bash run_capture.sh           # also run the opt-in 16384-budget ceiling cell
#   JUDGE_ENGINE=http JUDGE_BASE_URL=https://host/v1 bash run_capture.sh   # judge via a hosted endpoint
#   JUDGE_ENGINE=none SUMMARY=0 bash run_capture.sh   # capture+grade+charts only (no claude, no tmux)
#   MODELS_DIR=/home/dev/models/gguf bash run_capture.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
SERVE="$REPO/bench/engine-bench/serve_llamacpp.sh"

: "${MODELS_DIR:=/home/dev/models/gguf}"
: "${PORT:=8081}" ; : "${REPS:=2}" ; : "${BACKEND:=vulkan}" ; : "${UB:=2048}" ; : "${B:=4096}"
: "${WAIT:=600}"                       # 128k cold load can take ~3 min
# claude-driven steps (default ON → one script, no human interaction). Both run THROUGH tmux.
: "${JUDGE_ENGINE:=claude-tmux}"       # claude-tmux | http | none
: "${JUDGE_MODEL:=opus}"               # claude-tmux: ORCHESTRATOR model (http: the judge model)
: "${JUDGE_SUBAGENT_MODEL:=haiku}"     # claude-tmux: the blind per-candidate judging subagents (cheap/fast)
: "${SUMMARY:=1}"                      # 1 = auto-write analysis.md via the benchmark-results skill
: "${SUMMARY_MODEL:=opus}"
: "${CLAUDE_TMUX_SESSION:=claude-run}"
export CLAUDE_TMUX_SESSION
OUTDIR="$HERE/out" ; mkdir -p "$OUTDIR/done"
OUT="$OUTDIR/outputs.jsonl" ; VRAM="$OUTDIR/vram.jsonl"

# --- 0. FAIL FAST: the judge/summary run claude through tmux; require the session BEFORE the long
#        capture so we never burn hours only to fail at the judge. ---
need_claude=0
[ "$JUDGE_ENGINE" = "claude-tmux" ] && need_claude=1
[ "$SUMMARY" = "1" ] && need_claude=1
if [ "$need_claude" = 1 ] && ! tmux has-session -t "$CLAUDE_TMUX_SESSION" 2>/dev/null; then
  {
    echo "ERROR: the judge and final-summary run 'claude' THROUGH tmux (headless/background is"
    echo "       restricted), but tmux session '$CLAUDE_TMUX_SESSION' does not exist."
    echo "       Start it once, then re-run this script:"
    echo
    echo "         tmux new-session -d -s $CLAUDE_TMUX_SESSION"
    echo
    echo "       Or disable the claude steps entirely:"
    echo "         JUDGE_ENGINE=none SUMMARY=0 bash run_capture.sh"
  } >&2
  exit 3
fi

# --- 1. build the per-depth task prompts once (shared corpus prefix + per-task rules/spec suffix) ---
build_depth_tasks() {   # $1 = depth label (64k|128k), $2 = target tokens
  local depth="$1" toks="$2" f="$OUTDIR/tasks-$depth.jsonl"
  [ -s "$f" ] && { echo "$f"; return; }
  SMOKE="${SMOKE:-0}" python3 - "$HERE" "$toks" "$f" >&2 <<'PY'
import sys, json, os
here, toks, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
smoke = os.environ.get("SMOKE") == "1"
sys.path.insert(0, here); import build_context
manifest = [json.loads(l) for l in open(os.path.join(here, "tasks.jsonl")) if l.strip()]
tasks = [t for t in manifest if smoke or t.get("matrix", True)]   # easy tasks (matrix:false) are smoke-only
with open(out, "w") as fo:
    for t in tasks:
        prompt = build_context.build(os.path.join(here, "ts-harness", "tasks", t["id"]), toks)
        fo.write(json.dumps({"id": t["id"], "type": "ts-tdd", "category": t["tier"],
                             "prompt": prompt}) + "\n")
print(f"built {out} ({len(tasks)}/{len(manifest)} tasks @ ~{toks} tok; smoke={smoke})")
PY
  echo "$f"
}

vram_used_mib() { rocm-smi --showmeminfo vram 2>/dev/null \
  | awk -F: '/VRAM Total Used/ {gsub(/ /,"",$NF); printf "%d", $NF/1048576}'; }

# --- 2. per-cell probe loop (configs.jsonl → pipe-delimited fields) ---
python3 -c '
import json,sys
for l in open(sys.argv[1]):
    if not l.strip(): continue
    c=json.loads(l)
    print("|".join(str(c.get(k,"")) for k in
      ["label","model","mtp","kv","depth","tokens","ctx","budget","temp","top_p","top_k","min_p","role","optin"]))
' "$HERE/configs.jsonl" | while IFS='|' read -r label model mtp kv depth tokens ctx budget temp top_p top_k min_p role optin; do
  [ -n "${ONLY:-}" ] && [[ "$label" != ${ONLY} ]] && { echo "skip (ONLY): $label"; continue; }
  [ "$optin" = "True" ] && [ "${RUN_OPTIN:-0}" != "1" ] && { echo "skip (opt-in, set RUN_OPTIN=1): $label"; continue; }
  [ -f "$OUTDIR/done/$label" ] && { echo "skip (done): $label"; continue; }
  mfile="$MODELS_DIR/$model"
  [ -f "$mfile" ] || { echo "MISSING MODEL, skipping: $mfile" | tee -a "$OUTDIR/failures.txt"; continue; }
  tasks_file=$(build_depth_tasks "$depth" "$tokens")
  max_tokens=$(( budget + 8192 ))     # thinking(≤budget) + answer headroom

  echo "=== $label  ($role: ${model%%.gguf} mtp=$mtp kv=$kv depth=$depth budget=$budget) ==="
  t0=$(date +%s)
  if MODEL="$mfile" BACKEND="$BACKEND" PORT="$PORT" CTX="$ctx" NP=1 UB="$UB" B="$B" FA=on \
       KV="$kv" MTP="$mtp" WAIT="$WAIT" EXTRA_ARGS="--reasoning-budget $budget" bash "$SERVE" start; then
    load_s=$(( $(date +%s) - t0 )); used=$(vram_used_mib)
    echo "  VRAM at load: ${used} MiB  (load ${load_s}s)"
    curl -s -m 10 "http://127.0.0.1:$PORT/props" > "$OUTDIR/props_${label}.json" 2>/dev/null || true
    msize=$(stat -c%s "$mfile" 2>/dev/null || echo 0)
    csv="$OUTDIR/gpu_${label}.csv"; SPID=""
    if command -v rocm-smi >/dev/null 2>&1; then
      python3 "$REPO/bench/lib/vram_sampler.py" --out "$csv" --interval 1 & SPID=$!
      for _ in 1 2 3 4; do [ -s "$csv" ] && [ "$(wc -l <"$csv")" -ge 2 ] && break
        kill -0 "$SPID" 2>/dev/null || break; sleep 0.5; done
    fi
    python3 "$HERE/../2026-07-12-27b-finetune-quality/capture.py" --config "$label" \
      --tasks "$tasks_file" --out "$OUT" --base-url "http://127.0.0.1:$PORT" \
      --reps "$REPS" --max-tokens "$max_tokens" \
      --temp "$temp" --top-p "$top_p" --top-k "$top_k" --min-p "$min_p" \
      && touch "$OUTDIR/done/$label"
    [ -n "$SPID" ] && { kill "$SPID" 2>/dev/null; wait "$SPID" 2>/dev/null || true; }
    python3 - "$label" "$model" "$mtp" "$ctx" "$kv" "$budget" "$depth" "$used" "$csv" "$load_s" "$msize" >> "$VRAM" <<'PY'
import sys, json, re
label, model, mtp, ctx, kv, budget, depth, used, csv, load_s, msize = sys.argv[1:12]
row = {"config": label, "model": model, "mtp": int(mtp), "ctx": int(ctx), "kv": kv,
       "budget": int(budget), "depth": depth, "vram_used_mib_at_load": int(used),
       "load_time_s": int(load_s), "model_size_bytes": int(msize),
       "weights_gib": round(int(msize) / 2**30, 2)}
try:
    summ = [l for l in open(csv) if l.startswith("#")][-1]
    for k, v in re.findall(r"(\w+)=([\d.]+)", summ):
        row[k] = float(v) if "." in v else int(v)
except Exception as e:
    row["sampler_note"] = str(e)
print(json.dumps(row))
PY
  else
    echo "SERVER FAILED to start: $label" | tee -a "$OUTDIR/failures.txt"
  fi
  PORT="$PORT" bash "$SERVE" stop || true
  sleep 2
done

# --- 3. grade every captured reply with the real toolchain ---
echo; echo "=== grading (tsc + eslint + vitest, per reply) ==="
python3 "$HERE/score_typescript.py" batch --outputs "$OUT" --tasks "$HERE/tasks.jsonl" \
  --out "$OUTDIR/scores_typescript.jsonl" || true

# --- 4. blind LLM judge (subjective design/clarity/robustness the toolchain can't grade) ---
# 27B is the strongest LOCAL model, so it can't judge itself — the judge is Claude via the tmux gateway
# (JUDGE_ENGINE=claude-tmux, default), or any stronger OpenAI-compatible endpoint (JUDGE_ENGINE=http +
# JUDGE_BASE_URL). Both save the full prompt+raw reply (judge_raw.jsonl) AND parsed scores. Rubric: JUDGE.md.
case "$JUDGE_ENGINE" in
  claude-tmux)
    echo; echo "=== blind judge: ONE claude session fans out $JUDGE_SUBAGENT_MODEL subagents (orchestrator=$JUDGE_MODEL) ==="
    python3 "$HERE/judge.py" --engine claude-tmux --outputs "$OUT" --tasks "$HERE/tasks.jsonl" \
      --model "$JUDGE_MODEL" --subagent-model "$JUDGE_SUBAGENT_MODEL" \
      --out "$OUTDIR/judge_scores.jsonl" --raw "$OUTDIR/judge_raw.jsonl" \
      || echo "judge step failed (see above / JUDGE.md)" ;;
  http)
    echo; echo "=== blind judge via HTTP (${JUDGE_BASE_URL:-UNSET}) ==="
    python3 "$HERE/judge.py" --engine http --outputs "$OUT" --tasks "$HERE/tasks.jsonl" \
      --base-url "${JUDGE_BASE_URL:-}" --model "${JUDGE_MODEL:-}" \
      --out "$OUTDIR/judge_scores.jsonl" --raw "$OUTDIR/judge_raw.jsonl" || echo "judge step failed" ;;
  *) echo; echo "=== judge SKIPPED (JUDGE_ENGINE=$JUDGE_ENGINE) — see JUDGE.md ===" ;;
esac

echo; echo "=== charts (reused by the benchmark-results skill) ==="
ORDER="$(python3 -c 'import json,sys;print(",".join(json.loads(l)["label"] for l in open(sys.argv[1]) if l.strip()))' "$HERE/configs.jsonl")"
python3 "$REPO/campaigns/2026-07-12-27b-finetune-quality/make_charts.py" --dir "$OUTDIR" --charts "$HERE/charts" \
  --order "$ORDER" --calibration "$HERE/calibration.jsonl,$HERE/calibration-hard.jsonl" \
  || echo "make_charts failed (see above)"

# --- 5. deterministic digest: aggregate.py crunches ALL the numbers in Python (per-cell table +
#        the 4 campaign questions answered numerically) so the analysis LLM never touches bulk JSON. ---
echo; echo "=== aggregate (deterministic digest → out/summary.md) ==="
python3 "$HERE/aggregate.py" --dir "$OUTDIR" --out "$OUTDIR/summary.md" || echo "aggregate failed (see above)"

# --- 6. auto-write analysis.md via the benchmark-results skill (interactive claude, through tmux) ---
# claude_ask.sh opens an interactive claude in tmux and TYPES the request (no headless -p); claude runs
# the skill, writes analysis.md, then writes a short confirmation to the result file to signal it's done.
# The prompt points ONLY at the deterministic digest + charts — NOT the per-reply jsonl (outputs.jsonl
# is 120 full replies incl. thinking). The model's job is prose synthesis, not aggregation.
if [ "$SUMMARY" = "1" ]; then
  echo; echo "=== final analysis (benchmark-results skill via interactive claude/tmux, model=$SUMMARY_MODEL) ==="
  sp="$OUTDIR/summary_prompt.txt"
  cat > "$sp" <<EOF
You are finishing benchmark Campaign 3 in this repo. Follow the repo's benchmark-results skill
(read .claude/skills/benchmark-results/SKILL.md) and write the analysis to
campaigns/2026-07-13-27b-quality-at-depth/analysis.md.

ALL the numbers are ALREADY aggregated deterministically — read ONLY these two files:
  - campaigns/2026-07-13-27b-quality-at-depth/out/summary.md   (per-cell table + the 4 findings, computed in Python)
  - campaigns/2026-07-13-27b-quality-at-depth/charts/appendix.md  (charts to embed + a data table)
DO NOT read outputs.jsonl / scores_typescript.jsonl / judge_scores.jsonl — they are large per-reply logs
and everything you need is already in summary.md. For design context/glossary you may skim README.md and
eval-design.md.

Write analysis.md to the skill's contract: TL;DR + results TABLE FIRST (a memory column is MANDATORY),
then detail. Every number you cite comes from summary.md/appendix.md — tag them MEASURED, and mark any
reasoning INFERRED; invent nothing. Cover the 4 campaign questions exactly as summary.md's "Findings"
lists them: (a) budget optimum vs depth, (b) 64k->128k rule-adherence/reuse (lost-in-the-middle), (c) KV
f16-vs-q8 @128k (<=5% rule), (d) capability vs haiku/Sonnet/Opus. Embed charts/appendix.md. Include a
<!-- meta --> block (see docs/analysis/ examples) so docs/reindex.py can register it. If summary.md's
Health line flags failures/runaways/GTT spill, surface them.

This task is complete once analysis.md is fully written. Your final answer (the result file the harness
asks for) is just a one-line confirmation, e.g. "analysis.md written (N cells)".
EOF
  bash "$HERE/claude_ask.sh" --prompt "$sp" --result "$OUTDIR/summary_result.txt" \
    --cwd "$REPO" --model "$SUMMARY_MODEL" --permission-mode acceptEdits \
    && echo "  analysis.md written by claude" \
    || echo "  summary step failed (see $OUTDIR/summary_result.txt.err)"
  # reindex is deterministic — do it here, not via the model
  python3 "$REPO/docs/reindex.py" 2>/dev/null && echo "  docs/INDEX.md reindexed" || echo "  (reindex skipped)"
fi

echo; echo "Depth run complete."
echo "  replies:  $OUT"
echo "  scores:   $OUTDIR/scores_typescript.jsonl   judge: $OUTDIR/judge_scores.jsonl"
echo "  VRAM:     $VRAM   (gpu samples: $OUTDIR/gpu_*.csv)"
echo "  charts:   $HERE/charts/"
echo "  analysis: $HERE/analysis.md   (auto-written; review before committing run data)"

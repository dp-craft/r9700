#!/usr/bin/env bash
# run_capture.sh — model driver for "Ornith-1.0-35B vs Gemma-4-31B-it-qat at 128k" (copied from the
# 2026-07-14-hardest-tasks harness; SAME TS-TDD tasks + real tsc/eslint/vitest grader + self-check).
# Two cells (configs.jsonl): ornith (qwen35moe, MTP off) and gemma (gemma4 dense, MTP off). Deterministic
# by default (JUDGE_ENGINE=none, SUMMARY=0) — no tmux/claude needed; write analysis.md via /benchmark-results.
# For each cell in configs.jsonl (model/quant, fixed depth×KV×reasoning-budget), at fixed Qwen3.6-thinking
# sampling (temp 0.6 / top_p 0.95 / top_k 20 / min_p 0): start ONE llama-server, sample VRAM across
# the whole probe, send every TS-TDD task via capture.py (the corpus is a shared cached prefix →
# only the first task per server pays the deep prefill), stop the server. Resumable at TWO levels:
# per-cell done markers here, AND row-level in capture.py ((config,task,rep) rows already in
# outputs.jsonl are never re-captured or duplicated — so deleting a done marker after a partial/
# lower-REPS run only captures what's missing). Continues past a failed cell. Then batch-grade
# (real tsc/eslint/vitest) + make charts.
#
# ONE script, no human interaction: capture -> grade (tsc/eslint/vitest) -> blind LLM judge -> charts ->
# auto-write analysis.md via the benchmark-results skill. The judge + summary run `claude` THROUGH tmux
# (headless/background claude is restricted), so a tmux session must exist first:
#     tmux new-session -d -s claude-run       # do this ONCE, then:
#     bash run_capture.sh                     # 5 model cells x 4 hardest tasks x REPS=3 = 60 replies, automatic
#   ONLY='q6-*' REPS=1 bash run_capture.sh    # subset / quick (e.g. isolate the heavy Q6_K)
#   SMOKE=1 bash run_capture.sh               # also include the matrix:false reference/smoke tasks
#   CONFIGS=$PWD/configs_sampling.jsonl JUDGE_ENGINE=none SUMMARY=0 bash run_capture.sh  # add-on C: sampling sweep
#   JUDGE_ENGINE=http JUDGE_BASE_URL=https://host/v1 bash run_capture.sh   # judge via a hosted endpoint
#   JUDGE_ENGINE=none SUMMARY=0 bash run_capture.sh   # capture+grade+charts only (no claude, no tmux)
#   MODELS_DIR=/home/dev/models/gguf bash run_capture.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
SERVE="$REPO/bench/engine-bench/serve_llamacpp.sh"

: "${MODELS_DIR:=/home/dev/models/gguf}"
: "${CONFIGS:=$HERE/configs.jsonl}"    # override to run a sweep, e.g. CONFIGS=configs_sampling.jsonl (add-on C)
# Reference ladder (haiku/sonnet/opus), collected by run_refs.sh: 3 reps per (model, task), rows carry
# `rep` → aggregate reports mean±sd and hard_pass as k/n instead of an n=1 point estimate.
# ONE variable feeds BOTH consumers on purpose: aggregate.py builds summary.md's reference rows and
# make_charts.py draws the reference BANDS on the SVGs from their own separate reads. They were wired to
# different sources (make_charts hardcoded the legacy calibration{,-hard}.jsonl; aggregate had no flag at
# all and silently defaulted to them) — which would print a 3-rep table beside an n=1 dashed line and call
# them the same reference.
# Do NOT merge the legacy files in: they hold n=1 rows for these same (model, task) pairs, so a pair would
# silently gain a fourth rep of different provenance. Legacy rows cover OTHER tasks and stay where they are.
: "${CALIB:=$HERE/calibration-reps.jsonl}"
: "${PORT:=8081}" ; : "${REPS:=3}" ; : "${BACKEND:=vulkan}" ; : "${UB:=2048}" ; : "${B:=4096}"
: "${WAIT:=600}"                       # 128k cold load can take ~3 min
# claude-driven steps (default ON → one script, no human interaction). Both run THROUGH tmux.
: "${JUDGE_ENGINE:=none}"              # claude-tmux | http | none  (scaffold default: none — set claude-tmux to judge)
: "${JUDGE_MODEL:=opus}"               # claude-tmux: ORCHESTRATOR model (http: the judge model)
: "${JUDGE_SUBAGENT_MODEL:=opus}"      # claude-tmux: model of the blind judging subagents. STRONG single
                                       # judge (opus) — it reviews opus-tier design/robustness, and one
                                       # model keeps the 0-5 scale consistent. 'sonnet' = cheaper; not haiku.
: "${SUMMARY:=0}"                      # scaffold default: 0. Write analysis.md via /benchmark-results after review. Set 1 to auto-draft.
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
  # Cache is valid ONLY if it holds exactly the task ids the manifest expects. The old check was a
  # bare `[ -s "$f" ]`, so ADDING a task to tasks.jsonl silently reused the stale prompt file and the
  # new task was never captured at all.
  if [ -s "$f" ] && SMOKE="${SMOKE:-0}" python3 - "$HERE" "$f" 2>/dev/null <<'PY'
import sys, json, os
here, cache = sys.argv[1], sys.argv[2]
smoke = os.environ.get("SMOKE") == "1"
manifest = [json.loads(l) for l in open(os.path.join(here, "tasks.jsonl")) if l.strip()]
want = {t["id"] for t in manifest if smoke or t.get("matrix", True)}
have = {json.loads(l)["id"] for l in open(cache) if l.strip()}
sys.exit(0 if want == have else 1)
PY
  then echo "$f"; return; fi
  SMOKE="${SMOKE:-0}" python3 - "$HERE" "$toks" "$f" >&2 <<'PY'
import sys, json, os
here, toks, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
smoke = os.environ.get("SMOKE") == "1"
sys.path.insert(0, here); import build_context
manifest = [json.loads(l) for l in open(os.path.join(here, "tasks.jsonl")) if l.strip()]
tasks = [t for t in manifest if smoke or t.get("matrix", True)]   # easy tasks (matrix:false) are smoke-only
with open(out, "w") as fo:
    for t in tasks:
        # A task may pin its OWN prompt size via `"tokens": N` in tasks.jsonl (pricing-deferred needs
        # ~85k so that prompt + up to 32,768 thinking + answer still fits ctx 163840). Without this
        # every task was forced to the cell's depth, which would have made unlimited reasoning
        # truncate. Depth differing per task is not a confound: Δ is paired BY TASK, and every cell
        # runs a given task identically.
        tt = int(t.get("tokens", toks))
        prompt = build_context.build(os.path.join(here, "ts-harness", "tasks", t["id"]), tt)
        fo.write(json.dumps({"id": t["id"], "type": "ts-tdd", "category": t["tier"],
                             "prompt": prompt}) + "\n")
        if tt != toks:
            print(f"  {t['id']}: pinned to ~{tt} tok (cell depth is ~{toks})")
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
    # presence_penalty before role/optin: Qwen ties pp to the temperature PRESET, so a vendor preset
    # cell (temp 1.0 + pp 1.5) is NOT reproducible without it — without this column those cells would
    # silently collapse into the plain temp-1.0 cell and fake a "preset ≈ temp" finding.
    print("|".join(str(c.get(k,"")) for k in
      ["label","model","mtp","kv","depth","tokens","ctx","budget","temp","top_p","top_k","min_p","presence_penalty","role","optin"]))
' "$CONFIGS" | while IFS='|' read -r label model mtp kv depth tokens ctx budget temp top_p top_k min_p presence_penalty role optin; do
  [ -n "${ONLY:-}" ] && [[ "$label" != ${ONLY} ]] && { echo "skip (ONLY): $label"; continue; }
  [ "$optin" = "True" ] && [ "${RUN_OPTIN:-0}" != "1" ] && { echo "skip (opt-in, set RUN_OPTIN=1): $label"; continue; }
  mfile="$MODELS_DIR/$model"
  [ -f "$mfile" ] || { echo "MISSING MODEL, skipping: $mfile" | tee -a "$OUTDIR/failures.txt"; continue; }
  tasks_file=$(build_depth_tasks "$depth" "$tokens")

  # A cell is done only when every (task, rep) it owes is already captured — derived from the DATA,
  # not from a marker. capture.py has row-level resume, so an INCOMPLETE cell (a task added to
  # tasks.jsonl after this cell ran) only pays for the MISSING replies. The old marker-only check
  # short-circuited before capture.py ever ran, so a newly added task could never be backfilled and
  # the grid stayed ragged (old cells 4 tasks, new cells 5).
  need=$(( $(grep -c . "$tasks_file") * REPS ))
  have=$(python3 - "$OUT" "$label" <<'PY'
import sys, json, os
out, label = sys.argv[1], sys.argv[2]
n = 0
if os.path.exists(out):
    for l in open(out):
        if not l.strip():
            continue
        r = json.loads(l)
        if r.get("config") == label and not r.get("error") and r.get("response"):
            n += 1
print(n)
PY
)
  [ "$have" -ge "$need" ] && { echo "skip (complete: $label — $have/$need replies)"; continue; }
  [ "$have" -gt 0 ] && echo "resume: $label — $have/$need already captured, running the rest"
  # --reasoning-budget semantics, MEASURED from our own b9950 `--help` (docs/research/2026-07-15-1000-*):
  #   -1 = unrestricted · 0 = IMMEDIATE END (not "uncapped": the old comment here was wrong) · N>0 = budget.
  # For -1 the cap must be generous or "unlimited" is not unlimited (it used to fall to 16384, which
  # would have silently capped the whole point of the cell). 40960 covers Qwen's 32768 recommendation
  # plus an answer; where ctx has less headroom the server stops at the wall and the truncation IS the
  # measurement.
  if [ "$budget" -gt 0 ]; then max_tokens=$(( budget + 8192 ))
  elif [ "$budget" -lt 0 ]; then max_tokens=40960
  else max_tokens=8192; fi

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
      ${presence_penalty:+--presence-penalty "$presence_penalty"} \
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
# GRADER SELF-CHECK (the fix): PROVE vitest actually runs in this environment before trusting any
# grade. selftest runs tsc+eslint+vitest on reference fixtures and asserts good>mediocre>bad. If it
# fails (e.g. vitest can't spawn under memory pressure — the bug that voided the previous run), ABORT
# loudly instead of recording silent zeros.
echo; echo "=== grader self-check (vitest must run) ==="
if ! python3 "$HERE/score_typescript.py" selftest; then
  echo "GRADER SELF-CHECK FAILED — vitest is not running correctly here; refusing to grade" >&2
  echo "(would silently zero tests+edge). Free host memory / reboot the box, then re-run grading:" >&2
  echo "  python3 $HERE/score_typescript.py batch --outputs $OUT --tasks $HERE/tasks.jsonl --out $OUTDIR/scores_typescript.jsonl" >&2
  exit 4
fi
echo; echo "=== grading (tsc + eslint + vitest, per reply) ==="
# --resume: reuse rows already graded (keyed config/task_id/rep) so an INCREMENTAL run (new cells
# appended to configs.jsonl) only pays tsc+eslint+vitest for the NEW replies. Output is rewritten in
# outputs.jsonl order and is byte-identical to a full re-grade; grade_error rows are always retried.
# Set REGRADE=1 to force a full re-grade (e.g. after changing the grader itself).
python3 "$HERE/score_typescript.py" batch --outputs "$OUT" --tasks "$HERE/tasks.jsonl" \
  --out "$OUTDIR/scores_typescript.jsonl" $([ "${REGRADE:-0}" = "1" ] || echo --resume) || true

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
ORDER="$(python3 -c 'import json,sys;print(",".join(json.loads(l)["label"] for l in open(sys.argv[1]) if l.strip()))' "$CONFIGS")"
python3 "$REPO/campaigns/2026-07-12-27b-finetune-quality/make_charts.py" --dir "$OUTDIR" --charts "$HERE/charts" \
  --order "$ORDER" --calibration "$CALIB" \
  || echo "make_charts failed (see above)"

# --- 5. deterministic digest: aggregate.py crunches ALL the numbers in Python (per-cell table +
#        the 4 campaign questions answered numerically) so the analysis LLM never touches bulk JSON. ---
echo; echo "=== aggregate (deterministic digest → out/summary.md) ==="
# --by-task also emits out/summary_by_task.json, which the per-task charts below consume. It was
# missing here, so summary_by_task.json was only ever written by hand — that is exactly how
# charts/detailed/ ended up built from a pre-correction aggregate (2026-07-15). Data first, charts after.
python3 "$HERE/aggregate.py" --dir "$OUTDIR" --by-task --out "$OUTDIR/summary.md" \
  --calib-files "$CALIB" || echo "aggregate failed (see above)"

# Per-task charts LAST: they read out/summary_by_task.json, so they MUST run after aggregate --by-task.
# Wired in deliberately — running them by hand is what let charts/detailed/ drift behind the data.
echo; echo "=== per-task charts (charts/detailed/) ==="
python3 "$HERE/make_charts_detailed.py" --dir "$OUTDIR" --charts "$HERE/charts/detailed" \
  --scores scores_typescript.jsonl --orig scores_typescript.jsonl \
  || echo "make_charts_detailed failed (see above)"

# --- 6. auto-write analysis.md via the benchmark-results skill (interactive claude, through tmux) ---
# claude_ask.sh opens an interactive claude in tmux and TYPES the request (no headless -p); claude runs
# the skill, writes analysis.md, then writes a short confirmation to the result file to signal it's done.
# The prompt points ONLY at the deterministic digest + charts — NOT the per-reply jsonl (outputs.jsonl
# is 60 full replies incl. thinking). The model's job is prose synthesis, not aggregation.
if [ "$SUMMARY" = "1" ]; then
  echo; echo "=== final analysis (benchmark-results skill via interactive claude/tmux, model=$SUMMARY_MODEL) ==="
  sp="$OUTDIR/summary_prompt.txt"
  cat > "$sp" <<'EOF'
You are finishing the "Ornith-1.0-35B vs Gemma-4-31B-it-qat at 128k" benchmark in this repo. Follow the
repo's benchmark-results skill (read .claude/skills/benchmark-results/SKILL.md) and write the analysis to
campaigns/2026-07-19-ornith-vs-gemma/analysis.md.

ALL the numbers are ALREADY aggregated deterministically — read ONLY:
  - campaigns/2026-07-19-ornith-vs-gemma/out/summary.md        (per-cell table + PER-REP detail + findings)
  - campaigns/2026-07-19-ornith-vs-gemma/charts/appendix.md    (cell-level charts + data table)
  - campaigns/2026-07-19-ornith-vs-gemma/charts/detailed/appendix.md  (per-task charts, if present)
DO NOT read outputs.jsonl / scores_*.jsonl — large per-reply logs; everything you need is in summary.md.
For design context you may skim README.md, eval-design.md, and docs/research/2026-07-19-1821-ornith-35b-gemma-4-31b-configs.md.

Write analysis.md to the skill's contract: TL;DR + results TABLE FIRST (a memory column is MANDATORY),
then detail. Every number comes from summary.md/appendix.md — tag MEASURED, mark reasoning INFERRED,
invent nothing. Read the cell matrix from configs.jsonl / summary.md, never from this prompt.

This is a TWO-MODEL comparison at ONE substrate (Vulkan · f16 KV · ub2048/b4096/fa on · ctx 163840 ·
depth ~120k · reasoning-budget 4096 · MTP OFF both). The two cells differ in model AND sampler (Ornith =
Qwen coding temp 0.6/top_k 20; Gemma = temp 1.0/top_k 64 — the vendor-recommended recipe for each, so the
comparison is "each model at its own recommended sampler", NOT a controlled sampler test — say so). Answer:
(a) quality per task on the TS-TDD suite (tsc + eslint + vitest; lint/types are FRACTIONAL error-count based),
(b) each local model vs the haiku/sonnet/opus reference ladder (per-task tier), (c) speed vs quality
(prefill/decode tok/s, think tokens, time-to-answer), (d) memory: VRAM/GTT at ctx 163840 — Gemma is UNGUARDED
(gguf_kv can't size gemma4), so its MEASURED VRAM is a first-class result; if summary.md's Health flags GTT
spill or grade_error/HARNESS rows or runaways, surface them prominently.

GEMMA CAVEAT (MANDATORY to check + report): Gemma's thinking format is <|channel>thought…<channel|>, NOT
<think>…</think>. capture.py splits on <think>, so Gemma's think/answer split (and think_tokens) may be WRONG.
State explicitly whether the split looked correct for Gemma (inspect a sample in outputs.jsonl if unsure) and
caveat any Gemma think-token/ttfa number accordingly.

UNCERTAINTY (MANDATORY — n=3 reps, 2 cells, ~9 tasks is UNDERPOWERED): read the "Uncertainty" section of
summary.md and quote sd/SE/CI and any paired test verbatim. Do NOT call a model "better"/"worse" unless a
paired Δ clears the significance threshold PRINTED in the table; report every comparison's verdict plainly,
name underpowering as the top limitation, recommend more tasks over more reps.

REFERENCE COMPARABILITY: the haiku/sonnet/opus references are one-shot on ~550-620 token prompts vs the local
cells' ~120k tokens (~200x deeper) — never state a bare local-vs-reference Δ as a like-for-like capability gap;
name both sides.

PER-REP DETAIL (MANDATORY): summary.md ends with per-task tables listing EVERY local rep + the reference
ladder — INLINE them verbatim under a "Per-rep results" section; do not collapse to means.

Include a <!-- meta --> block so docs/reindex.py can register it. This task is complete once analysis.md
is written; your final answer is a one-line confirmation, e.g. "analysis.md written (2 cells)".
EOF
  bash "$HERE/claude_ask.sh" --prompt "$sp" --result "$OUTDIR/summary_result.txt" \
    --cwd "$REPO" --model "$SUMMARY_MODEL" --permission-mode bypassPermissions \
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

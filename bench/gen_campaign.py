#!/usr/bin/env python3
"""Deterministic campaign scaffolder for the R9700 benchmark harness.

Turns a small JSON *spec* (which servers to launch, which probes to run against each)
into a **resumable** `run.sh` plus a README skeleton under
`campaigns/<date>-<slug>/` (project root). The judgement (which depths, MTP/KV matrix, VRAM
budget) is expected to come from the `benchmark-new-campaign` skill or from you; this tool only
emits the mechanical, reproducible driver. The emitted run.sh CONTINUES on a server start
failure, and (if the spec carries a `vram` block) SKIPS before launch any server predicted to
exceed the VRAM budget — GPU/VRAM-only, never spilling to system RAM. It is safe to run by hand.

Subcommands
-----------
  emit --spec SPEC.json [--force] [--print]
        Generate campaigns/<date>-<slug>/{run.sh, README.md|plan.md}. run.sh is always
        (re)written; the doc is written only if absent (never clobbers a hand-written one).
        The spec's `kind` selects the driver:
          "throughput" (default) — servers × probes matrix; emits README.md; drives
              capture_engine `probe` (cross-engine tok/s, concurrency, depth).
          "quality" — configs (model × MTP) × task-suite; emits plan.md; drives capture_engine
              `tasks` (quality + token economy) + deterministic scoring + an in-session judge.
              See `example --quality` for the schema (configs[], tasks, ctx/kv, models_dir).
  vram-ctx --weights-gib G --kv-kib-per-tok K --budget-mib M [--np N]
        Deterministic VRAM→max-context helper (the math behind the deep-context campaign).
  example [--quality]
        Print a minimal example spec (throughput, or quality) to stdout.

Spec schema (JSON)
------------------
{
  "slug": "deep-context",             # required; campaign dir = <date>-<slug>
  "date": "2026-07-11",               # optional (default: today)
  "title": "Deep-context campaign",   # optional (README H1)
  "notes": ["free-text lines emitted as # NOTE: comments at the top of run.sh"],  # optional

  "model": "/abs/path/model.gguf",    # required
  "backend": "vulkan",                # rocm|vulkan  (engine URL/port wiring)
  "port": 8081,                       # server port (must match backend's engine URL)
  "tuning": {"ub": 2048, "b": 4096, "fa": "on"},
  "vram": {                           # OPTIONAL but recommended: enables the pre-flight guard
    "weights_gib": 15.01,             #   model weights resident in VRAM
    "kv_kib_per_tok": {"f16": 260, "q8_0": 138},  # per KV type (or a single number)
    "budget_mib": 32400,              #   guard threshold; keep < physical VRAM (32624) → VRAM-only
    "overhead_mib": 700               #   non-KV compute buffers (default 700)
  },
  "servers": [
    {"name": "single-mtp0", "ctx": 262144, "np": 1, "kv": "f16", "mtp": 0,
     "probes": [
       {"slug": "deep-mtp0-cr8000", "prompts": ["codereview-8000.txt"],
        "max_tokens": 256, "api": "completions", "concurrency": 1, "reps": 2,
        "prefix_mode": "unique"}
     ]}
  ]
}
Probe defaults: max_tokens 256, api "completions", concurrency 1, reps 2, prefix_mode "unique".
Each probe SLUG must be unique in the campaign (the driver globs its run dir by that slug).
"""
import sys, os, json, argparse, datetime, stat

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND_PORT = {"rocm": 8080, "vulkan": 8081}


def sh_quote(s):
    return "'" + str(s).replace("'", "'\\''") + "'"


def predict_vram_mib(spec, srv):
    """Emit-time VRAM prediction for a server (weights + KV@ctx + compute overhead).
    Returns int MiB, or -1 if it cannot be computed (no `vram` block, or the server's KV type is
    absent from kv_kib_per_tok) — the guard then can't act on that server."""
    v = spec.get("vram")
    if not v or "weights_gib" not in v or "kv_kib_per_tok" not in v:
        return -1
    kk = v["kv_kib_per_tok"]
    if isinstance(kk, dict):
        if srv["kv"] not in kk:
            return -1
        kv_kib = float(kk[srv["kv"]])
    else:
        kv_kib = float(kk)
    weights_mib = float(v["weights_gib"]) * 1024
    overhead_mib = float(v.get("overhead_mib", 700))
    kv_mib = kv_kib / 1024.0 * int(srv["ctx"])   # -c is TOTAL context; KV is np-independent
    return int(round(weights_mib + overhead_mib + kv_mib))


def emit_runsh(spec):
    if spec.get("kind") == "quality":
        return emit_quality_runsh(spec)
    slug = spec["slug"]
    date = spec.get("date") or datetime.date.today().isoformat()
    backend = spec.get("backend", "vulkan")
    port = spec.get("port") or BACKEND_PORT.get(backend, 8080)
    tune = spec.get("tuning", {})
    ub, b, fa = tune.get("ub", 2048), tune.get("b", 4096), tune.get("fa", "on")
    engine_name = f"llamacpp-{backend}" if backend in BACKEND_PORT else backend
    v = spec.get("vram") or {}
    default_budget = int(v.get("budget_mib", 32400))   # < physical VRAM (32624 MiB) → VRAM-only

    L = []
    ad = L.append
    ad("#!/usr/bin/env bash")
    ad(f"# GENERATED by bench/gen_campaign.py — campaign '{slug}'. Resumable: rerun to continue")
    ad("# after an interruption (per-probe markers in <campaign>/done/). Edit the spec and")
    ad("# regenerate. Behaviour baked in (no hand-editing needed):")
    ad("#   * CONTINUE-ON-FAILURE: a server that fails to start is recorded and the run moves on.")
    ad("#   * PRE-FLIGHT VRAM GUARD: a server whose predicted VRAM > VRAM_BUDGET_MIB is SKIPPED")
    ad("#     before launch → GPU/VRAM-only, never spills to system RAM (no GTT thrash / freeze).")
    ad("#   * SUBSET / SHORT runs: ONLY='glob,..' picks probes; REPS=/MAX_TOKENS= shorten a pass.")
    notes = spec.get("notes")
    if notes:
        ad("#")
        for line in ([notes] if isinstance(notes, str) else notes):
            ad(f"# NOTE: {line}")
    ad("set -uo pipefail")
    ad('ROOT="${ROOT:-' + REPO + '}"')
    ad(f'CAMPAIGN_DIR="${{CAMPAIGN_DIR:-$ROOT/bench/runs/{date}-{slug}}}"')
    ad('EB="$ROOT/bench/engine-bench"')
    ad('GEN="$ROOT/bench/workloads/generated"')
    ad(f'export MODEL={sh_quote(spec["model"])}')
    ad(f'export ENGINES_LIST="{engine_name}|http://localhost:{port}/v1|local"')
    ad("# --- run-time knobs (override on the command line) ---")
    ad(f'VRAM_BUDGET_MIB="${{VRAM_BUDGET_MIB:-{default_budget}}}"  # guard: skip servers predicted above this')
    ad('ONLY="${ONLY:-}"                 # comma-separated slug globs; empty = all probes')
    ad('REPS_OVERRIDE="${REPS:-}"        # override every probe\'s reps (quick pass)')
    ad('MAXTOK_OVERRIDE="${MAX_TOKENS:-}"  # override every probe\'s max_tokens')
    ad('mkdir -p "$CAMPAIGN_DIR/done"')
    ad('if [ ! -f "$CAMPAIGN_DIR/meta.txt" ]; then')
    ad('  { echo "date=$(date -Iseconds)"; echo "model=$MODEL"; '
       f'echo "backend={backend}"; echo "tuning=ub{ub} b{b} fa{fa}"; '
       'echo "vram_budget_mib=$VRAM_BUDGET_MIB"; } > "$CAMPAIGN_DIR/meta.txt"')
    ad('fi')
    ad("")
    ad("server_needed () {  # any listed probe marker missing?")
    ad('  local s; for s in "$@"; do [ -f "$CAMPAIGN_DIR/done/$s" ] || return 0; done; return 1; }')
    ad("")
    ad("want_probe () {  # honor ONLY='glob,glob' filter")
    ad('  [ -z "$ONLY" ] && return 0')
    ad('  local g; IFS="," read -ra _globs <<<"$ONLY"')
    ad('  for g in "${_globs[@]}"; do case "$1" in $g) return 0;; esac; done; return 1; }')
    ad("")
    ad("probes_selected () {  # 0 if ONLY matches >=1 of this server's probes (don't load a model")
    ad('  local s; for s in "$@"; do want_probe "$s" && return 0; done; return 1; }  # for filtered-out probes')
    ad("")
    ad("guard_ok () {  # name predicted_mib -> 0 if within budget (or unknown), else record SKIPPED")
    ad('  local name=$1 pred=$2')
    ad('  [ "$pred" -lt 0 ] && return 0   # no prediction available (spec has no vram block)')
    ad('  if [ "$pred" -gt "$VRAM_BUDGET_MIB" ]; then')
    ad('    echo "SKIPPED (predicted ${pred} MiB > budget ${VRAM_BUDGET_MIB} MiB): $name" \\')
    ad('      | tee -a "$CAMPAIGN_DIR/skipped.txt"; return 1; fi')
    ad('  return 0; }')
    ad("")
    ad("run_probe () {  # slug conc reps max_tokens api prefix prompt_files...")
    ad("  local slug=$1 conc=$2 reps=$3 maxt=$4 api=$5 prefix=$6; shift 6")
    ad('  if [ -f "$CAMPAIGN_DIR/done/$slug" ]; then echo "  skip (done): $slug"; return 0; fi')
    ad('  if ! want_probe "$slug"; then echo "  skip (ONLY filter): $slug"; return 0; fi')
    ad('  [ -n "$REPS_OVERRIDE" ] && reps="$REPS_OVERRIDE"')
    ad('  [ -n "$MAXTOK_OVERRIDE" ] && maxt="$MAXTOK_OVERRIDE"')
    ad('  local files=""; local f; for f in "$@"; do files="$files $GEN/$f"; done')
    ad('  if PROMPT_FILE="$files" SLUG="$slug" MAX_TOKENS="$maxt" CONCURRENCY="$conc" \\')
    ad('       REPS="$reps" API="$api" PREFIX_MODE="$prefix" SAMPLE_VRAM=1 "$EB/run.sh"; then')
    ad('    local rd; rd=$(ls -td "$ROOT"/bench/runs/*-engine-"$slug"/ 2>/dev/null | head -1)')
    ad('    [ -n "$rd" ] && [ -f "$rd/results.jsonl" ] \\')
    ad('      && cat "$rd/results.jsonl" >> "$CAMPAIGN_DIR/results.jsonl"')
    ad('    touch "$CAMPAIGN_DIR/done/$slug"')
    ad('  else echo "  FAILED: $slug" | tee -a "$CAMPAIGN_DIR/failures.txt"; fi; }')
    ad("")
    ad(f'stop_server () {{ PORT={port} "$EB/serve_llamacpp.sh" stop 2>/dev/null || true; }}')
    ad("start_server () {  # name ctx kv -> 0 up, nonzero (recorded) on failure; run CONTINUES")
    ad('  local name=$1 ctx=$2 kv=$3 mtp=$4 np=$5')
    ad('  echo ">>> starting $name (ctx=$ctx kv=$kv mtp=$mtp np=$np)"')
    ad(f'  if BACKEND={backend} CTX="$ctx" NP="$np" KV="$kv" MTP="$mtp" UB={ub} B={b} FA={fa} '
       'PORT=' + str(port) + ' \\')
    ad('       "$EB/serve_llamacpp.sh" start; then return 0; fi')
    ad('  echo "SERVER-FAILED (start OOM/other; expected near the ceiling): $name ctx=$ctx kv=$kv" \\')
    ad('    | tee -a "$CAMPAIGN_DIR/failures.txt"; stop_server; return 1; }')
    ad('trap stop_server EXIT')
    ad("")

    for srv in spec["servers"]:
        pslugs = [p["slug"] for p in srv["probes"]]
        pred = predict_vram_mib(spec, srv)
        ad(f'# ===== server: {srv["name"]} (ctx={srv["ctx"]} np={srv["np"]} '
           f'kv={srv["kv"]} mtp={srv["mtp"]} predicted_vram={pred} MiB) =====')
        slugs_q = " ".join(sh_quote(s) for s in pslugs)
        name_q = sh_quote(srv["name"])
        # Explicit resume/skip feedback: on rerun, a fully-done server says so (never silent), an
        # ONLY-filtered one says so, and only a genuinely-pending server proceeds to guard + launch.
        ad(f'if ! server_needed {slugs_q}; then')
        ad(f'  echo "  skip (done): {srv["name"]} — all its probes are already complete"')
        ad(f'elif ! probes_selected {slugs_q}; then')
        ad(f'  echo "  skip (ONLY filter): {srv["name"]}"')
        ad(f'elif guard_ok {name_q} {pred}; then')
        ad(f'  if start_server {name_q} {srv["ctx"]} {sh_quote(srv["kv"])} '
           f'{srv["mtp"]} {srv["np"]}; then')
        for p in srv["probes"]:
            files = " ".join(sh_quote(f) for f in p["prompts"])
            ad('    run_probe {slug} {conc} {reps} {maxt} {api} {prefix} {files}'.format(
                slug=sh_quote(p["slug"]), conc=p.get("concurrency", 1),
                reps=p.get("reps", 2), maxt=p.get("max_tokens", 256),
                api=p.get("api", "completions"), prefix=p.get("prefix_mode", "unique"),
                files=files))
        ad('    stop_server')
        ad('  fi')
        ad('fi')
        ad("")

    ad('# ===== report (last step): theme-aware SVG charts + appendix.md, embedded in the write-up =====')
    ad('if [ -f "$CAMPAIGN_DIR/results.jsonl" ]; then')
    ad('  python3 "$ROOT/bench/lib/report.py" "$CAMPAIGN_DIR" \\')
    ad('    && echo "charts: $CAMPAIGN_DIR/charts/  ·  appendix: $CAMPAIGN_DIR/appendix.md"')
    ad('fi')
    ad('echo "campaign done. consolidated results: $CAMPAIGN_DIR/results.jsonl"')
    ad('[ -f "$CAMPAIGN_DIR/skipped.txt" ] && { echo "--- guard-skipped (over budget) ---"; '
       'cat "$CAMPAIGN_DIR/skipped.txt"; } || true')
    return "\n".join(L) + "\n"


def emit_readme(spec):
    if spec.get("kind") == "quality":
        return emit_quality_plan(spec)
    slug = spec["slug"]
    date = spec.get("date") or datetime.date.today().isoformat()
    title = spec.get("title", f"{slug} campaign")
    rows = []
    for srv in spec["servers"]:
        for p in srv["probes"]:
            rows.append(f"| {srv['name']} | {srv['ctx']} | {srv['np']} | {srv['kv']} | "
                        f"{srv['mtp']} | `{p['slug']}` | {p.get('concurrency',1)} | "
                        f"{', '.join(p['prompts'])} |")
    tune = spec.get("tuning", {})
    return f"""# {title} (R9700, {date})

Scaffolded by `bench/gen_campaign.py`. The executable driver is **`run.sh`** in this folder
(resumable — per-probe markers in `done/`, rerun to continue). Fill in the prose below.

## Fixed parameters
- Model `{os.path.basename(spec['model'])}` · backend **{spec.get('backend','vulkan')}** ·
  tuning `-ub {tune.get('ub',2048)} -b {tune.get('b',4096)} -fa {tune.get('fa','on')}` ·
  server on :{spec.get('port', BACKEND_PORT.get(spec.get('backend','vulkan'),8080))}.

## Build fixtures first
Build every prompt file referenced below into `bench/workloads/generated/` with
`build_prompt.py` (see `docs/GUIDE.md` §2). The driver assumes they exist.

## Run
```bash
bash campaigns/{date}-{slug}/run.sh
# resume after interruption: same command (done/ markers skip finished probes)
# subset / shorter pass:  ONLY='*-q8-*' REPS=1 MAX_TOKENS=64 bash campaigns/{date}-{slug}/run.sh
# tighten the guard:      VRAM_BUDGET_MIB=31000 bash campaigns/{date}-{slug}/run.sh
```
The driver **continues past a failed server** and **skips (before launch) any server predicted to
exceed `VRAM_BUDGET_MIB`** — so it stays in VRAM and never risks a system-RAM spill/freeze. VRAM &
GTT are sampled per probe into each run dir's `gpu_samples.csv`.

## Matrix
| server | ctx | np | kv | mtp | probe | conc | prompts |
|--------|----:|---:|:--:|:---:|-------|-----:|---------|
{chr(10).join(rows)}

## Write-up
**benchmark-results** skill → co-located `campaigns/{date}-{slug}/analysis.md` (summary + table
first, **memory column mandatory**). `run.sh`'s last step auto-generates theme-aware SVG charts in
`charts/` + an `appendix.md` (`bench/lib/report.py`) — embed the appendix in `analysis.md`. Add a
`<!-- meta -->` block and run `docs/reindex.py`.
"""


def emit_quality_runsh(spec):
    """Driver for a `kind:"quality"` campaign: for each config (model × MTP) launch one server,
    sample GPU telemetry, capture the task suite with capture_engine `tasks`, score deterministically,
    then render SVG charts. Resumable (out/done/<label>), continue-on-fail, pre-flight VRAM guard."""
    slug = spec["slug"]
    date = spec.get("date") or datetime.date.today().isoformat()
    backend = spec.get("backend", "vulkan")
    port = spec.get("port") or BACKEND_PORT.get(backend, 8081)
    tune = spec.get("tuning", {})
    ub, b, fa = tune.get("ub", 2048), tune.get("b", 4096), tune.get("fa", "on")
    ctx = int(spec.get("ctx", 32768))
    kv = spec.get("kv", "f16")
    reps = int(spec.get("reps", 1))
    max_tokens = int(spec.get("max_tokens", 8192))
    api = spec.get("api", "chat")
    tasks_rel = spec.get("tasks", "tasks/tasks.jsonl")
    models_dir = spec.get("models_dir", "/home/dev/models/gguf")
    v = spec.get("vram") or {}
    budget = int(v.get("budget_mib", 32400))
    overhead = int(v.get("overhead_mib", 2000))
    kk = v.get("kv_kib_per_tok")
    kv_kib = (kk.get(kv) if isinstance(kk, dict) else kk) if kk else None
    kv_kib = int(round(kv_kib)) if kv_kib is not None else 0     # 0 → guard disabled

    L = []
    ad = L.append
    ad("#!/usr/bin/env bash")
    ad(f"# GENERATED by bench/gen_campaign.py — QUALITY campaign '{slug}'. Resumable: rerun to")
    ad("# continue (per-config markers in out/done/). Edit the spec and regenerate. Behaviour:")
    ad("#   * Per config: serve ONE llama-server → sample VRAM/GTT/power → capture the task suite")
    ad("#     (capture_engine tasks: full telemetry, saved responses) → stop. Then deterministic")
    ad("#     scoring + SVG report. CONTINUE-ON-FAIL; PRE-FLIGHT VRAM GUARD skips a model predicted")
    ad("#     over budget (VRAM-only, no GTT spill/freeze).")
    ad("#   * Subset / short pass: ONLY='glob' picks configs; REPS=/MAX_TOKENS= shorten a run.")
    for line in ([spec["notes"]] if isinstance(spec.get("notes"), str) else spec.get("notes", [])):
        ad(f"# NOTE: {line}")
    ad("set -uo pipefail")
    ad(f'ROOT="${{ROOT:-{REPO}}}"')
    ad(f'CAMPAIGN_DIR="${{CAMPAIGN_DIR:-$ROOT/campaigns/{date}-{slug}}}"')
    ad('LIB="$ROOT/bench/lib"; EB="$ROOT/bench/engine-bench"')
    ad('OUT="$CAMPAIGN_DIR/out"; mkdir -p "$OUT/done"')
    ad('OUTF="$OUT/outputs.jsonl"; VRAMF="$OUT/vram.jsonl"')
    ad(f'MODELS_DIR="${{MODELS_DIR:-{models_dir}}}"')
    ad(f'TASKS="${{TASKS:-$CAMPAIGN_DIR/{tasks_rel}}}"')
    ad(f'BACKEND={sh_quote(backend)}; PORT={port}; CTX={ctx}; KV={sh_quote(kv)}; UB={ub}; B={b}; FA={sh_quote(str(fa))}')
    ad(f'REPS="${{REPS:-{reps}}}"; MAX_TOKENS="${{MAX_TOKENS:-{max_tokens}}}"; API={sh_quote(api)}')
    ad(f'VRAM_BUDGET_MIB="${{VRAM_BUDGET_MIB:-{budget}}}"; OVERHEAD_MIB={overhead}; KV_KIB_PER_TOK={kv_kib}  # 0 = guard off')
    ad('ONLY="${ONLY:-}"                 # space/comma glob(s) on config label; empty = all')
    ad("")
    ad("# config triples: label | model filename (under MODELS_DIR) | mtp(0|1)")
    ad("CONFIGS=(")
    for c in spec["configs"]:
        ad("  " + sh_quote(f'{c["label"]}|{c["file"]}|{c.get("mtp", 0)}'))
    ad(")")
    ad("")
    ad(r'''vram_used_mib(){ rocm-smi --showmeminfo vram 2>/dev/null | awk -F: '/VRAM Total Used/{gsub(/ /,"",$NF); printf "%d",$NF/1048576}'; }''')
    ad('want(){ [ -z "$ONLY" ] && return 0; local g; for g in ${ONLY//,/ }; do case "$1" in $g) return 0;; esac; done; return 1; }')
    ad("guard_ok(){  # $1=model path -> 0 ok/unknown, 1 skip (recorded)")
    ad('  [ "$KV_KIB_PER_TOK" -le 0 ] && return 0')
    ad('  local wmib=$(( $(stat -c%s "$1" 2>/dev/null || echo 0) / 1048576 ))')
    ad('  [ "$wmib" -le 0 ] && return 0')
    ad('  local pred=$(( wmib + OVERHEAD_MIB + KV_KIB_PER_TOK * CTX / 1024 ))')
    ad('  if [ "$pred" -gt "$VRAM_BUDGET_MIB" ]; then')
    ad('    echo "  SKIPPED (predicted ${pred} MiB > budget ${VRAM_BUDGET_MIB} MiB): $(basename "$1")" \\')
    ad('      | tee -a "$CAMPAIGN_DIR/skipped.txt"; return 1; fi')
    ad('  echo "  VRAM predicted ${pred} MiB (budget ${VRAM_BUDGET_MIB})"; return 0; }')
    ad(f'stop_server(){{ PORT={port} bash "$EB/serve_llamacpp.sh" stop 2>/dev/null || true; }}')
    ad("trap stop_server EXIT")
    ad("")
    ad('for entry in "${CONFIGS[@]}"; do')
    ad('  IFS="|" read -r label file mtp <<< "$entry"')
    ad('  want "$label" || { echo "skip (ONLY): $label"; continue; }')
    ad('  [ -f "$OUT/done/$label" ] && { echo "skip (done): $label"; continue; }')
    ad('  model="$MODELS_DIR/$file"')
    ad('  [ -f "$model" ] || { echo "MISSING MODEL: $model" | tee -a "$CAMPAIGN_DIR/failures.txt"; continue; }')
    ad('  echo "=== $label  (mtp=$mtp)  $file ==="')
    ad('  guard_ok "$model" || continue')
    ad('  t0=$(date +%s)')
    ad('  if MODEL="$model" BACKEND="$BACKEND" PORT="$PORT" CTX="$CTX" NP=1 UB="$UB" B="$B" FA="$FA" \\')
    ad('       KV="$KV" MTP="$mtp" bash "$EB/serve_llamacpp.sh" start; then')
    ad('    load_s=$(( $(date +%s) - t0 )); used=$(vram_used_mib)')
    ad('    echo "  VRAM at load: ${used} MiB  (load ${load_s}s)"')
    ad('    curl -s -m 10 "http://127.0.0.1:$PORT/props" > "$OUT/props_${label}.json" 2>/dev/null || true')
    ad('    msize=$(stat -c%s "$model" 2>/dev/null || echo 0)')
    ad('    csv="$OUT/gpu_${label}.csv"; SPID=""')
    ad('    if command -v rocm-smi >/dev/null 2>&1 || command -v nvidia-smi >/dev/null 2>&1; then')
    ad('      python3 "$LIB/vram_sampler.py" --out "$csv" --interval 1 & SPID=$!')
    ad('      for _ in 1 2 3 4; do [ -s "$csv" ] && [ "$(wc -l <"$csv")" -ge 2 ] && break')
    ad('        kill -0 "$SPID" 2>/dev/null || break; sleep 0.5; done')
    ad('    fi')
    ad('    python3 "$LIB/capture_engine.py" tasks --url "http://127.0.0.1:$PORT/v1" --config "$label" \\')
    ad('       --tasks "$TASKS" --out "$OUTF" --reps "$REPS" --max-tokens "$MAX_TOKENS" --api "$API" \\')
    ad('       && touch "$OUT/done/$label"')
    ad('    [ -n "$SPID" ] && { kill "$SPID" 2>/dev/null; wait "$SPID" 2>/dev/null || true; }')
    ad('    python3 - "$label" "$file" "$mtp" "$CTX" "$KV" "$used" "$csv" "$load_s" "$msize" >> "$VRAMF" <<\'PY\'')
    ad('import sys, json, re')
    ad('label, file, mtp, ctx, kv, used, csv, load_s, msize = sys.argv[1:10]')
    ad('row = {"config": label, "file": file, "mtp": int(mtp), "ctx": int(ctx), "kv": kv,')
    ad('       "vram_used_mib_at_load": int(used), "load_time_s": int(load_s),')
    ad('       "model_size_bytes": int(msize), "weights_gib": round(int(msize) / 2**30, 2)}')
    ad('try:')
    ad('    summ = [l for l in open(csv) if l.startswith("#")][-1]')
    ad('    for k, val in re.findall(r"(\\w+)=([\\d.]+)", summ):')
    ad('        row[k] = float(val) if "." in val else int(val)')
    ad('except Exception as e:')
    ad('    row["sampler_note"] = str(e)')
    ad('print(json.dumps(row))')
    ad("PY")
    ad('  else')
    ad('    echo "SERVER FAILED to start: $label" | tee -a "$CAMPAIGN_DIR/failures.txt"')
    ad('  fi')
    ad('  stop_server; sleep 2')
    ad('done')
    ad("")
    ad('echo; echo "=== deterministic scoring ==="')
    ad('python3 "$CAMPAIGN_DIR/graders/score_deterministic.py" --tasks "$TASKS" \\')
    ad('  --outputs "$OUTF" --out "$OUT/scores_deterministic.jsonl" || true')
    ad('echo; echo "=== charts + appendix (SVG, embedded in analysis.md) ==="')
    ad('python3 "$LIB/report.py" "$CAMPAIGN_DIR" || true')
    ad('echo; echo "Phase A complete. Raw telemetry: $OUTF ; per-config VRAM/power: $VRAMF"')
    ad('echo "Next: Phase B (LLM-judge, see plan.md) → Phase C (write analysis.md)."')
    ad('[ -f "$CAMPAIGN_DIR/skipped.txt" ] && { echo "--- guard-skipped ---"; cat "$CAMPAIGN_DIR/skipped.txt"; } || true')
    return "\n".join(L) + "\n"


def emit_quality_plan(spec):
    slug = spec["slug"]
    date = spec.get("date") or datetime.date.today().isoformat()
    title = spec.get("title", f"{slug} — quality shootout")
    rows = "\n".join(f"| `{c['label']}` | `{c['file']}` | {c.get('mtp', 0)} |" for c in spec["configs"])
    tune = spec.get("tuning", {})
    return f"""# {title} (R9700, {date})

*This is the campaign runbook (a **plan**, not a passive README). The results write-up lands in
`analysis.md` (co-located, registered in `docs/INDEX.md`) after Phase C.*

Scaffolded by `bench/gen_campaign.py` (`kind: quality`). **Owner split:** Phase A (GPU capture +
deterministic scoring) is run manually; Phase B (LLM-judge of open-ended tasks) is done by you in a
Claude session with the prompt below; Phase C (charts + write-up) is Claude's.

## Configs under test
| label | file (under `models_dir`) | mtp |
|-------|---------------------------|:---:|
{rows}

Fixed: ctx `{spec.get('ctx', 32768)}` · kv `{spec.get('kv', 'f16')}` · tuning
`-ub {tune.get('ub', 2048)} -b {tune.get('b', 4096)} -fa {tune.get('fa', 'on')}` ·
backend **{spec.get('backend', 'vulkan')}** · reps {spec.get('reps', 1)} ·
max_tokens {spec.get('max_tokens', 8192)}.

## Phase A — capture + deterministic scoring (manual)
```bash
bash campaigns/{date}-{slug}/run.sh
# resume after interruption: same command (out/done/ markers skip finished configs)
# subset / short pass:  ONLY='unsloth*' REPS=1 MAX_TOKENS=2048 bash campaigns/{date}-{slug}/run.sh
```
Writes `out/outputs.jsonl` (full responses + telemetry), `out/vram.jsonl` (peak VRAM/GTT/power/
thermal per config), `out/scores_deterministic.jsonl`, and `charts/` + `appendix.md`.

## Phase B — LLM-judge the open-ended tasks (in a Claude session)
The `judge`-category tasks (code review, explanations, refactors) have no deterministic answer.
Extract them into a paste-ready bundle, then judge them **in a Claude session** with the prompt
below (deterministic instruction; temp is the session's, so note it in the write-up):
```bash
python3 campaigns/{date}-{slug}/graders/prepare_judge.py \\
  --outputs campaigns/{date}-{slug}/out/outputs.jsonl \\
  --tasks   campaigns/{date}-{slug}/tasks/tasks.jsonl \\
  --out     campaigns/{date}-{slug}/out/judge_bundle.md
```
Paste `judge_bundle.md` into Claude under this exact prompt:

> You are grading LLM answers to open-ended tasks. For EACH (config, task) block below, score three
> axes 0–5 (integers): **correctness** (factually right, no errors), **depth** (completeness /
> insight), **clarity** (well-structured, readable). Judge blindly — ignore which config produced
> it. Output ONLY a JSON array, one object per block, exact shape:
> `[{{"config": "...", "task_id": "...", "correctness": 0, "depth": 0, "clarity": 0, "note": "one-line reason"}}]`
> No prose outside the JSON.

Save Claude's JSON array to `out/judge_raw.json`, then fold it in:
```bash
python3 campaigns/{date}-{slug}/graders/apply_judge_scores.py \\
  --raw campaigns/{date}-{slug}/out/judge_raw.json \\
  --out campaigns/{date}-{slug}/out/judge_scores.jsonl
python3 bench/lib/report.py campaigns/{date}-{slug}     # re-render with judge data
```

## Phase C — write-up (Claude)
Write `analysis.md` (summary + headline table first, **memory column mandatory**), embed
`appendix.md`, add a `<!-- meta -->` block, and run `docs/reindex.py`.
"""


def cmd_emit(args):
    with open(args.spec, encoding="utf-8") as fh:
        spec = json.load(fh)
    kind = spec.get("kind", "throughput")
    if kind == "quality":
        for k in ("slug", "configs"):
            if k not in spec:
                sys.exit(f"quality spec missing required key: {k}")
        labels = [c["label"] for c in spec["configs"]]
        if len(labels) != len(set(labels)):
            sys.exit("config labels must be unique across the campaign")
        if not (spec.get("vram") or {}).get("kv_kib_per_tok"):
            print("⚠️  WARNING: no vram.kv_kib_per_tok — the pre-flight VRAM guard is DISABLED "
                  "(configs launch regardless of budget). Add vram.kv_kib_per_tok to enable it.")
        doc_name = "plan.md"
    else:
        for k in ("slug", "model", "servers"):
            if k not in spec:
                sys.exit(f"spec missing required key: {k}")
        slugs = [p["slug"] for s in spec["servers"] for p in s["probes"]]
        if len(slugs) != len(set(slugs)):
            sys.exit("probe slugs must be unique across the campaign")
        # Loud warning if the VRAM guard can't act — otherwise the "GPU/VRAM-only" safety is a silent
        # no-op (servers launch regardless of budget → risk of GTT spill / GPU freeze at high ctx).
        unpredictable = [s["name"] for s in spec["servers"] if predict_vram_mib(spec, s) < 0]
        if unpredictable:
            print("⚠️  WARNING: no VRAM prediction for server(s): " + ", ".join(unpredictable))
            print("    → the pre-flight guard is DISABLED for them; they WILL launch regardless of the")
            print("      VRAM budget (risk of GTT spill / GPU freeze at high context).")
            print("    Add a `vram` block to the spec: weights_gib + kv_kib_per_tok (per KV type used).")
        doc_name = "README.md"
    date = spec.get("date") or datetime.date.today().isoformat()
    cdir = os.path.join(REPO, "campaigns", f"{date}-{spec['slug']}")
    run_sh = emit_runsh(spec)
    if args.print:
        sys.stdout.write(run_sh)
        return
    os.makedirs(cdir, exist_ok=True)
    run_path = os.path.join(cdir, "run.sh")
    with open(run_path, "w", encoding="utf-8") as fh:
        fh.write(run_sh)
    os.chmod(run_path, os.stat(run_path).st_mode | stat.S_IEXEC | stat.S_IXGRP)
    print(f"wrote {os.path.relpath(run_path, REPO)}")
    doc = os.path.join(cdir, doc_name)
    if os.path.exists(doc) and not args.force:
        print(f"kept existing {os.path.relpath(doc, REPO)} (use --force to overwrite)")
    else:
        with open(doc, "w", encoding="utf-8") as fh:
            fh.write(emit_readme(spec))
        print(f"wrote {os.path.relpath(doc, REPO)}")


def cmd_vram(args):
    base_mib = args.weights_gib * 1024 + args.overhead_mib
    kv_per_tok_mib = args.kv_kib_per_tok / 1024.0
    avail = args.budget_mib - base_mib
    if avail <= 0:
        sys.exit(f"budget {args.budget_mib} MiB < base {base_mib:.0f} MiB — weights don't fit")
    max_ctx = int(avail / kv_per_tok_mib)
    print(f"weights+overhead base : {base_mib:8.0f} MiB")
    print(f"f16 KV per token      : {args.kv_kib_per_tok:8.1f} KiB")
    print(f"budget                : {args.budget_mib:8.0f} MiB")
    print(f"-> max KV tokens (total, -c): {max_ctx:,}")
    if args.np > 1:
        print(f"-> per slot at -np {args.np}      : {max_ctx // args.np:,}")
    print("note: also capped by the model's native context (RoPE) — take the min.")


EXAMPLE = {
    "slug": "example", "model": "/home/dev/models/gguf/Model-Q4_K_M.gguf",
    "backend": "vulkan", "port": 8081, "tuning": {"ub": 2048, "b": 4096, "fa": "on"},
    "servers": [{
        "name": "single-mtp1", "ctx": 65536, "np": 1, "kv": "f16", "mtp": 1,
        "probes": [
            {"slug": "ex-cr8000", "prompts": ["codereview-8000.txt"],
             "max_tokens": 256, "api": "completions", "concurrency": 1, "reps": 2},
            {"slug": "ex-think", "prompts": ["thinking-hard.txt"],
             "max_tokens": 1024, "api": "chat", "concurrency": 1, "reps": 2},
        ]}]}

EXAMPLE_QUALITY = {
    "kind": "quality", "slug": "example-quality", "backend": "vulkan", "port": 8081,
    "models_dir": "/home/dev/models/gguf", "ctx": 32768, "kv": "f16",
    "tuning": {"ub": 2048, "b": 4096, "fa": "on"}, "reps": 1, "max_tokens": 8192,
    "tasks": "tasks/tasks.jsonl",
    "vram": {"kv_kib_per_tok": {"f16": 64, "q8_0": 34}, "budget_mib": 32400, "overhead_mib": 2000},
    "configs": [
        {"label": "model-a", "file": "Model-A-Q4_K_S.gguf", "mtp": 0},
        {"label": "model-b-mtp-off", "file": "Model-B-MTP-Q4_K_M.gguf", "mtp": 0},
        {"label": "model-b-mtp-on", "file": "Model-B-MTP-Q4_K_M.gguf", "mtp": 1},
    ]}


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    e = sub.add_parser("emit", help="spec.json -> campaign dir (run.sh + README.md/plan.md skeleton)")
    e.add_argument("--spec", required=True)
    e.add_argument("--force", action="store_true", help="overwrite an existing README.md/plan.md")
    e.add_argument("--print", action="store_true", help="print run.sh to stdout, write nothing")
    e.set_defaults(func=cmd_emit)
    v = sub.add_parser("vram-ctx", help="VRAM budget -> max context tokens")
    v.add_argument("--weights-gib", type=float, required=True)
    v.add_argument("--kv-kib-per-tok", type=float, required=True,
                   help="measured f16 KV per token (e.g. 21 for Qwen3.6-35B-A3B)")
    v.add_argument("--budget-mib", type=float, required=True)
    v.add_argument("--overhead-mib", type=float, default=700.0,
                   help="non-KV runtime/compute buffers (default 700)")
    v.add_argument("--np", type=int, default=1)
    v.set_defaults(func=cmd_vram)
    x = sub.add_parser("example", help="print a minimal example spec")
    x.add_argument("--quality", action="store_true", help="print a quality (model-shootout) spec instead")
    x.set_defaults(func=lambda a: print(json.dumps(EXAMPLE_QUALITY if a.quality else EXAMPLE, indent=2)))
    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()

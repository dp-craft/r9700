#!/usr/bin/env python3
r"""Deterministic campaign scaffolder for the R9700 benchmark harness.

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
          "agentic" — real Claude Code sessions against a vllm server, one FRESH server + git
              worktree per (rep, arm); emits README.md. See "Agentic specs" below / `example --agentic`.
  vram-ctx --weights-gib G --kv-kib-per-tok K --budget-mib M [--np N]
        Deterministic VRAM→max-context helper (the math behind the deep-context campaign).
  example [--quality | --agentic]
        Print a minimal example spec (throughput, quality, or agentic) to stdout.

Spec schema (JSON)
------------------
{
  "slug": "deep-context",             # required; campaign dir = <date>-<slug>
  "date": "2026-07-11",               # optional (default: today)
  "title": "Deep-context campaign",   # optional (README H1)
  "notes": ["free-text lines emitted as # NOTE: comments at the top of run.sh"],  # optional

  "model": "/abs/path/model.gguf",    # required (vllm: the checkpoint, informational — the profile mounts it)
  "engine": "llamacpp",               # llamacpp (default) | vllm
  "profile": "sly-radiance/qwen38-mxfp4",  # vllm only: bench/engine-bench/vllm/profiles/<engine>/<model>
  "served_model": "qwen38-27b-mxfp4", # vllm only: the --served-model-name requests must use
  "image": "ghcr.io/slybase/vllm-sly-radiance:1.9.1-rocm10.1",  # vllm only, optional: pin the docker
                                      #   image (default: the profile's IMAGE); IMAGE= at run time beats both
  "backend": "vulkan",                # llamacpp only: rocm|vulkan  (engine URL/port wiring)
  "env": {"CACTUS_DELTA": "0"},       # vllm only, optional: extra env for serve_vllm.sh (print AND start),
                                      #   e.g. a profile knob like RADIANCE_CACTUS_DELTA=${CACTUS_DELTA:-0.5}.
                                      #   A server may carry its own "env"; the two merge, the server's wins.
                                      #   Keys ^[A-Z_][A-Z0-9_]*$, values ^[\w.:/@,+-]*$ (strings); reserved (own
                                      #   field/knob): PROFILE IMAGE MAXLEN MAXSEQS KV_DTYPE PORT. Rejected on llamacpp.
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
Optional probe "warmup": N untimed warm-ups (default: engine-bench/run.sh's 1). Each warm-up is a full
prefill of the probe's own fixture, so set 0 on deep probes once the server is warm.
Conversation probe (iron rule 17 — growing multi-turn chat, prior turns cached):
  {"slug": "conv", "mode": "conversation", "prompts": ["codereview-150000.txt"], "start_tokens": 10000,
   "step_tokens": 15000, "max_depth": 145000, "max_tokens": 256, "reps": 2,
   "chat_template_kwargs": {"reasoning_effort": "low"}}      # max_depth defaults to the server ctx
  Optional "turn_prompt": "<file in bench/workloads/tasks/>" appends that task to every later turn
  ('---'-separated blocks are cycled); with "step_tokens": 0 the task IS the turn (fill-then-think).
vllm servers: `ctx` → MAXLEN, `np` → MAXSEQS, `kv` → KV_DTYPE (e.g. fp8|auto), `mtp` must be 0 (the
speculative config lives in the profile). No VRAM prediction: vLLM reserves
--gpu-memory-utilization at boot, and serve_vllm.sh's watchdog guards the load-time peak.
Before each vllm server starts, run.sh saves `serve_vllm.sh print` (resolved image + digest, env, argv)
to <campaign run dir>/server-<name>.txt, and meta.txt records the image (and the env, if any).
Each probe SLUG must be unique in the campaign (the driver globs its run dir by that slug).

Agentic specs (kind "agentic") — generalises the hand-written run_redhat_w208.sh driver
-----------------------------------------------------------------------------------
{ "kind": "agentic", "slug": "...", "date": "...", "engine": "vllm", "port": 8000,
  "repo": "/abs/git/repo", "base": "<commit>",          # base is resolved to a sha at emit time
  "worktree": "/abs/path/{arm}-r{rep}",                  # must contain {arm} and {rep}
  "served_model": "...",   # exported as SERVED_NAME to every arm; must equal the claude settings' model names
  "server": {"maxlen": 110000, "maxseqs": 1, "kv_dtype": "fp8", "gpu_util": 0.93,
             "watchdog_mib": 32, "free_mib_floor": 30000},  # maxlen required; the rest default as shown
  "env": {...},                                          # optional, merged under each arm's env (Part A rules)
  "claude": {"settings": "/abs/settings.json", "args": ["--dangerously-skip-permissions", ...]},
  "prompt": "...", "resume_prompt": "...",               # verbatim, NO placeholder substitution
  "install":  [{"src": "path", "dst": "wt-relative"}],   # src: file, absolute or relative to the project root
  "rewrite":  [{"glob": "wt-relative glob", "from": "literal", "to": "text with {wt}"}],  # python, any chars
  "symlinks": [{"src": "/abs", "dst": "wt-relative"}],
  "done_when": {"file": "wt-relative", "regex": "^W2-08 \\|"},   # python re, MULTILINE, re.search
  "collect": ["wt-relative paths/globs"], "tmp_dirs": ["/tmp/dp-refine"],
  "cap_s": 10800, "max_resumes": 5, "reps": 1,           # defaults as shown
  "server_info": ["docker exec vllm-{server_port} head -1 /opt/x.jinja"],   # optional, run after boot
  "post": ["python3 tool.py {arm_dir}"],                 # optional, run after collect (cwd = project root)
  "capture_requests": false,   # true: server on port+1, capture_proxy.py on `port` -> bodies in <arm_dir>/requests/*.gz
  "remove_worktree": false,    # true: remove the worktree only after every collect step succeeded
  "arms": [{"name": "s1-d0", "profile": "sly-redhat/redhat-mxfp4-dflash", "image": "optional",
            "env": {"CACTUS_DELTA": "0"}, "server": {"maxlen": 90000}}] }   # per-arm server overrides
Placeholders (worktree, rewrite.to, server_info, post): {wt} {arm} {rep} {arm_dir} {port} {server_port}
({server_port} = port, or port+1 with capture_requests; {wt} is not available inside "worktree").
Run-time knobs: ONLY (arm globs) REPS CAP_S MAX_RESUMES RUN_DIR IMAGE; tool paths for stub testing:
SERVE_VLLM GPU_EXCLUSIVE VRAM_SAMPLER CAPTURE_PROXY CLAUDE_BIN DOCKER CURL SS.
Loop = reps outer, arms inner; every (rep, arm) boots a fresh server. Statuses: done cap max_resumes
(result, done-marker written) | interrupted claude_error (quarantined, never auto-retried) | wt_exists
gpu_busy server_fail served_name_mismatch wt_fail prep_fail proxy_fail (no marker; a rerun retries).
Tests: python3 bench/test_gen_campaign.py -v
"""
import sys, os, re, json, argparse, datetime, stat, hashlib, subprocess, urllib.parse

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CAMPAIGNS = os.path.join(REPO, "campaigns")
BACKEND_PORT = {"rocm": 8080, "vulkan": 8081}

# vllm `env` (throughput + agentic): extra environment for serve_vllm.sh, so a profile's ${KNOB:-default}
# can be overridden per campaign/server/arm. Values are restricted to shell-inert characters.
ENV_KEY_RE = re.compile(r"[A-Z_][A-Z0-9_]*")
ENV_VAL_RE = re.compile(r"[\w.:/@,+-]*", re.ASCII)
IMAGE_RE = re.compile(r"[\w./:@-]+", re.ASCII)
RESERVED_ENV = ("PROFILE", "IMAGE", "MAXLEN", "MAXSEQS", "KV_DTYPE", "PORT")   # have their own field/knob
AGENTIC_RESERVED_ENV = RESERVED_ENV + ("SERVED_NAME", "GPU_UTIL", "WATCHDOG_MIB", "FREE_MIB_FLOOR")


def sh_quote(s):
    return "'" + str(s).replace("'", "'\\''") + "'"


def validate_env(env, where, reserved=RESERVED_ENV):
    """Validate an `env` mapping (sys.exit with a clear message); returns a copy."""
    if not isinstance(env, dict):
        sys.exit(f"{where}: env must be an object {{\"KEY\": \"value\"}}, got {type(env).__name__}")
    for k, v in env.items():
        if not isinstance(k, str) or not ENV_KEY_RE.fullmatch(k):
            sys.exit(f"{where}: env key {k!r} must match ^[A-Z_][A-Z0-9_]*$")
        if k in reserved:
            sys.exit(f"{where}: env key {k} is reserved (it has its own field/knob: {' '.join(reserved)})")
        if not isinstance(v, str):
            sys.exit(f"{where}: env value for {k} must be a string (quote numbers: \"0\"), got {v!r}")
        if not ENV_VAL_RE.fullmatch(v):
            sys.exit(f"{where}: env value {v!r} for {k} must match ^[\\w.:/@,+-]*$")
    return dict(env)


def validate_image(image, where):
    if not isinstance(image, str) or not IMAGE_RE.fullmatch(image):
        sys.exit(f"{where}: vllm image must be a docker reference (name[:tag][@digest]): {image!r}")
    return image


def merge_env(top, srv):
    """Campaign-wide env, then the server's (server wins). Insertion order is kept."""
    m = dict(top or {})
    m.update(srv or {})
    return m


def env_assign(env):
    """KEY=value KEY2=value2 (values are shell-inert by validate_env, so no quoting)."""
    return " ".join(f"{k}={v}" for k, v in env.items())


def predict_vram_mib(spec, srv):
    """Emit-time VRAM prediction for a server (weights + KV@ctx + compute overhead).
    Returns int MiB, or -1 if it cannot be computed (no `vram` block, or the server's KV type is
    absent from kv_kib_per_tok) — the guard then can't act on that server."""
    v = spec.get("vram")
    if spec.get("engine") == "vllm" or not v or "weights_gib" not in v or "kv_kib_per_tok" not in v:
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
    if spec.get("kind") == "agentic":
        return emit_agentic_runsh(spec)
    slug = spec["slug"]
    date = spec.get("date") or datetime.date.today().isoformat()
    backend = spec.get("backend", "vulkan")
    port = spec.get("port") or BACKEND_PORT.get(backend, 8080)
    tune = spec.get("tuning", {})
    ub, b, fa = tune.get("ub", 2048), tune.get("b", 4096), tune.get("fa", "on")
    engine_name = f"llamacpp-{backend}" if backend in BACKEND_PORT else backend
    vllm = spec.get("engine") == "vllm"
    if vllm:
        port = spec.get("port") or 8000
        engine_name = "vllm-" + spec["profile"].replace("/", "-")
    served = spec["served_model"] if vllm else "local"
    v = spec.get("vram") or {}
    default_budget = int(v.get("budget_mib", 32400))   # < physical VRAM (32624 MiB) → VRAM-only
    srv_env = {s["name"]: merge_env(spec.get("env"), s.get("env")) for s in spec["servers"]} if vllm else {}
    any_env = any(srv_env.values())

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
    ad(f'export ENGINES_LIST="{engine_name}|http://localhost:{port}/v1|{served}"')
    ad("# --- run-time knobs (override on the command line) ---")
    ad(f'VRAM_BUDGET_MIB="${{VRAM_BUDGET_MIB:-{default_budget}}}"  # guard: skip servers predicted above this')
    ad('ONLY="${ONLY:-}"                 # comma-separated slug globs; empty = all probes')
    ad('REPS_OVERRIDE="${REPS:-}"        # override every probe\'s reps (quick pass)')
    ad('MAXTOK_OVERRIDE="${MAX_TOKENS:-}"  # override every probe\'s max_tokens')
    if vllm:
        ad(f'IMAGE="${{IMAGE:-{spec.get("image", "")}}}"  # docker image (spec "image"); empty = the profile\'s IMAGE')
    ad('mkdir -p "$CAMPAIGN_DIR/done"')
    ad('if [ ! -f "$CAMPAIGN_DIR/meta.txt" ]; then')
    ad('  { echo "date=$(date -Iseconds)"; echo "model=$MODEL"; '
       + (f'echo "engine=vllm profile={spec["profile"]} served_model={served}"; '
          'echo "image=${IMAGE:-profile default}"; ' if vllm else
          f'echo "backend={backend}"; echo "tuning=ub{ub} b{b} fa{fa}"; ') +
       ("".join(f"echo {sh_quote('env[' + n + ']=' + env_assign(e))}; " for n, e in srv_env.items() if e)) +
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
    ad("ensure_fixtures () {  # auto-build any missing prompt fixture from its canonical recipe")
    ad('  local WL="$ROOT/bench/workloads" name n k')
    ad('  for name in "$@"; do')
    ad('    [ -f "$GEN/$name" ] && continue')
    ad('    echo ">>> building missing fixture: $name"')
    ad('    case "$name" in')
    ad('      codereview-*.txt)')
    ad('        n="${name#codereview-}"; n="${n%.txt}"')
    ad('        python3 "$WL/build_prompt.py" --task "$WL/tasks/codereview-large.task.md" \\')
    ad('          --src "$WL/corpus/ts-agentic-code-runner" --src "$WL/corpus/py-rich" \\')
    ad('          --target-tokens "$n" --out "$GEN/$name" ;;')
    ad('      thinking-hard.txt)')
    ad('        python3 "$WL/build_prompt.py" --task "$WL/tasks/thinking-hard.prompt.txt" \\')
    ad('          --target-tokens 0 --out "$GEN/thinking-hard.txt" ;;')
    ad('      agentic-*-v*.txt)  # variant set: build the base with enough --variants (writes v1..vK)')
    ad('        n="${name#agentic-}"; n="${n%%-v*}"; k="${name##*-v}"; k="${k%.txt}"')
    ad('        python3 "$WL/build_prompt.py" --task "$WL/tasks/agentic-implement.task.md" \\')
    ad('          --src "$WL/corpus/ts-agentic-code-runner" --target-tokens "$n" \\')
    ad('          --variants "$k" --out "$GEN/agentic-$n.txt" ;;')
    ad('      agentic-*.txt)')
    ad('        n="${name#agentic-}"; n="${n%.txt}"')
    ad('        python3 "$WL/build_prompt.py" --task "$WL/tasks/agentic-implement.task.md" \\')
    ad('          --src "$WL/corpus/ts-agentic-code-runner" --target-tokens "$n" --out "$GEN/$name" ;;')
    ad('      *)')
    ad('        echo "FIXTURE-UNKNOWN: no build recipe for \'$name\' — build it by hand (see" \\')
    ad('             "bench/workloads/README.md) and re-run" >&2; exit 1 ;;')
    ad('    esac')
    ad('    [ -f "$GEN/$name" ] || { echo "FIXTURE-BUILD-FAILED: $name" >&2; exit 1; }')
    ad('  done; }')
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
    if any(p.get("mode") == "conversation" for srv in spec["servers"] for p in srv["probes"]):
        ad("run_conv () {  # slug reps max_tokens start step max_depth chat_kwargs_json prompt_file")
        ad("  local slug=$1 reps=$2 maxt=$3 start=$4 step=$5 depth=$6 kw=$7 pf=$8")
        ad('  if [ -f "$CAMPAIGN_DIR/done/$slug" ]; then echo "  skip (done): $slug"; return 0; fi')
        ad('  if ! want_probe "$slug"; then echo "  skip (ONLY filter): $slug"; return 0; fi')
        ad('  [ -n "$REPS_OVERRIDE" ] && reps="$REPS_OVERRIDE"')
        ad('  [ -n "$MAXTOK_OVERRIDE" ] && maxt="$MAXTOK_OVERRIDE"')
        ad('  if MODE=conversation PROMPT_FILE="$GEN/$pf" SLUG="$slug" MAX_TOKENS="$maxt" REPS="$reps" \\')
        ad('       START_TOKENS="$start" STEP_TOKENS="$step" MAX_DEPTH="$depth" CHAT_KWARGS="$kw" \\')
        ad('       SAMPLE_VRAM=1 "$EB/run.sh"; then')
        ad('    local rd; rd=$(ls -td "$ROOT"/bench/runs/*-engine-"$slug"/ 2>/dev/null | head -1)')
        ad('    [ -n "$rd" ] && [ -f "$rd/results.jsonl" ] \\')
        ad('      && cat "$rd/results.jsonl" >> "$CAMPAIGN_DIR/results.jsonl"')
        ad('    touch "$CAMPAIGN_DIR/done/$slug"')
        ad('  else echo "  FAILED: $slug" | tee -a "$CAMPAIGN_DIR/failures.txt"; fi; }')
        ad("")
    if vllm:
        ad(f'stop_server () {{ PORT={port} "$EB/vllm/serve_vllm.sh" stop 2>/dev/null || true; }}')
    else:
        ad(f'stop_server () {{ PORT={port} "$EB/serve_llamacpp.sh" stop 2>/dev/null || true; }}')
    ad("start_server () {  # name ctx kv -> 0 up, nonzero (recorded) on failure; run CONTINUES")
    ad('  local name=$1 ctx=$2 kv=$3 mtp=$4 np=$5')
    ad('  echo ">>> starting $name (ctx=$ctx kv=$kv mtp=$mtp np=$np)"')
    if vllm:
        venv = (f'PROFILE={sh_quote(spec["profile"])} IMAGE="$IMAGE" MAXLEN="$ctx" MAXSEQS="$np" '
                f'KV_DTYPE="$kv" PORT={port}')
        ad('  # provenance: the resolved image + digest, env and argv of this server (no GPU, no pull)')
        if any_env:   # per-server env prefixes (spec "env", merged top + server): one branch per server
            ad('  case "$name" in')
            for n, e in srv_env.items():
                ev = venv.replace(" PORT=", " " + env_assign(e) + " PORT=", 1) if e else venv
                ad(f'    {sh_quote(n)})')
                ad(f'      {ev} "$EB/vllm/serve_vllm.sh" print > "$CAMPAIGN_DIR/server-$name.txt" 2>&1')
                ad(f'      if {ev} "$EB/vllm/serve_vllm.sh" start; then return 0; fi ;;')
            ad('  esac')
        else:
            ad(f'  {venv} "$EB/vllm/serve_vllm.sh" print > "$CAMPAIGN_DIR/server-$name.txt" 2>&1')
            ad(f'  if {venv} \\')
            ad('       "$EB/vllm/serve_vllm.sh" start; then return 0; fi')
    else:
        ad(f'  if BACKEND={backend} CTX="$ctx" NP="$np" KV="$kv" MTP="$mtp" UB={ub} B={b} FA={fa} '
           'PORT=' + str(port) + ' \\')
        ad('       "$EB/serve_llamacpp.sh" start; then return 0; fi')
    ad('  echo "SERVER-FAILED (start OOM/other; expected near the ceiling): $name ctx=$ctx kv=$kv" \\')
    ad('    | tee -a "$CAMPAIGN_DIR/failures.txt"; stop_server; return 1; }')
    ad('trap stop_server EXIT')
    ad("")
    fixtures = sorted({f for srv in spec["servers"] for p in srv["probes"] for f in p["prompts"]})
    if fixtures:
        ad("# --- pre-flight: build any missing prompt fixtures before loading a model ---")
        ad("ensure_fixtures " + " ".join(sh_quote(f) for f in fixtures))
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
            if p.get("mode") == "conversation":
                kw = json.dumps(p["chat_template_kwargs"]) if p.get("chat_template_kwargs") else ""
                tp = ""
                if p.get("turn_prompt"):
                    if not re.fullmatch(r"[\w.-]+", p["turn_prompt"]) or not os.path.isfile(
                            os.path.join(REPO, "bench", "workloads", "tasks", p["turn_prompt"])):
                        sys.exit(f"turn_prompt {p['turn_prompt']!r}: not a file in bench/workloads/tasks/")
                    tp = f'TURN_PROMPT="$ROOT/bench/workloads/tasks/{p["turn_prompt"]}" '
                ad('    {tp}run_conv {slug} {reps} {maxt} {st} {sp} {md} {kw} {pf}'.format(
                    slug=sh_quote(p["slug"]), reps=p.get("reps", 2), maxt=p.get("max_tokens", 256),
                    st=p.get("start_tokens", 10000), sp=p.get("step_tokens", 15000),
                    md=p.get("max_depth", srv["ctx"]), kw=sh_quote(kw), pf=sh_quote(p["prompts"][0]), tp=tp))
                continue
            wu = f'WARMUP={int(p["warmup"])} ' if "warmup" in p else ""   # untimed warm-up requests (run.sh default 1)
            ad('    {wu}run_probe {slug} {conc} {reps} {maxt} {api} {prefix} {files}'.format(wu=wu,
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
    if spec.get("kind") == "agentic":
        return emit_agentic_readme(spec)
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
    if spec.get("engine") == "vllm":
        fixed = (f"- Model `{os.path.basename(spec['model'])}` · engine **vLLM (docker)** · profile "
                 f"`{spec['profile']}` (`bench/engine-bench/vllm/profiles/`) · served as "
                 f"`{spec['served_model']}` · server on :{spec.get('port', 8000)} · image "
                 + (f"`{spec['image']}`" if spec.get("image") else "= the profile's IMAGE")
                 + " (resolved per server in `server-<name>.txt` of the run dir).")
        envs = {s["name"]: merge_env(spec.get("env"), s.get("env")) for s in spec["servers"]}
        if spec.get("env"):
            fixed += f"\n- Env (all servers, passed to `serve_vllm.sh`): `{env_assign(spec['env'])}`."
        for n, e in envs.items():
            if e and e != merge_env(spec.get("env"), None):
                fixed += f"\n- Env for server `{n}` (merged, server wins): `{env_assign(e)}`."
    else:
        fixed = (f"- Model `{os.path.basename(spec['model'])}` · backend **{spec.get('backend','vulkan')}** ·\n"
                 f"  tuning `-ub {tune.get('ub',2048)} -b {tune.get('b',4096)} -fa {tune.get('fa','on')}` ·\n"
                 f"  server on :{spec.get('port', BACKEND_PORT.get(spec.get('backend','vulkan'),8080))}.")
    return f"""# {title} (R9700, {date})

Scaffolded by `bench/gen_campaign.py`. The executable driver is **`run.sh`** in this folder
(resumable — per-probe markers in `done/`, rerun to continue). Fill in the prose below.

## Fixed parameters
{fixed}

## Fixtures (auto-built)
`run.sh` **auto-builds any missing prompt fixture** into `bench/workloads/generated/` from its
canonical recipe (`build_prompt.py`) as a pre-flight step, before loading any model — no manual
step. Known patterns: `codereview-<N>.txt`, `thinking-hard.txt`, `agentic-<N>[-v<k>].txt`. An
unrecognized filename fails loudly with a pointer to `bench/workloads/README.md` (add its recipe
to `ensure_fixtures` in `gen_campaign.py` to support a new pattern).

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
    ad('python3 "$ROOT/bench/lib/graders/score_deterministic.py" --tasks "$TASKS" \\')
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
python3 bench/lib/graders/prepare_judge.py \\
  --outputs campaigns/{date}-{slug}/out/outputs.jsonl \\
  --tasks   campaigns/{date}-{slug}/tasks/tasks.jsonl \\
  --out     campaigns/{date}-{slug}/out/judge_bundle.md
```
Paste the ENTIRE `judge_bundle.md` into Claude under this exact prompt (the blocks are already
blind — opaque ids, shuffled — so you can't tell which model wrote which):

> You are grading LLM answers to open-ended tasks. For EACH `## Block <id>` below, score three axes
> as integers 0–5: **correctness** (factually right, no errors), **depth** (completeness / insight),
> **clarity** (well-structured, readable). Be strict and consistent; use the whole 0–5 range. Output
> ONLY a JSON array, one object per block, exact shape:
> `[{{"id": "b01", "correctness": 0, "depth": 0, "clarity": 0, "note": "one-line reason"}}]`
> No prose outside the JSON.

Save Claude's JSON array to `out/judge_raw.json`, then fold it in:
```bash
python3 bench/lib/graders/apply_judge_scores.py \\
  --raw campaigns/{date}-{slug}/out/judge_raw.json \\
  --out campaigns/{date}-{slug}/out/judge_scores.jsonl
python3 bench/lib/report.py campaigns/{date}-{slug}     # re-render with judge data
```

## Phase C — write-up (Claude)
Write `analysis.md` (summary + headline table first, **memory column mandatory**), embed
`appendix.md`, add a `<!-- meta -->` block, and run `docs/reindex.py`.
"""


# ======================================================================================
# kind "agentic": real Claude Code sessions against a vllm server (one fresh server + worktree per rep x arm)
# ======================================================================================
AGENTIC_DEFAULTS = {"maxseqs": 1, "kv_dtype": "fp8", "gpu_util": 0.93, "watchdog_mib": 32,
                    "free_mib_floor": 30000}      # dp-forge vllm.sh values; 30000 = sly-official floor
AGENTIC_SERVER_KEYS = ("maxlen", "maxseqs", "kv_dtype", "gpu_util", "watchdog_mib", "free_mib_floor")
AGENTIC_KEYS = ("kind", "slug", "date", "title", "notes", "engine", "port", "repo", "base", "worktree",
                "served_model", "server", "env", "claude", "prompt", "resume_prompt", "install", "rewrite",
                "symlinks", "done_when", "collect", "tmp_dirs", "cap_s", "max_resumes", "reps", "server_info",
                "post", "capture_requests", "remove_worktree", "arms")
AGENTIC_ARM_KEYS = ("name", "profile", "image", "env", "server")
ARM_RE = re.compile(r"[a-z0-9][a-z0-9._-]*")
WT_PLACEHOLDERS = ("arm", "rep", "port", "server_port", "arm_dir")          # allowed inside "worktree"
ALL_PLACEHOLDERS = ("wt",) + WT_PLACEHOLDERS
CLAUDE_ALIASES = ("haiku", "sonnet", "opus")      # `"model": "haiku"` -> ANTHROPIC_DEFAULT_HAIKU_MODEL

# Python helper embedded in the generated run.sh (written to <run dir>/agentic_helper.py, run with -I).
# Everything that touches arbitrary text (rewrite, globs, regex, json) lives here, not in sed/awk.
AGENTIC_HELPER = r'''#!/usr/bin/env python3
"""agentic_helper.py -- subcommands used by the generated agentic run.sh (stdlib only)."""
import glob, hashlib, json, os, re, shutil, sys

PH = re.compile(r"\{(wt|arm|rep|arm_dir|port|server_port)\}")


def subst(s, kv):
    return PH.sub(lambda m: kv.get(m.group(1), m.group(0)), s)


def kvs(args):
    return dict(a.split("=", 1) for a in args)


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def cmd_sid(a):
    for line in open(a[0], encoding="utf-8", errors="replace"):
        try:
            d = json.loads(line)
        except Exception:
            continue
        if isinstance(d, dict) and d.get("session_id"):
            print(d["session_id"])
            return 0
    return 0


def cmd_models(a):
    try:
        ids = [m.get("id") for m in json.load(sys.stdin).get("data", [])]
    except Exception as e:
        print(f"unparsable /v1/models: {e}")
        return 2
    print("\n".join(str(i) for i in ids))
    return 0 if a[0] in ids else 1


def cmd_subst(a):
    sys.stdout.write(subst(a[0], kvs(a[1:])))
    return 0


def cmd_done(a):
    cfg = json.load(open(a[0]))["done_when"]
    path = os.path.join(a[1], cfg["file"])
    try:
        text = open(path, encoding="utf-8", errors="replace").read()
    except OSError:
        return 1
    m = re.compile(cfg["regex"], re.M).search(text)
    if not m:
        return 1
    ls = text.rfind("\n", 0, m.start()) + 1
    le = text.find("\n", m.end())
    print(text[ls:le if le >= 0 else len(text)])
    return 0


def cmd_prep(a):
    cfg, wt, arm_dir = json.load(open(a[0])), a[1], a[2]
    kv = dict(kvs(a[3:]), wt=wt, arm_dir=arm_dir)
    sums = []
    for it in cfg.get("install", []):
        dst = os.path.join(wt, it["dst"])
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        if os.path.islink(dst):
            os.unlink(dst)
        shutil.copy2(it["src"], dst)
        sums.append(f"{sha256(it['src'])}  {it['src']}")
        print(f"install: {it['src']} -> {it['dst']}")
    with open(os.path.join(arm_dir, "installs.sha256"), "w") as fh:
        fh.write("".join(s + "\n" for s in sums))
    for it in cfg.get("rewrite", []):
        files = sorted(p for p in glob.glob(os.path.join(wt, it["glob"]), recursive=True)
                       if os.path.isfile(p) and not os.path.islink(p))
        if not files:
            print(f"rewrite: glob {it['glob']!r} matched no files in {wt}")
            return 3
        to = subst(it["to"], kv)
        for p in files:
            with open(p, encoding="utf-8", errors="surrogateescape", newline="") as fh:
                text = fh.read()
            n = text.count(it["from"])
            if n:
                with open(p, "w", encoding="utf-8", errors="surrogateescape", newline="") as fh:
                    fh.write(text.replace(it["from"], to))
            print(f"rewrite: {os.path.relpath(p, wt)}: {n} replacement(s)" + ("" if n else "  <-- WARNING none"))
    for it in cfg.get("symlinks", []):
        dst = os.path.join(wt, it["dst"])
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        if os.path.lexists(dst):
            print(f"symlink: {it['dst']} already exists in the worktree")
            return 4
        os.symlink(it["src"], dst)
        print(f"symlink: {it['dst']} -> {it['src']}")
    return 0


def cmd_collect(a):
    cfg, wt, out = json.load(open(a[0])), a[1], a[2]
    for pat in cfg.get("collect", []):
        hits = sorted(glob.glob(os.path.join(wt, pat), recursive=True))
        if not hits:
            print(f"collect: {pat!r}: no match", file=sys.stderr)
        for p in hits:
            dst = os.path.join(out, os.path.relpath(p, wt))
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            if os.path.isdir(p) and not os.path.islink(p):
                shutil.copytree(p, dst, symlinks=True, dirs_exist_ok=True)
            else:
                shutil.copy2(p, dst, follow_symlinks=False)
            print(f"collect: {os.path.relpath(p, wt)}")
    return 0


if __name__ == "__main__":
    fn = globals().get("cmd_" + sys.argv[1]) if len(sys.argv) > 1 else None
    if fn is None:
        sys.exit("usage: agentic_helper.py sid|models|subst|done|prep|collect ...")
    sys.exit(fn(sys.argv[2:]))
'''


def _is_int(v, lo):
    return isinstance(v, int) and not isinstance(v, bool) and v >= lo


def _rel(p, where):
    if not isinstance(p, str) or not p or os.path.isabs(p) or ".." in p.split("/"):
        sys.exit(f"{where}: must be a non-empty worktree-relative path without '..': {p!r}")
    return p


def _settings_models(settings):
    """(label, value) for every model name Claude Code will send, from a settings dict."""
    env = settings.get("env") or {}
    out = [(k, v) for k, v in env.items()
           if k in ("ANTHROPIC_MODEL", "ANTHROPIC_SMALL_FAST_MODEL")
           or re.fullmatch(r"ANTHROPIC_DEFAULT_[A-Z]+_MODEL", k)]
    return out


def agentic_arms(spec):
    """Per-arm resolved config: name, profile, image, env (merged), server (defaults < spec < arm)."""
    arms = []
    for a in spec["arms"]:
        srv = dict(AGENTIC_DEFAULTS)
        srv.update(spec.get("server") or {})
        srv.update(a.get("server") or {})
        arms.append({"name": a["name"], "profile": a["profile"], "image": a.get("image", ""),
                     "env": merge_env(spec.get("env"), a.get("env")), "server": srv})
    return arms


def validate_agentic(spec):
    """Emit-time validation for kind "agentic" (sys.exit with a clear message)."""
    for k in ("slug", "engine", "port", "repo", "base", "worktree", "served_model", "server", "claude",
              "prompt", "resume_prompt", "done_when", "arms"):
        if k not in spec:
            sys.exit(f"agentic spec missing required key: {k}")
    unknown = [k for k in spec if k not in AGENTIC_KEYS]
    if unknown:
        sys.exit(f"agentic spec: unknown key(s) {unknown} (typo? known: {', '.join(AGENTIC_KEYS)})")
    if spec["engine"] != "vllm":
        sys.exit('agentic spec: engine must be "vllm" (the only engine the agentic driver launches)')
    if not isinstance(spec["slug"], str) or not re.fullmatch(r"[A-Za-z0-9._-]+", spec["slug"]):
        sys.exit(f"agentic spec: slug must match [A-Za-z0-9._-]+: {spec['slug']!r}")
    if not _is_int(spec["port"], 1) or spec["port"] > 65534:
        sys.exit(f"agentic spec: port must be an integer 1..65534: {spec['port']!r}")
    served = spec["served_model"]
    if not isinstance(served, str) or not re.fullmatch(r"[\w.:/@+-]+", served, re.ASCII):
        sys.exit(f"agentic spec: served_model must match [\\w.:/@+-]+: {served!r}")
    for k in ("prompt", "resume_prompt"):
        if not isinstance(spec[k], str) or not spec[k].strip():
            sys.exit(f"agentic spec: {k} must be a non-empty string")
    for k in ("capture_requests", "remove_worktree"):
        if k in spec and not isinstance(spec[k], bool):
            sys.exit(f"agentic spec: {k} must be true or false")
    for k, lo in (("cap_s", 1), ("max_resumes", 0), ("reps", 1)):
        if k in spec and not _is_int(spec[k], lo):
            sys.exit(f"agentic spec: {k} must be an integer >= {lo}: {spec[k]!r}")
    for k in ("server_info", "post", "collect", "install", "rewrite", "symlinks", "tmp_dirs", "arms"):
        if k in spec and not isinstance(spec[k], list):
            sys.exit(f"agentic spec: {k} must be a list")
    for k in ("server_info", "post"):
        if not all(isinstance(c, str) and c.strip() for c in spec.get(k, [])):
            sys.exit(f"agentic spec: {k} must be a list of non-empty command strings")

    # --- repo / base / worktree
    repo = spec["repo"]
    if not isinstance(repo, str) or not os.path.isabs(repo) or not os.path.isdir(repo):
        sys.exit(f"agentic spec: repo must be an absolute path to a git repo: {repo!r}")
    r = subprocess.run(["git", "-C", repo, "rev-parse", "--git-dir"], capture_output=True, text=True)
    if r.returncode:
        sys.exit(f"agentic spec: repo is not a git repository: {repo}")
    base = spec["base"]
    if not isinstance(base, str) or not re.fullmatch(r"[\w./@^~-]+", base) or base.startswith("-"):
        sys.exit(f"agentic spec: base must be a commit-ish: {base!r}")
    r = subprocess.run(["git", "-C", repo, "rev-parse", "--verify", f"{base}^{{commit}}"],
                       capture_output=True, text=True)
    if r.returncode:
        sys.exit(f"agentic spec: base {base!r} does not resolve to a commit in {repo}")
    wt = spec["worktree"]
    if not isinstance(wt, str) or not os.path.isabs(wt):
        sys.exit(f"agentic spec: worktree must be an absolute path template: {wt!r}")
    for need in ("{arm}", "{rep}"):
        if need not in wt:
            sys.exit(f"agentic spec: worktree template must contain {need} (one worktree per arm and rep): {wt!r}")
    bad = [p for p in re.findall(r"\{(\w+)\}", wt) if p not in WT_PLACEHOLDERS]
    if bad:
        sys.exit(f"agentic spec: worktree has unknown/unavailable placeholder(s) {bad}; allowed: "
                 + " ".join("{" + p + "}" for p in WT_PLACEHOLDERS))

    # --- server defaults + env
    def check_server(srv, where):
        extra = [k for k in srv if k not in AGENTIC_SERVER_KEYS]
        if extra:
            sys.exit(f"{where}: unknown server key(s) {extra}; known: {', '.join(AGENTIC_SERVER_KEYS)}")
        for k, lo in (("maxlen", 1), ("maxseqs", 1), ("watchdog_mib", 0), ("free_mib_floor", 0)):
            if k in srv and not _is_int(srv[k], lo):
                sys.exit(f"{where}: {k} must be an integer >= {lo}: {srv[k]!r}")
        if "gpu_util" in srv and not (isinstance(srv["gpu_util"], (int, float)) and not isinstance(srv["gpu_util"], bool)
                                      and 0 < srv["gpu_util"] <= 1):
            sys.exit(f"{where}: gpu_util must be a number in (0, 1]: {srv['gpu_util']!r}")
        if "kv_dtype" in srv and not (isinstance(srv["kv_dtype"], str)
                                      and re.fullmatch(r"[A-Za-z0-9_]+", srv["kv_dtype"])):
            sys.exit(f"{where}: kv_dtype must be a name like fp8|auto: {srv['kv_dtype']!r}")
    if not isinstance(spec["server"], dict):
        sys.exit("agentic spec: server must be an object")
    check_server(spec["server"], "agentic spec server")
    if "env" in spec:
        validate_env(spec["env"], "agentic spec", AGENTIC_RESERVED_ENV)

    # --- arms
    if not spec["arms"]:
        sys.exit("agentic spec: arms must list at least one arm")
    names = []
    for i, a in enumerate(spec["arms"]):
        if not isinstance(a, dict):
            sys.exit(f"agentic spec: arms[{i}] must be an object")
        extra = [k for k in a if k not in AGENTIC_ARM_KEYS]
        if extra:
            sys.exit(f"agentic spec: arms[{i}] unknown key(s) {extra}; known: {', '.join(AGENTIC_ARM_KEYS)}")
        n = a.get("name")
        if not isinstance(n, str) or not ARM_RE.fullmatch(n):
            sys.exit(f"agentic spec: arm name must match ^[a-z0-9][a-z0-9._-]*$: {n!r}")
        names.append(n)
        where = f"arm {n!r}"
        if "profile" not in a:
            sys.exit(f"{where}: missing profile")
        prof = os.path.join(REPO, "bench", "engine-bench", "vllm", "profiles", str(a["profile"]) + ".env")
        if not re.fullmatch(r"[\w.-]+/[\w.-]+", str(a["profile"])) or not os.path.exists(prof):
            sys.exit(f"{where}: vllm profile not found: {prof}")
        if "image" in a:
            validate_image(a["image"], where)
        if "env" in a:
            validate_env(a["env"], where, AGENTIC_RESERVED_ENV)
        if "server" in a:
            if not isinstance(a["server"], dict):
                sys.exit(f"{where}: server must be an object")
            check_server(a["server"], where + " server")
    if len(names) != len(set(names)):
        sys.exit("agentic spec: arm names must be unique")
    for a in agentic_arms(spec):
        if "maxlen" not in a["server"]:
            sys.exit(f"arm {a['name']!r}: server.maxlen is required (campaign-wide in `server` or per arm)")

    # --- claude settings
    cl = spec["claude"]
    if not isinstance(cl, dict) or "settings" not in cl:
        sys.exit("agentic spec: claude.settings (absolute path to the settings JSON) is required")
    if not isinstance(cl.get("args", []), list) or not all(isinstance(x, str) for x in cl.get("args", [])):
        sys.exit("agentic spec: claude.args must be a list of strings")
    sp = cl["settings"]
    if not isinstance(sp, str) or not os.path.isabs(sp) or not os.path.isfile(sp):
        sys.exit(f"agentic spec: claude.settings file not found (absolute path required): {sp!r}")
    try:
        with open(sp, encoding="utf-8") as fh:
            settings = json.load(fh)
    except ValueError as e:
        sys.exit(f"agentic spec: claude.settings is not valid JSON ({sp}): {e}")
    if not isinstance(settings, dict):
        sys.exit(f"agentic spec: claude.settings must be a JSON object: {sp}")
    senv = settings.get("env") or {}
    url = senv.get("ANTHROPIC_BASE_URL")
    if url:
        u = urllib.parse.urlparse(url)
        if (u.port or 80) != spec["port"]:
            sys.exit(f"agentic spec: settings ANTHROPIC_BASE_URL port {u.port or 80} != spec port {spec['port']} ({sp})")
    for label, val in _settings_models(settings):
        if val != served:
            sys.exit(f"agentic spec: settings {label}={val!r} != served_model {served!r} ({sp})")
    top = settings.get("model")
    if top is not None and top != served:
        mapped = senv.get(f"ANTHROPIC_DEFAULT_{str(top).upper()}_MODEL")
        if not (top in CLAUDE_ALIASES and mapped == served):
            sys.exit(f"agentic spec: settings model={top!r} != served_model {served!r}"
                     + (f" (alias {top!r} needs ANTHROPIC_DEFAULT_{str(top).upper()}_MODEL={served})"
                        if top in CLAUDE_ALIASES else "") + f" ({sp})")

    # --- worktree plumbing
    for i, it in enumerate(spec.get("install", [])):
        if not isinstance(it, dict) or not isinstance(it.get("src"), str):
            sys.exit(f"install[{i}]: needs src and dst")
        _rel(it.get("dst"), f"install[{i}].dst")
        src = it["src"] if os.path.isabs(it["src"]) else os.path.join(REPO, it["src"])
        if not os.path.isfile(src):
            sys.exit(f"install[{i}]: src is not an existing file: {src}")
    for i, it in enumerate(spec.get("rewrite", [])):
        if not isinstance(it, dict) or not all(isinstance(it.get(k), str) for k in ("glob", "from", "to")):
            sys.exit(f"rewrite[{i}]: needs string glob, from, to")
        _rel(it["glob"], f"rewrite[{i}].glob")
        if not it["from"]:
            sys.exit(f"rewrite[{i}]: from must not be empty")
    for i, it in enumerate(spec.get("symlinks", [])):
        if not isinstance(it, dict) or not isinstance(it.get("src"), str) or not os.path.isabs(it["src"]):
            sys.exit(f"symlinks[{i}]: src must be an absolute path")
        _rel(it.get("dst"), f"symlinks[{i}].dst")
        if not os.path.lexists(it["src"]):
            sys.exit(f"symlinks[{i}]: symlink src does not exist: {it['src']}")
    dw = spec["done_when"]
    if not isinstance(dw, dict) or "file" not in dw or "regex" not in dw:
        sys.exit('agentic spec: done_when needs {"file": wt-relative path, "regex": python regex}')
    _rel(dw["file"], "done_when.file")
    try:
        re.compile(dw["regex"], re.M)
    except (re.error, TypeError) as e:
        sys.exit(f"agentic spec: done_when.regex does not compile: {e}")
    for i, c in enumerate(spec.get("collect", [])):
        _rel(c, f"collect[{i}]")
    for i, d in enumerate(spec.get("tmp_dirs", [])):
        if (not isinstance(d, str) or not os.path.isabs(d) or ".." in d.split("/")
                or len([x for x in d.split("/") if x]) < 2):
            sys.exit(f"tmp_dirs[{i}]: must be an absolute path at least two levels deep (it is MOVED): {d!r}")


def _norm_install(spec):
    return [{"src": it["src"] if os.path.isabs(it["src"]) else os.path.join(REPO, it["src"]),
             "dst": it["dst"]} for it in spec.get("install", [])]


def _file_sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _resolve_base(spec):
    r = subprocess.run(["git", "-C", spec["repo"], "rev-parse", "--verify", f"{spec['base']}^{{commit}}"],
                       capture_output=True, text=True)
    return r.stdout.strip() or spec["base"]


def _heredoc_tag(prefix, *bodies):
    n = 0
    while True:
        tag = f"{prefix}{n}" if n else prefix
        if not any(tag in b for b in bodies):
            return tag
        n += 1


AGENTIC_RUNSH = r'''#!/usr/bin/env bash
# GENERATED by bench/gen_campaign.py -- AGENTIC campaign '@@SLUG@@'. Rerun to continue; edit the spec and regenerate.
# Loop: reps outer, arms inner. EVERY (rep, arm) boots a FRESH vllm server (no prefix-cache carry-over between
# sessions), creates a fresh git worktree at the base commit, runs `claude -p` (same session resumed until
# done_when / cap / max_resumes), then tears down and collects. Behaviour baked in (no hand-editing needed):
#   * CONTINUE-ON-FAILURE: wt_exists | gpu_busy | server_fail | served_name_mismatch | wt_fail | prep_fail |
#     proxy_fail are recorded in failures.txt and the run moves on. They leave NO marker, so a rerun retries them.
#   * <run>/started/rep<R>.<arm> is written when the session loop begins; <run>/done/... only for the RESULT
#     statuses done|cap|max_resumes (a cap is a measured outcome). Started-without-done = `interrupted`
#     (also what a claude_error leaves): recorded, SKIPPED, never auto-deleted or auto-retried (iron rule 18).
#   * Teardown is trap-protected (Ctrl-C/TERM): sampler, proxy, docker logs, serve_vllm stop, port-free check.
#   * Knobs: ONLY='armglob,..' REPS=N CAP_S=sec MAX_RESUMES=N RUN_DIR=dir IMAGE=ref (beats the spec's per-arm image).
#     Tool paths (stub testing): SERVE_VLLM GPU_EXCLUSIVE VRAM_SAMPLER CAPTURE_PROXY CLAUDE_BIN DOCKER CURL SS.
@@NOTES@@
set -uo pipefail
ROOT="${ROOT:-@@ROOT@@}"
EB="$ROOT/bench/engine-bench"; LIB="$ROOT/bench/lib"
RUN_DIR="${RUN_DIR:-$ROOT/bench/runs/@@DATE@@-@@SLUG@@}"
SERVE_VLLM="${SERVE_VLLM:-$EB/vllm/serve_vllm.sh}"
GPU_EXCLUSIVE="${GPU_EXCLUSIVE:-$LIB/gpu_exclusive.sh}"
VRAM_SAMPLER="${VRAM_SAMPLER:-$LIB/vram_sampler.py}"
CAPTURE_PROXY="${CAPTURE_PROXY:-$EB/vllm/capture_proxy.py}"
CLAUDE_BIN="${CLAUDE_BIN:-claude}"
DOCKER="${DOCKER:-docker}"; CURL="${CURL:-curl}"; SS="${SS:-ss}"
ONLY="${ONLY:-}"; REPS="${REPS:-@@REPS@@}"; CAP_S="${CAP_S:-@@CAP_S@@}"; MAX_RESUMES="${MAX_RESUMES:-@@MAX_RESUMES@@}"

# --- from the spec (all values shell-quoted at emit time) ---
REPO_DIR=@@REPO_DIR@@; BASE=@@BASE@@; PORT=@@PORT@@; SERVED=@@SERVED@@
WT_TEMPLATE=@@WT_TEMPLATE@@
SETTINGS=@@SETTINGS@@
CLAUDE_ARGS=(@@CLAUDE_ARGS@@)
PROMPT=@@PROMPT@@
RESUME_PROMPT=@@RESUME_PROMPT@@
CAPTURE=@@CAPTURE@@; REMOVE_WT=@@REMOVE_WT@@
TMP_DIRS=(@@TMP_DIRS@@)
SERVER_INFO=(@@SERVER_INFO@@)
POST=(@@POST@@)
ARMS=(@@ARMS@@)

arm_conf() {  # sets A_* for the named arm (profile/image/server knobs/merged env from the spec)
  A_ENV=(); A_ENV_STR=""
  case "$1" in
@@ARM_CASES@@
  esac
}

mkdir -p "$RUN_DIR/done" "$RUN_DIR/started"
exec 9>"$RUN_DIR/.lock"
flock -n 9 || { echo "another run.sh holds $RUN_DIR/.lock -- refusing to run two drivers on one run dir" >&2; exit 1; }
# provenance: the exact helper and resolved config this run used
cat > "$RUN_DIR/agentic_helper.py" <<'@@HTAG@@'
@@HELPER@@
@@HTAG@@
cat > "$RUN_DIR/spec.resolved.json" <<'@@CTAG@@'
@@CFGJSON@@
@@CTAG@@
CFG="$RUN_DIR/spec.resolved.json"

pyh() { python3 -I "$RUN_DIR/agentic_helper.py" "$@"; }
log() { echo "$(date +%H:%M:%S) [${CUR:-run}] $*" | tee -a "$RUN_DIR/driver.log"; }
subst() { pyh subst "$1" "arm=$ARM" "rep=$REP" "arm_dir=$ARM_DIR" "port=$PORT" "server_port=$SPORT" "wt=${WT:-}"; }
want_arm() {  # honor ONLY='glob,glob'
  [ -z "$ONLY" ] && return 0
  local g; for g in ${ONLY//,/ }; do case "$1" in $g) return 0;; esac; done; return 1; }
main_fp() { ( cd "$REPO_DIR" && git rev-parse HEAD && git status --porcelain && git diff | md5sum \
              && git ls-files -o --exclude-standard -z | xargs -0 -r md5sum ); }

summary_row() {
  local img="-" f="$ARM_DIR/server.txt"
  [ -s "$f" ] && img=$(sed -n 's/^#   IMAGE=//p' "$f" | head -1)
  [ -n "$img" ] || img="-"
  [ -e "$RUN_DIR/summary.tsv" ] || printf 'rep\tarm\tstatus\twall_s\tcalls\tresumes\tdone_line\tmain_unchanged\tport_free\timage\tenv\n' \
    > "$RUN_DIR/summary.tsv"
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$REP" "$ARM" "$R_STATUS" "$R_WALL" "$R_CALLS" "$R_RESUMES" \
    "$(printf '%s' "$R_DONE_LINE" | tr '\t\n' '  ')" "$R_MAIN" "$R_PORTFREE" "$img" "${A_ENV_STR:--}" >> "$RUN_DIR/summary.tsv"
}
end_arm() {  # status [detail]: record the outcome (non-result statuses also go to failures.txt)
  R_STATUS=$1
  case "$R_STATUS" in
    done|cap|max_resumes) ;;
    *) printf 'rep%s\t%s\t%s\t%s\n' "$REP" "$ARM" "$R_STATUS" "${2:-}" >> "$RUN_DIR/failures.txt"
       log "FAILED $R_STATUS: ${2:-}" ;;
  esac
  summary_row
}

port_free_check() {
  local p i held out ports=("$SPORT"); [ "$CAPTURE" = 1 ] && ports+=("$PORT")
  R_PORTFREE=yes
  for p in "${ports[@]}"; do
    held=1
    for i in $(seq 30); do
      out=$("$SS" -ltn 2>/dev/null); case "$out" in *":$p "*) ;; *) held=0; break;; esac
      sleep 1
    done
    [ "$held" = 0 ] || { R_PORTFREE=no; log "WARNING port $p still held after teardown"; }
  done
}
teardown() {  # idempotent; also runs from the EXIT/INT/TERM traps
  [ "${TD_ACTIVE:-0}" = 1 ] || return 0
  TD_ACTIVE=0
  [ -n "${SAMP:-}" ] && { kill "$SAMP" 2>/dev/null; wait "$SAMP" 2>/dev/null; SAMP=""; }
  [ -n "${PROXY:-}" ] && { kill "$PROXY" 2>/dev/null; wait "$PROXY" 2>/dev/null; PROXY=""; }
  [ -d "$ARM_DIR/requests" ] && find "$ARM_DIR/requests" -type f ! -name '*.gz' -exec gzip -f {} +
  "$DOCKER" logs "vllm-$SPORT" > "$ARM_DIR/server-container.log" 2>&1
  env PORT="$SPORT" "$SERVE_VLLM" stop > "$ARM_DIR/server-stop.txt" 2>&1
  port_free_check
  echo "port_free=$R_PORTFREE" >> "$ARM_DIR/server-stop.txt"
}
on_signal() {
  local code=130; [ "$1" = TERM ] && code=143
  trap - INT TERM
  log "caught SIG$1 -- tearing down; the started marker is kept (a rerun reports this arm as interrupted)"
  if [ -n "${CPID:-}" ]; then   # forward to the session (own process group), then reap it
    kill -INT -- "-$CPID" 2>/dev/null || kill -INT "$CPID" 2>/dev/null
    wait "$CPID" 2>/dev/null
  fi
  teardown
  exit "$code"
}
trap 'on_signal INT' INT
trap 'on_signal TERM' TERM
trap 'teardown' EXIT

collect_arm() {  # the worktree is still there; sets COLLECT_OK
  COLLECT_OK=1
  local pd cand d
  git -C "$WT" status --porcelain > "$ARM_DIR/wt-status.txt" 2>&1 || COLLECT_OK=0
  git -C "$WT" diff "$BASE" > "$ARM_DIR/wt.diff" 2> "$ARM_DIR/wt.diff.err" || COLLECT_OK=0
  git -C "$WT" ls-files -o --exclude-standard > "$ARM_DIR/wt-untracked.txt" 2>&1 || COLLECT_OK=0
  if [ -s "$ARM_DIR/wt-untracked.txt" ]; then
    mkdir -p "$ARM_DIR/untracked"
    ( cd "$WT" && git ls-files -o --exclude-standard -z | xargs -0 -r cp -a --parents -t "$ARM_DIR/untracked" ) \
      > "$ARM_DIR/untracked.err" 2>&1 || COLLECT_OK=0
  fi
  mkdir -p "$ARM_DIR/outputs"
  pyh collect "$CFG" "$WT" "$ARM_DIR/outputs" > "$ARM_DIR/collect.txt" 2>&1 || COLLECT_OK=0
  for d in ${TMP_DIRS[@]+"${TMP_DIRS[@]}"}; do
    if [ -e "$d" ]; then
      mkdir -p "$ARM_DIR/tmp"
      mv "$d" "$ARM_DIR/tmp/$(basename "$d")" || COLLECT_OK=0
    fi
  done
  pd=""
  for cand in "$WT" "$(cd "$WT" && pwd -P)"; do
    [ -d "$HOME/.claude/projects/${cand//[^A-Za-z0-9]/-}" ] && { pd="$HOME/.claude/projects/${cand//[^A-Za-z0-9]/-}"; break; }
  done
  if [ -n "$pd" ]; then
    mkdir -p "$ARM_DIR/claude-project" && cp -a "$pd/." "$ARM_DIR/claude-project/" || COLLECT_OK=0
  else
    log "note: no ~/.claude/projects dir found for $WT"
  fi
  main_fp > "$ARM_DIR/main-after.txt" 2>&1
  if cmp -s "$ARM_DIR/main-before.txt" "$ARM_DIR/main-after.txt"; then R_MAIN=yes; else
    R_MAIN=no; log "MAIN CHECKOUT CHANGED during the run -- diff $ARM_DIR/main-before.txt $ARM_DIR/main-after.txt"; fi
  echo "main_unchanged=$R_MAIN" > "$ARM_DIR/main-check.txt"
  local c
  : > "$ARM_DIR/post.txt"
  for c in ${POST[@]+"${POST[@]}"}; do
    c=$(subst "$c")
    { echo "\$ $c"; ( cd "$ROOT" && bash -c "$c" ) 2>&1; echo "[rc=$?]"; } >> "$ARM_DIR/post.txt"
  done
  if [ "$REMOVE_WT" = 1 ]; then
    if [ "$COLLECT_OK" = 1 ]; then
      git -C "$REPO_DIR" worktree remove --force "$WT" >> "$ARM_DIR/worktree-remove.txt" 2>&1 \
        && log "removed worktree $WT (collect succeeded)" || log "WARNING could not remove worktree $WT"
    else
      log "keeping worktree $WT: a collect step failed (see $ARM_DIR/collect.txt, untracked.err, wt.diff.err)"
    fi
  fi
}

run_one() {
  REP=$1; ARM=$2; CUR="rep$REP/$ARM"
  arm_conf "$ARM"
  R_STATUS=""; R_WALL=-; R_CALLS=-; R_RESUMES=-; R_DONE_LINE=-; R_MAIN=-; R_PORTFREE=-
  SAMP=""; PROXY=""; CPID=""; TD_ACTIVE=0
  local key="rep$REP.$ARM" detail
  ARM_DIR="$RUN_DIR/rep$REP/$ARM"
  SPORT=$PORT; [ "$CAPTURE" = 1 ] && SPORT=$((PORT + 1))
  WT=""; WT=$(subst "$WT_TEMPLATE")

  # 1. markers
  if [ -f "$RUN_DIR/done/$key" ]; then log "skip (done): $key"; return 0; fi
  if [ -f "$RUN_DIR/started/$key" ]; then
    log "INTERRUPTED $key: started marker without a done marker -- skipped; NOTHING was deleted or retried."
    log "  inspect:             $ARM_DIR   (worktree $WT exists: $([ -e "$WT" ] && echo yes || echo no))"
    log "  re-collect by hand:  git -C '$WT' status --porcelain; git -C '$WT' diff $BASE; copy the spec's collect paths;"
    log "                       the transcript is in ~/.claude/projects/<mangled worktree path>/"
    log "  retry from scratch:  rm $RUN_DIR/started/$key; mv $ARM_DIR $ARM_DIR.attempt1; git -C '$REPO_DIR' worktree remove --force '$WT'; rerun"
    if ! grep -qF "$(printf 'rep%s\t%s\tinterrupted\t' "$REP" "$ARM")" "$RUN_DIR/failures.txt" 2>/dev/null; then
      mkdir -p "$ARM_DIR"; end_arm interrupted "started marker without done marker; see driver.log"
    fi
    return 0
  fi
  mkdir -p "$ARM_DIR"
  # 2. worktree path already taken: never touch it
  if [ -e "$WT" ]; then end_arm wt_exists "worktree path exists, not touched: $WT"; return 0; fi
  # 3. GPU exclusive (iron rule 14)
  local gout rc
  gout=$("$GPU_EXCLUSIVE" "$A_FLOOR" 2>&1); rc=$?
  printf '%s\n' "$gout" > "$ARM_DIR/gpu_exclusive.txt"
  if [ "$rc" -ne 0 ]; then end_arm gpu_busy "$(printf '%s' "$gout" | tr '\t\n' '  ')"; return 0; fi
  # 4. server: provenance (print) then start, fresh container per (rep, arm)
  local SRV_ENV=(PROFILE="$A_PROFILE" SERVED_NAME="$SERVED" MAXLEN="$A_MAXLEN" MAXSEQS="$A_MAXSEQS" KV_DTYPE="$A_KV"
                 GPU_UTIL="$A_GPU_UTIL" WATCHDOG_MIB="$A_WD" FREE_MIB_FLOOR="$A_FLOOR" PORT="$SPORT")
  local img="${IMAGE:-$A_IMAGE}"; [ -n "$img" ] && SRV_ENV+=(IMAGE="$img")
  SRV_ENV+=(${A_ENV[@]+"${A_ENV[@]}"})
  log "booting: ${SRV_ENV[*]}"
  TD_ACTIVE=1
  env "${SRV_ENV[@]}" "$SERVE_VLLM" print > "$ARM_DIR/server.txt" 2>&1
  if ! env "${SRV_ENV[@]}" "$SERVE_VLLM" start > "$ARM_DIR/server-start.txt" 2>&1; then
    detail=$(tail -n 3 "$ARM_DIR/server-start.txt" | tr '\t\n' '  ')
    teardown; end_arm server_fail "$detail"; return 0
  fi
  # 5. the served name must be exactly the one the claude settings use
  if ! "$CURL" -sf -m 10 "http://127.0.0.1:$SPORT/v1/models" 2>/dev/null | pyh models "$SERVED" > "$ARM_DIR/served-models.txt" 2>&1; then
    detail="server on :$SPORT serves [$(tr '\n' ' ' < "$ARM_DIR/served-models.txt")] not '$SERVED'"
    teardown; end_arm served_name_mismatch "$detail"; return 0
  fi
  # 5b. optional request-capture proxy on the client-facing port (before any worktree exists)
  if [ "$CAPTURE" = 1 ]; then
    python3 "$CAPTURE_PROXY" "$PORT" "http://127.0.0.1:$SPORT" "$ARM_DIR/requests" > "$ARM_DIR/proxy.log" 2>&1 9>&- &
    PROXY=$!
    sleep 1
    if ! kill -0 "$PROXY" 2>/dev/null; then
      PROXY=""; teardown; end_arm proxy_fail "capture proxy died at start: $(tail -n 2 "$ARM_DIR/proxy.log" | tr '\t\n' '  ')"; return 0
    fi
  fi
  # 6. only now: worktree + inputs
  main_fp > "$ARM_DIR/main-before.txt" 2>&1
  if ! git -C "$REPO_DIR" worktree add --detach "$WT" "$BASE" > "$ARM_DIR/worktree-add.txt" 2>&1; then
    teardown; end_arm wt_fail "git worktree add failed: $(tail -n 2 "$ARM_DIR/worktree-add.txt" | tr '\t\n' '  ')"; return 0
  fi
  if ! pyh prep "$CFG" "$WT" "$ARM_DIR" "arm=$ARM" "rep=$REP" "port=$PORT" "server_port=$SPORT" > "$ARM_DIR/prep.txt" 2>&1; then
    teardown; end_arm prep_fail "install/rewrite/symlink failed (worktree $WT kept): $(tail -n 2 "$ARM_DIR/prep.txt" | tr '\t\n' '  ')"; return 0
  fi
  local d dst
  for d in ${TMP_DIRS[@]+"${TMP_DIRS[@]}"}; do
    if [ -e "$d" ]; then
      dst="$RUN_DIR/stale/$(basename "$d")-$(date +%Y%m%d-%H%M%S)"
      while [ -e "$dst" ]; do dst="${dst}_"; done
      mkdir -p "$RUN_DIR/stale"
      if mv "$d" "$dst"; then log "moved pre-existing tmp dir $d -> $dst"; else
        teardown; end_arm prep_fail "could not move pre-existing tmp dir $d (worktree $WT kept)"; return 0; fi
    fi
  done
  # 7. server info, GPU sampler
  local c
  : > "$ARM_DIR/server-info.txt"
  for c in ${SERVER_INFO[@]+"${SERVER_INFO[@]}"}; do
    c=$(subst "$c")
    { echo "\$ $c"; bash -c "$c" 2>&1; echo "[rc=$?]"; } >> "$ARM_DIR/server-info.txt"
  done
  python3 "$VRAM_SAMPLER" --out "$ARM_DIR/gpu_samples.csv" --interval 2 > /dev/null 2>&1 9>&- &
  SAMP=$!
  # 8. the session: started marker, then call / resume until done_when | cap | max_resumes | claude_error
  date -Iseconds > "$RUN_DIR/started/$key"
  printf 'idx\tstart\tend\trc\n' > "$ARM_DIR/calls.tsv"
  local T0 now te n=0 sid="" s left line
  local -a cargs
  T0=$(date +%s)
  while :; do
    now=$(date +%s); left=$(( CAP_S - (now - T0) )); [ "$left" -ge 1 ] || left=1   # timeout 0 would mean "no limit"
    if [ "$n" -eq 0 ]; then cargs=(-p "$PROMPT"); else cargs=(-p "$RESUME_PROMPT" --resume "$sid"); fi
    log "claude call $n (left ${left}s)"
    # own process group (set -m) so on_signal can forward INT to timeout+claude: `timeout` leaves the terminal's
    # foreground group, so a Ctrl-C at the terminal would otherwise never reach the session.
    set -m
    ( cd "$WT" && exec timeout -k 60 --signal=INT "$left" "$CLAUDE_BIN" "${cargs[@]}" --settings "$SETTINGS" \
        ${CLAUDE_ARGS[@]+"${CLAUDE_ARGS[@]}"} < /dev/null > "$ARM_DIR/session-$n.jsonl" 2> "$ARM_DIR/session-$n.err" 9>&- ) &
    CPID=$!
    set +m
    wait "$CPID"; rc=$?
    CPID=""
    te=$(date +%s)
    printf '%s\t%s\t%s\t%s\n' "$n" "$now" "$te" "$rc" >> "$ARM_DIR/calls.tsv"
    s=$(pyh sid "$ARM_DIR/session-$n.jsonl"); [ -n "$s" ] && sid=$s
    log "call $n rc=$rc session=$sid"
    if line=$(pyh done "$CFG" "$WT"); then R_STATUS=done; R_DONE_LINE=$line; break; fi
    [ $(( te - T0 )) -ge "$CAP_S" ] && { R_STATUS=cap; break; }
    [ "$n" -ge "$MAX_RESUMES" ] && { R_STATUS=max_resumes; break; }
    if [ -z "$sid" ] || { [ "$rc" -ne 0 ] && [ "$rc" -ne 124 ] && [ "$rc" -ne 137 ]; }; then R_STATUS=claude_error; break; fi
    n=$((n + 1))
  done
  R_WALL=$(( $(date +%s) - T0 )); R_CALLS=$((n + 1)); R_RESUMES=$n
  echo "status=$R_STATUS wall_s=$R_WALL calls=$R_CALLS resumes=$R_RESUMES session=$sid done_line=$R_DONE_LINE" > "$ARM_DIR/result.txt"
  log "$(cat "$ARM_DIR/result.txt")"
  # 9. teardown (verified), 10. collect
  teardown
  collect_arm
  # 11. markers: results get a done marker; claude_error stays quarantined
  case "$R_STATUS" in done|cap|max_resumes) date -Iseconds > "$RUN_DIR/done/$key";; esac
  # 12. summary
  end_arm "$R_STATUS" "see $ARM_DIR/session-*.err"
}

[ -z "$ONLY" ] || echo "ONLY='$ONLY'"
for ((rep = 1; rep <= REPS; rep++)); do
  for arm in "${ARMS[@]}"; do
    want_arm "$arm" || { echo "skip (ONLY filter): rep$rep.$arm"; continue; }
    run_one "$rep" "$arm"
  done
done
echo; echo "=== run done: $RUN_DIR ==="
[ -f "$RUN_DIR/summary.tsv" ] && cat "$RUN_DIR/summary.tsv"
[ -f "$RUN_DIR/failures.txt" ] && { echo "--- failures (nothing here is auto-retried if it was interrupted/claude_error) ---"; cat "$RUN_DIR/failures.txt"; }
exit 0
'''


def emit_agentic_runsh(spec):
    arms = agentic_arms(spec)
    date = spec.get("date") or datetime.date.today().isoformat()
    base = _resolve_base(spec)
    cfg = {"install": _norm_install(spec), "rewrite": spec.get("rewrite", []), "symlinks": spec.get("symlinks", []),
           "done_when": spec["done_when"], "collect": spec.get("collect", []), "spec": spec}
    cfg_json = json.dumps(cfg, indent=1, ensure_ascii=False)
    cases = []
    for a in arms:
        sv = a["server"]
        cases.append(f"    {sh_quote(a['name'])})")
        cases.append(f"      A_PROFILE={sh_quote(a['profile'])}; A_IMAGE={sh_quote(a['image'])}; "
                     f"A_MAXLEN={sh_quote(sv['maxlen'])}; A_MAXSEQS={sh_quote(sv['maxseqs'])}; "
                     f"A_KV={sh_quote(sv['kv_dtype'])}; A_GPU_UTIL={sh_quote(sv['gpu_util'])}; "
                     f"A_WD={sh_quote(sv['watchdog_mib'])}; A_FLOOR={sh_quote(sv['free_mib_floor'])}")
        cases.append(f"      A_ENV=({' '.join(sh_quote(f'{k}={v}') for k, v in a['env'].items())}); "
                     f"A_ENV_STR={sh_quote(env_assign(a['env']))} ;;")
    notes = spec.get("notes")
    note_lines = "\n".join(f"# NOTE: {l}" for l in ([notes] if isinstance(notes, str) else (notes or [])))
    helper_tag = _heredoc_tag("GC_HELPER_EOF", AGENTIC_HELPER)
    cfg_tag = _heredoc_tag("GC_CFG_EOF", cfg_json)
    vals = {
        "SLUG": spec["slug"], "DATE": date, "ROOT": REPO, "NOTES": note_lines,
        "REPS": str(spec.get("reps", 1)), "CAP_S": str(spec.get("cap_s", 10800)),
        "MAX_RESUMES": str(spec.get("max_resumes", 5)),
        "REPO_DIR": sh_quote(spec["repo"]), "BASE": sh_quote(base), "PORT": str(spec["port"]),
        "SERVED": sh_quote(spec["served_model"]), "WT_TEMPLATE": sh_quote(spec["worktree"]),
        "SETTINGS": sh_quote(spec["claude"]["settings"]),
        "CLAUDE_ARGS": " ".join(sh_quote(x) for x in spec["claude"].get("args", [])),
        "PROMPT": sh_quote(spec["prompt"]), "RESUME_PROMPT": sh_quote(spec["resume_prompt"]),
        "CAPTURE": "1" if spec.get("capture_requests") else "0",
        "REMOVE_WT": "1" if spec.get("remove_worktree") else "0",
        "TMP_DIRS": " ".join(sh_quote(x) for x in spec.get("tmp_dirs", [])),
        "SERVER_INFO": " ".join(sh_quote(x) for x in spec.get("server_info", [])),
        "POST": " ".join(sh_quote(x) for x in spec.get("post", [])),
        "ARMS": " ".join(sh_quote(a["name"]) for a in arms),
        "ARM_CASES": "\n".join(cases), "HTAG": helper_tag, "CTAG": cfg_tag,
        "HELPER": AGENTIC_HELPER.rstrip("\n"), "CFGJSON": cfg_json,
    }
    return re.sub(r"@@(\w+)@@", lambda m: vals[m.group(1)], AGENTIC_RUNSH)


def _fence(text):
    n = max([len(m) for m in re.findall(r"`+", text)] + [2]) + 1
    return "`" * n


def emit_agentic_readme(spec):
    slug = spec["slug"]
    date = spec.get("date") or datetime.date.today().isoformat()
    title = spec.get("title", f"{slug} agentic campaign")
    arms = agentic_arms(spec)
    base = _resolve_base(spec)
    rows = []
    for a in arms:
        sv = a["server"]
        rows.append(f"| `{a['name']}` | `{a['profile']}` | " + (f"`{a['image']}`" if a["image"] else "profile default")
                    + f" | {('`' + env_assign(a['env']) + '`') if a['env'] else '-'} | `{spec['served_model']}` | "
                    f"{sv['maxlen']} | {sv['maxseqs']} | {sv['kv_dtype']} | {sv['gpu_util']} |")
    inst = []
    for it in _norm_install(spec):
        inst.append(f"| `{it['src']}` | `{it['dst']}` | `{_file_sha256(it['src'])}` |")
    inst_tbl = ("| src | dst (worktree-relative) | sha256 at emit time |\n|-----|-----|-----|\n" + "\n".join(inst)
                if inst else "(none)")
    pf, rf = _fence(spec["prompt"]), _fence(spec["resume_prompt"])
    dw = spec["done_when"]
    wt_extra = []
    for k in ("rewrite", "symlinks", "collect", "tmp_dirs", "server_info", "post"):
        if spec.get(k):
            wt_extra.append(f"- `{k}`: `{json.dumps(spec[k], ensure_ascii=False)}`")
    cap = spec.get("cap_s", 10800)
    return f"""# {title} (R9700, {date})

Scaffolded by `bench/gen_campaign.py` (`kind: agentic`). The executable driver is **`run.sh`** in this folder.
Each (rep, arm) boots a **fresh** vllm server (so the prefix cache never carries over), creates a **fresh git
worktree** of `{spec['repo']}` at `{base}`, runs a real `claude -p` session (same session resumed until `done_when`),
tears the server down and collects the outputs. Loop order: reps outer, arms inner (arms interleave).

## Fixed parameters
- Engine vLLM (docker) via `bench/engine-bench/vllm/serve_vllm.sh` · served model `{spec['served_model']}` (exported as
  `SERVED_NAME`; must equal the claude settings' model names, checked at emit time and against `/v1/models` per boot)
  · client port :{spec['port']}{' (capture proxy; server on :' + str(spec['port'] + 1) + ')' if spec.get('capture_requests') else ''}.
- Claude settings `{spec['claude']['settings']}` · args `{' '.join(spec['claude'].get('args', []))}`.
- Base `{spec['base']}` = `{base}` · worktree template `{spec['worktree']}`.
- Per-arm `IMAGE=` / run-time `IMAGE=` beat the profile default; the resolved image is in each arm's `server.txt`.

## Arms
| arm | profile | image | env | served model | maxlen | maxseqs | kv | gpu_util |
|-----|---------|-------|-----|--------------|-------:|--------:|----|---------:|
{chr(10).join(rows)}

Also per boot: `WATCHDOG_MIB`/`FREE_MIB_FLOOR` as in `server.txt`; the exact env of every boot is printed there
(`serve_vllm.sh print`, written before `start`).

## Installs (copied into each fresh worktree)
{inst_tbl}

The sha256 of each src at run time is written to `<arm dir>/installs.sha256`; compare with the table above.
{chr(10).join(wt_extra)}

## Prompts (verbatim, no placeholder substitution)
First call:
{pf}
{spec['prompt']}
{pf}
Resume (`--resume <session id>`):
{rf}
{spec['resume_prompt']}
{rf}

## Completion, caps
- `done_when`: file `{dw['file']}` in the worktree, python regex `{dw['regex']}` (`re.search`, MULTILINE) after every call.
- `cap_s` {cap} s wall per session · `max_resumes` {spec.get('max_resumes', 5)} · `reps` {spec.get('reps', 1)}.
- Statuses: `done`, `cap`, `max_resumes` are results (done marker written). `interrupted`/`claude_error` are quarantined
  (never auto-deleted, never auto-retried). `wt_exists`, `gpu_busy`, `server_fail`, `served_name_mismatch`, `wt_fail`,
  `prep_fail`, `proxy_fail` leave no marker, so a rerun retries them.

## Placeholders
`{{wt}}` `{{arm}}` `{{rep}}` `{{arm_dir}}` `{{port}}` `{{server_port}}` in the worktree template (no `{{wt}}`), `rewrite.to`,
`server_info` and `post` commands. Prompts are NOT substituted.

## Run / rerun / re-collect
```bash
bash campaigns/{date}-{slug}/run.sh
# resume after interruption: same command (done/ markers skip finished arms)
# subset / shorter:  ONLY='s1-*' REPS=1 CAP_S=3600 MAX_RESUMES=2 bash campaigns/{date}-{slug}/run.sh
# another output dir: RUN_DIR=/path bash campaigns/{date}-{slug}/run.sh
```
Output: `bench/runs/{date}-{slug}/` (or `$RUN_DIR`): `summary.tsv` (rep, arm, status, wall_s, calls, resumes, done_line,
main_unchanged, port_free, image, env), `failures.txt`, `driver.log`, and per (rep, arm) `rep<R>/<arm>/`: `server.txt`,
`calls.tsv`, `session-N.jsonl`, `gpu_samples.csv`, `wt.diff`, `outputs/`, `tmp/`, `claude-project/`, `main-*.txt`.

An **interrupted** arm (started marker, no done marker) is reported and skipped on every rerun. Nothing is deleted. To
re-collect by hand use the commands `run.sh` prints (worktree status/diff, the spec's `collect` paths, the
`~/.claude/projects/` transcript). To retry from scratch: remove its `started/` marker, move its arm dir aside, and
`git worktree remove --force` its worktree, then rerun.

## Write-up
**benchmark-results** skill -> co-located `campaigns/{date}-{slug}/analysis.md` (summary + table first).
"""


def validate_spec(spec):
    """Emit-time validation (sys.exit with a clear message). Returns the doc name the kind emits."""
    kind = spec.get("kind", "throughput")
    if kind == "agentic":
        validate_agentic(spec)
        return "README.md"
    if kind == "quality":
        for k in ("slug", "configs"):
            if k not in spec:
                sys.exit(f"quality spec missing required key: {k}")
        for k in ("image", "env"):
            if k in spec:
                sys.exit(f'"{k}" is vllm-only (llamacpp builds are picked by backend / serve_llamacpp.sh)')
        labels = [c["label"] for c in spec["configs"]]
        if len(labels) != len(set(labels)):
            sys.exit("config labels must be unique across the campaign")
        if not (spec.get("vram") or {}).get("kv_kib_per_tok"):
            print("⚠️  WARNING: no vram.kv_kib_per_tok — the pre-flight VRAM guard is DISABLED "
                  "(configs launch regardless of budget). Add vram.kv_kib_per_tok to enable it.")
        return "plan.md"
    for k in ("slug", "model", "servers"):
        if k not in spec:
            sys.exit(f"spec missing required key: {k}")
    slugs = [p["slug"] for s in spec["servers"] for p in s["probes"]]
    if len(slugs) != len(set(slugs)):
        sys.exit("probe slugs must be unique across the campaign")
    # Loud warning if the VRAM guard can't act — otherwise the "GPU/VRAM-only" safety is a silent
    # no-op (servers launch regardless of budget → risk of GTT spill / GPU freeze at high context).
    if spec.get("engine") == "vllm":
        for k in ("profile", "served_model"):
            if k not in spec:
                sys.exit(f"vllm spec missing required key: {k}")
        prof = os.path.join(REPO, "bench", "engine-bench", "vllm", "profiles", spec["profile"] + ".env")
        if not os.path.exists(prof):
            sys.exit(f"vllm profile not found: {prof}")
        if any(int(s.get("mtp", 0)) for s in spec["servers"]):
            sys.exit("vllm servers must have mtp 0 (speculative decoding is configured in the profile)")
        if "image" in spec:
            validate_image(spec["image"], "spec")
        if "env" in spec:
            validate_env(spec["env"], "spec")
        for s in spec["servers"]:
            if "env" in s:
                validate_env(s["env"], f"server {s['name']!r}")
        print("note: vllm engine — no emit-time VRAM prediction; vLLM reserves --gpu-memory-utilization "
              "at boot and serve_vllm.sh's watchdog kills a boot that fills the card.", file=sys.stderr)
    else:
        for k in ("image", "env"):
            if k in spec or any(k in s for s in spec["servers"]):
                sys.exit(f'"{k}" is vllm-only (llamacpp builds are picked by backend / serve_llamacpp.sh)')
    unpredictable = [s["name"] for s in spec["servers"] if predict_vram_mib(spec, s) < 0]
    if unpredictable and spec.get("engine") != "vllm":
        print("⚠️  WARNING: no VRAM prediction for server(s): " + ", ".join(unpredictable))
        print("    → the pre-flight guard is DISABLED for them; they WILL launch regardless of the")
        print("      VRAM budget (risk of GTT spill / GPU freeze at high context).")
        print("    Add a `vram` block to the spec: weights_gib + kv_kib_per_tok (per KV type used).")
    return "README.md"


def cmd_emit(args):
    with open(args.spec, encoding="utf-8") as fh:
        spec = json.load(fh)
    doc_name = validate_spec(spec)
    date = spec.get("date") or datetime.date.today().isoformat()
    cdir = os.path.join(CAMPAIGNS, f"{date}-{spec['slug']}")
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


EXAMPLE_AGENTIC = {
    "kind": "agentic", "slug": "example-agentic", "engine": "vllm", "port": 8000,
    "repo": "/home/dev/work/dippe/dp-forge", "base": "de110510",
    "worktree": "/home/dev/work/dippe/dpf-bench-{arm}-r{rep}",
    "served_model": "qwen38-27b-redhat-mxfp4-dflash",
    "server": {"maxlen": 262144, "maxseqs": 1, "kv_dtype": "fp8", "gpu_util": 0.93, "watchdog_mib": 32,
               "free_mib_floor": 30000},
    "claude": {"settings": "/home/dev/.config/claude/local_vllm_direct/settings-redhat.json",
               "args": ["--dangerously-skip-permissions", "--output-format", "stream-json", "--verbose"]},
    "prompt": "Run docs/plans/2026-10-28-2239-dpf-tui-f0-f1/review/27b-fix/RUNBOOK.md for brief W2-08 only: "
              "read it whole first (cat, it is short), then follow it exactly.",
    "resume_prompt": "Continue: follow RUNBOOK.md exactly for brief W2-08 only; resume where you stopped.",
    "install": [{"src": "bench/runs/2026-10-30-0947-dpf-brief-ab/sly191-w208/RUNBOOK.optimized.md",
                 "dst": "docs/plans/2026-10-28-2239-dpf-tui-f0-f1/review/27b-fix/RUNBOOK.md"}],
    "rewrite": [{"glob": "docs/plans/2026-10-28-2239-dpf-tui-f0-f1/briefs/W2-0[678].md",
                 "from": "/home/dev/work/dippe/dp-forge", "to": "{wt}"}],
    "symlinks": [{"src": "/home/dev/work/dippe/dp-forge/node_modules", "dst": "node_modules"}],
    "done_when": {"file": "docs/plans/2026-10-28-2239-dpf-tui-f0-f1/review/27b-fix/progress.md",
                  "regex": "^W2-08 \\|"},
    "collect": ["docs/plans/2026-10-28-2239-dpf-tui-f0-f1/review/27b-fix/progress.md"],
    "tmp_dirs": ["/tmp/dp-refine"], "cap_s": 10800, "max_resumes": 5, "reps": 1,
    "server_info": ["docker exec vllm-{server_port} head -1 /opt/qwen-fixed.jinja"],
    "capture_requests": False, "remove_worktree": False,
    "arms": [{"name": "s1-d0-dflash", "profile": "sly-redhat/redhat-mxfp4-dflash", "env": {"CACTUS_DELTA": "0"}},
             {"name": "s1-d05-dflash", "profile": "sly-redhat/redhat-mxfp4-dflash", "env": {"CACTUS_DELTA": "0.5"}}]}


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
    x.add_argument("--agentic", action="store_true", help="print an agentic (real Claude Code sessions) spec instead")
    x.set_defaults(func=lambda a: print(json.dumps(
        EXAMPLE_AGENTIC if a.agentic else EXAMPLE_QUALITY if a.quality else EXAMPLE, indent=2)))
    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()

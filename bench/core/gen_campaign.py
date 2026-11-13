#!/usr/bin/env python3
r"""Deterministic campaign scaffolder for the R9700 benchmark harness.

Turns a small JSON *spec* (which servers to launch, which probes to run against each)
into a **resumable** `run.sh` plus a README skeleton under
`campaigns/<type>/<date>-<slug>/` (project root; type = perf|quality|agentic|...). The judgement
(which depths, MTP/KV matrix, VRAM budget) is expected to come from the `benchmark-new-campaign`
skill or from you; this tool only emits the mechanical, reproducible driver. The emitted run.sh CONTINUES on a server start
failure, and (if the spec carries a `vram` block) SKIPS before launch any server predicted to
exceed the VRAM budget — GPU/VRAM-only, never spilling to system RAM. It is safe to run by hand.

Subcommands
-----------
  emit --spec SPEC.json [--force] [--print]
        Generate campaigns/<type>/<date>-<slug>/{run.sh, README.md|plan.md}. run.sh is always
        (re)written; the doc is written only if absent (never clobbers a hand-written one).
        The spec's `kind` selects the driver:
          "throughput" (default) — servers × probes matrix; emits README.md; drives
              capture_engine `probe` (cross-engine tok/s, concurrency, depth).
          "quality" — configs (model × MTP) × task-suite; emits plan.md; drives capture_engine
              `tasks` (quality + token economy) + deterministic scoring + an in-session judge.
              See `example --quality` for the schema (configs[], tasks, ctx/kv, models_dir).
          "agentic" — real Claude Code sessions against a vllm server or a llama-swap row, one FRESH
              server + git worktree per (rep, arm); emits README.md. See "Agentic specs" below / `example --agentic`.
          throughput with servers[].engine (llamacpp | vllm | radiance) — MULTI-ENGINE: one engine at a
              time, cells from a campaign-wide `workload` (depth ladder >= 4, n=2, conversation, drift
              sentinel, opt-in smoke), per-server gpu_exclusive + boot gate + boot_diag + identity gate +
              residency + Memory-Fault watcher + verified stop, pins preflight. Schema: validate_multi()
              and `example --multi-engine`. Needs `engine-bench/run.sh --capabilities` to list SAMPLING
              MIN_GEN TAGS SPEC_ROWS STATUS_OUT (the emitted preflight refuses otherwise).
              pins.fixtures_sha256 (optional) = `sha256sum` output for BARE fixture names, checked from
              bench/workloads/tmp/: (cd bench/workloads/tmp && sha256sum codereview-*.txt) > inputs/fixtures.sha256
  vram-ctx --weights-gib G --kv-kib-per-tok K --budget-mib M [--np N]
        Deterministic VRAM→max-context helper (the math behind the deep-context campaign).
  example [--quality | --agentic | --multi-engine]
        Print a minimal example spec (throughput, quality, agentic or multi-engine) to stdout.

Spec schema (JSON)
------------------
{
  "slug": "deep-context",             # required; campaign dir = campaigns/<type>/<date>-<slug>
  "date": "2026-07-11-1430",          # optional; YYYY-MM-DD-HHMM (old specs accept YYYY-MM-DD); default: now
  "title": "Deep-context campaign",   # optional (README H1)
  "notes": ["free-text lines emitted as # NOTE: comments at the top of run.sh"],  # optional

  "model": "/abs/path/model.gguf",    # required (vllm: the checkpoint, informational — the profile mounts it)
  "engine": "llamacpp",               # llamacpp (default) | vllm
  "profile": "sly-radiance/qwen38-mxfp4",  # vllm only: stack/serve/vllm/profiles/<engine>/<model>
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
to results/server-<name>.txt, and results/meta.txt records the image (and the env, if any).
Each probe SLUG must be unique in the campaign (the driver globs its run dir by that slug).

Agentic specs (kind "agentic") — generalises the hand-written run_redhat_w208.sh driver
-----------------------------------------------------------------------------------
{ "kind": "agentic", "slug": "...", "date": "...", "engine": "vllm", "port": 8000,   # engine: vllm | llama-swap
  "repo": "/abs/git/repo", "base": "<commit>",          # base is resolved to a sha at emit time
  "worktree": "/abs/path/{arm}-r{rep}",                  # must contain {arm} and {rep}
  "served_model": "...",   # vllm: SERVED_NAME, llama-swap: the row id (MODEL); must equal the claude settings' model names
  "server": {"maxlen": 110000, "maxseqs": 1, "kv_dtype": "fp8", "gpu_util": 0.93,
             "watchdog_mib": 32, "free_mib_floor": 30000},  # vllm: maxlen required; the rest default as shown
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
  "stop_when": {"tool_regex": "^Read$", "input_regex": "review/opus/"},   # optional, BOTH keys required (python re.search)
  "arms": [{"name": "s1-d0", "profile": "sly-redhat/redhat-mxfp4-dflash", "image": "optional",
            "env": {"CACTUS_DELTA": "0"}, "server": {"maxlen": 90000}}] }   # per-arm server overrides
stop_when: while a claude call runs, a watcher (`agentic_helper.py watch`) follows its stream-json file; at the first
assistant tool_use whose name matches tool_regex AND whose input (json.dumps, ensure_ascii=False) matches input_regex
it writes <arm_dir>/stop_when.txt (call, ts, tool, line, input) and sends SIGINT to the session's process group (then
TERM/KILL if it lingers). The arm ends with status `stopped` -- a RESULT (done marker, never resumed); stop_when.txt
takes precedence over done_when/cap/max_resumes/claude_error for that call. tool_result / user / text blocks never match.
Placeholders (worktree, rewrite.to, server_info, post): {wt} {arm} {rep} {arm_dir} {port} {server_port}
({server_port} = port, or port+1 with capture_requests; {wt} is not available inside "worktree").
engine "llama-swap": the server is the row `served_model` (the llama-swap model id) of the user's persistent
llama-swap router on `port`, driven by stack/serve/llamacpp/serve_llamaswap.sh: print -> server.txt, start (preload;
upstream llama-server log streamed into server-container.log), stop (GET /unload) -> server-stop.txt. The router
stays up by design, so there is no port-free check: summary.tsv's port_free column is unloaded=yes|no (a WARNING
on no). The row's config owns model/build/ctx/KV/flags/env, so `server` is optional and takes only free_mib_floor
(top level and per arm), arms take only name (+ server), and profile/image/env/capture_requests:true are rejected.
Run-time knobs: ONLY (arm globs) REPS CAP_S MAX_RESUMES CAMPAIGN_DIR IMAGE (vllm); tool paths for stub testing:
SERVE_VLLM SERVE_LLAMASWAP GPU_EXCLUSIVE VRAM_SAMPLER CAPTURE_PROXY CLAUDE_BIN DOCKER CURL SS.
Loop = reps outer, arms inner; every (rep, arm) boots a fresh server. Statuses: done cap max_resumes stopped
(result, done-marker written) | interrupted claude_error (quarantined, never auto-retried) | wt_exists
gpu_busy server_fail served_name_mismatch wt_fail prep_fail proxy_fail (no marker; a rerun retries).
Tests: python3 bench/core/test_gen_campaign.py -v
"""
import sys, os, re, json, argparse, datetime, stat, hashlib, subprocess, urllib.parse

def _repo_root(start):
    """The dir holding .git, walking up from `start` (fallback: two levels up from bench/core/)."""
    d = start
    while True:
        if os.path.exists(os.path.join(d, ".git")):
            return d
        up = os.path.dirname(d)
        if up == d:
            return os.path.dirname(os.path.dirname(start))
        d = up


REPO = _repo_root(os.path.dirname(os.path.abspath(__file__)))
CAMPAIGNS = os.path.join(REPO, "campaigns")
BACKEND_PORT = {"rocm": 8080, "vulkan": 8081}
VLLM_PROFILES = os.path.join(REPO, "stack", "serve", "vllm", "profiles")

# campaigns/<type>/<date>-<slug>/ (layout contract): type from the spec, else from the kind
CAMPAIGN_TYPES = ("perf", "build-check", "quality", "agentic", "workers", "investigation")
KIND_TYPE = {"throughput": "perf", "quality": "quality", "agentic": "agentic"}
DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}(-\d{4})?")      # YYYY-MM-DD-HHMM (new) | YYYY-MM-DD (old specs)


def campaign_date(spec):
    """The spec's date (YYYY-MM-DD-HHMM or YYYY-MM-DD), default now as YYYY-MM-DD-HHMM."""
    return spec.get("date") or datetime.datetime.now().strftime("%Y-%m-%d-%H%M")


def campaign_type(spec):
    return spec.get("type") or KIND_TYPE[spec.get("kind", "throughput")]


def campaign_rel(spec):
    """Repo-relative campaign dir: campaigns/<type>/<date>-<slug>."""
    return f"campaigns/{campaign_type(spec)}/{campaign_date(spec)}-{spec['slug']}"


def validate_layout(spec):
    """type / date checks shared by every kind (sys.exit with a clear message)."""
    if "type" in spec and spec["type"] not in CAMPAIGN_TYPES:
        sys.exit(f"spec type must be one of {' | '.join(CAMPAIGN_TYPES)}: {spec['type']!r}")
    if "date" in spec and not (isinstance(spec["date"], str) and DATE_RE.fullmatch(spec["date"])):
        sys.exit(f"spec date must be YYYY-MM-DD-HHMM (or YYYY-MM-DD for old specs): {spec['date']!r}")


# Shared run.sh preamble (every kind): no absolute repo path baked in. ROOT = git toplevel of run.sh's own dir,
# CAMPAIGN_DIR = the dir holding run.sh (both overridable); raw -> $CAMPAIGN_DIR/tmp, results -> $CAMPAIGN_DIR/results.
RUNSH_ROOTS = r'''HERE="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
ROOT="${ROOT:-$(git -C "$HERE" rev-parse --show-toplevel 2>/dev/null)}"
[ -n "$ROOT" ] || { echo "run.sh: cannot find the repo root (git toplevel of $HERE) -- set ROOT=" >&2; exit 1; }
CAMPAIGN_DIR="${CAMPAIGN_DIR:-$HERE}"
mkdir -p "$CAMPAIGN_DIR" && CAMPAIGN_DIR="$(cd "$CAMPAIGN_DIR" && pwd)"
RAW="$CAMPAIGN_DIR/tmp"; RES="$CAMPAIGN_DIR/results"   # raw (ignored) / results (committed)
mkdir -p "$RAW" "$RES"'''

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


# ensure_fixtures (bash): shared by the single-engine and the multi-engine throughput emitters (one recipe).
ENSURE_FIXTURES_SH = (
    'ensure_fixtures () {  # auto-build any missing prompt fixture from its canonical recipe',
    '  local WL="$ROOT/bench/workloads" name n k',
    '  for name in "$@"; do',
    '    [ -f "$GEN/$name" ] && continue',
    '    echo ">>> building missing fixture: $name"',
    '    case "$name" in',
    '      codereview-*.txt)',
    '        n="${name#codereview-}"; n="${n%.txt}"',
    '        python3 "$WL/build_prompt.py" --task "$WL/tasks/codereview-large.task.md" \\',
    '          --src "$WL/corpus/ts-agentic-code-runner" --src "$WL/corpus/py-rich" \\',
    '          --target-tokens "$n" --out "$GEN/$name" ;;',
    '      thinking-hard.txt)',
    '        python3 "$WL/build_prompt.py" --task "$WL/tasks/thinking-hard.prompt.txt" \\',
    '          --target-tokens 0 --out "$GEN/thinking-hard.txt" ;;',
    '      agentic-*-v*.txt)  # variant set: build the base with enough --variants (writes v1..vK)',
    '        n="${name#agentic-}"; n="${n%%-v*}"; k="${name##*-v}"; k="${k%.txt}"',
    '        python3 "$WL/build_prompt.py" --task "$WL/tasks/agentic-implement.task.md" \\',
    '          --src "$WL/corpus/ts-agentic-code-runner" --target-tokens "$n" \\',
    '          --variants "$k" --out "$GEN/agentic-$n.txt" ;;',
    '      agentic-*.txt)',
    '        n="${name#agentic-}"; n="${n%.txt}"',
    '        python3 "$WL/build_prompt.py" --task "$WL/tasks/agentic-implement.task.md" \\',
    '          --src "$WL/corpus/ts-agentic-code-runner" --target-tokens "$n" --out "$GEN/$name" ;;',
    '      *)',
    '        echo "FIXTURE-UNKNOWN: no build recipe for \'$name\' — build it by hand (see" \\',
    '             "bench/workloads/README.md) and re-run" >&2; exit 1 ;;',
    '    esac',
    '    [ -f "$GEN/$name" ] || { echo "FIXTURE-BUILD-FAILED: $name" >&2; exit 1; }',
    '  done; }',
)


def emit_runsh(spec):
    if spec.get("kind") == "quality":
        return emit_quality_runsh(spec)
    if spec.get("kind") == "agentic":
        return emit_agentic_runsh(spec)
    if is_multi(spec):
        return emit_multi_runsh(spec)
    slug = spec["slug"]
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
    ad(f"# GENERATED by bench/core/gen_campaign.py — campaign '{slug}'. Resumable: rerun to continue")
    ad("# after an interruption (per-probe markers in <campaign>/tmp/done/). Edit the spec and")
    ad("# regenerate. Behaviour baked in (no hand-editing needed):")
    ad("#   * CONTINUE-ON-FAILURE: a server that fails to start is recorded and the run moves on.")
    ad("#   * PRE-FLIGHT VRAM GUARD: a server whose predicted VRAM > VRAM_BUDGET_MIB is SKIPPED")
    ad("#     before launch → GPU/VRAM-only, never spills to system RAM (no GTT thrash / freeze).")
    ad("#   * SUBSET / SHORT runs: ONLY='glob,..' picks probes; REPS=/MAX_TOKENS= shorten a pass.")
    ad("#   * TWO ROOTS: raw (per-probe run dirs, GPU CSVs, done/ markers) -> <campaign>/tmp/; results")
    ad("#     (results.jsonl, meta/failures/skipped, server-<name>.txt, charts, appendix) -> <campaign>/results/.")
    notes = spec.get("notes")
    if notes:
        ad("#")
        for line in ([notes] if isinstance(notes, str) else notes):
            ad(f"# NOTE: {line}")
    ad("set -uo pipefail")
    ad(RUNSH_ROOTS)
    ad('EB="$ROOT/bench/perf/engine-bench"')
    ad('GEN="$ROOT/bench/workloads/tmp"')
    ad(f'export MODEL={sh_quote(spec["model"])}')
    ad(f'export ENGINES_LIST="{engine_name}|http://localhost:{port}/v1|{served}"')
    ad("# --- run-time knobs (override on the command line) ---")
    ad(f'VRAM_BUDGET_MIB="${{VRAM_BUDGET_MIB:-{default_budget}}}"  # guard: skip servers predicted above this')
    ad('ONLY="${ONLY:-}"                 # comma-separated slug globs; empty = all probes')
    ad('REPS_OVERRIDE="${REPS:-}"        # override every probe\'s reps (quick pass)')
    ad('MAXTOK_OVERRIDE="${MAX_TOKENS:-}"  # override every probe\'s max_tokens')
    if vllm:
        ad(f'IMAGE="${{IMAGE:-{spec.get("image", "")}}}"  # docker image (spec "image"); empty = the profile\'s IMAGE')
    ad('mkdir -p "$RAW/done"')
    ad('if [ ! -f "$RES/meta.txt" ]; then')
    ad('  { echo "date=$(date -Iseconds)"; echo "model=$MODEL"; '
       + (f'echo "engine=vllm profile={spec["profile"]} served_model={served}"; '
          'echo "image=${IMAGE:-profile default}"; ' if vllm else
          f'echo "backend={backend}"; echo "tuning=ub{ub} b{b} fa{fa}"; ') +
       ("".join(f"echo {sh_quote('env[' + n + ']=' + env_assign(e))}; " for n, e in srv_env.items() if e)) +
       'echo "vram_budget_mib=$VRAM_BUDGET_MIB"; } > "$RES/meta.txt"')
    ad('fi')
    ad("")
    ad("server_needed () {  # any listed probe marker missing?")
    ad('  local s; for s in "$@"; do [ -f "$RAW/done/$s" ] || return 0; done; return 1; }')
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
    ad('      | tee -a "$RES/skipped.txt"; return 1; fi')
    ad('  return 0; }')
    ad("")
    for line in ENSURE_FIXTURES_SH:
        ad(line)
    ad("")
    ad("run_probe () {  # slug conc reps max_tokens api prefix prompt_files...")
    ad("  local slug=$1 conc=$2 reps=$3 maxt=$4 api=$5 prefix=$6; shift 6")
    ad('  if [ -f "$RAW/done/$slug" ]; then echo "  skip (done): $slug"; return 0; fi')
    ad('  if ! want_probe "$slug"; then echo "  skip (ONLY filter): $slug"; return 0; fi')
    ad('  [ -n "$REPS_OVERRIDE" ] && reps="$REPS_OVERRIDE"')
    ad('  [ -n "$MAXTOK_OVERRIDE" ] && maxt="$MAXTOK_OVERRIDE"')
    ad('  local files=""; local f; for f in "$@"; do files="$files $GEN/$f"; done')
    ad('  if CAMPAIGN_DIR="$CAMPAIGN_DIR" PROMPT_FILE="$files" SLUG="$slug" MAX_TOKENS="$maxt" CONCURRENCY="$conc" \\')
    ad('       REPS="$reps" API="$api" PREFIX_MODE="$prefix" SAMPLE_VRAM=1 "$EB/run.sh"; then')
    ad('    touch "$RAW/done/$slug"   # engine-bench/run.sh appended its rows to $RES/results.jsonl (success only)')
    ad('  else echo "  FAILED: $slug" | tee -a "$RES/failures.txt"; fi; }')
    ad("")
    if any(p.get("mode") == "conversation" for srv in spec["servers"] for p in srv["probes"]):
        ad("run_conv () {  # slug reps max_tokens start step max_depth chat_kwargs_json prompt_file")
        ad("  local slug=$1 reps=$2 maxt=$3 start=$4 step=$5 depth=$6 kw=$7 pf=$8")
        ad('  if [ -f "$RAW/done/$slug" ]; then echo "  skip (done): $slug"; return 0; fi')
        ad('  if ! want_probe "$slug"; then echo "  skip (ONLY filter): $slug"; return 0; fi')
        ad('  [ -n "$REPS_OVERRIDE" ] && reps="$REPS_OVERRIDE"')
        ad('  [ -n "$MAXTOK_OVERRIDE" ] && maxt="$MAXTOK_OVERRIDE"')
        ad('  if CAMPAIGN_DIR="$CAMPAIGN_DIR" MODE=conversation PROMPT_FILE="$GEN/$pf" SLUG="$slug" MAX_TOKENS="$maxt" REPS="$reps" \\')
        ad('       START_TOKENS="$start" STEP_TOKENS="$step" MAX_DEPTH="$depth" CHAT_KWARGS="$kw" \\')
        ad('       SAMPLE_VRAM=1 "$EB/run.sh"; then')
        ad('    touch "$RAW/done/$slug"   # engine-bench/run.sh appended its rows to $RES/results.jsonl (success only)')
        ad('  else echo "  FAILED: $slug" | tee -a "$RES/failures.txt"; fi; }')
        ad("")
    if vllm:
        ad(f'stop_server () {{ PORT={port} "$ROOT/stack/serve/vllm/serve_vllm.sh" stop 2>/dev/null || true; }}')
    else:
        ad(f'stop_server () {{ PORT={port} "$ROOT/stack/serve/llamacpp/serve_llamacpp.sh" stop 2>/dev/null || true; }}')
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
                ad(f'      {ev} "$ROOT/stack/serve/vllm/serve_vllm.sh" print > "$RES/server-$name.txt" 2>&1')
                ad(f'      if {ev} "$ROOT/stack/serve/vllm/serve_vllm.sh" start; then return 0; fi ;;')
            ad('  esac')
        else:
            ad(f'  {venv} "$ROOT/stack/serve/vllm/serve_vllm.sh" print > "$RES/server-$name.txt" 2>&1')
            ad(f'  if {venv} \\')
            ad('       "$ROOT/stack/serve/vllm/serve_vllm.sh" start; then return 0; fi')
    else:
        ad(f'  if BACKEND={backend} CTX="$ctx" NP="$np" KV="$kv" MTP="$mtp" UB={ub} B={b} FA={fa} '
           'PORT=' + str(port) + ' \\')
        ad('       "$ROOT/stack/serve/llamacpp/serve_llamacpp.sh" start; then return 0; fi')
    ad('  echo "SERVER-FAILED (start OOM/other; expected near the ceiling): $name ctx=$ctx kv=$kv" \\')
    ad('    | tee -a "$RES/failures.txt"; stop_server; return 1; }')
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
    ad('if [ -f "$RES/results.jsonl" ]; then')
    ad('  python3 "$ROOT/bench/core/report.py" "$CAMPAIGN_DIR" \\')
    ad('    && echo "charts: $RES/charts/  ·  appendix: $RES/appendix.md"')
    ad('fi')
    ad('echo "campaign done. consolidated results: $RES/results.jsonl  (raw: $RAW/)"')
    ad('[ -f "$RES/skipped.txt" ] && { echo "--- guard-skipped (over budget) ---"; '
       'cat "$RES/skipped.txt"; } || true')
    return "\n".join(L) + "\n"


def emit_readme(spec):
    if spec.get("kind") == "quality":
        return emit_quality_plan(spec)
    if spec.get("kind") == "agentic":
        return emit_agentic_readme(spec)
    if is_multi(spec):
        return emit_multi_readme(spec)
    slug = spec["slug"]
    date = campaign_date(spec)
    cd = campaign_rel(spec)
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
                 f"`{spec['profile']}` (`stack/serve/vllm/profiles/`) · served as "
                 f"`{spec['served_model']}` · server on :{spec.get('port', 8000)} · image "
                 + (f"`{spec['image']}`" if spec.get("image") else "= the profile's IMAGE")
                 + " (resolved per server in `results/server-<name>.txt`).")
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

Scaffolded by `bench/core/gen_campaign.py`. The executable driver is **`run.sh`** in this folder
(resumable — per-probe markers in `tmp/done/`, rerun to continue). Fill in the prose below.

## Fixed parameters
{fixed}

## Fixtures (auto-built)
`run.sh` **auto-builds any missing prompt fixture** into `bench/workloads/tmp/` from its
canonical recipe (`build_prompt.py`) as a pre-flight step, before loading any model — no manual
step. Known patterns: `codereview-<N>.txt`, `thinking-hard.txt`, `agentic-<N>[-v<k>].txt`. An
unrecognized filename fails loudly with a pointer to `bench/workloads/README.md` (add its recipe
to `ensure_fixtures` in `gen_campaign.py` to support a new pattern).

## Run
```bash
bash {cd}/run.sh
# resume after interruption: same command (tmp/done/ markers skip finished probes)
# subset / shorter pass:  ONLY='*-q8-*' REPS=1 MAX_TOKENS=64 bash {cd}/run.sh
# tighten the guard:      VRAM_BUDGET_MIB=31000 bash {cd}/run.sh
```
The driver **continues past a failed server** and **skips (before launch) any server predicted to
exceed `VRAM_BUDGET_MIB`** — so it stays in VRAM and never risks a system-RAM spill/freeze. VRAM &
GTT are sampled per probe into each probe's raw dir (`tmp/<stamp>-engine-<probe>/gpu_samples.csv`).

## Layout
- `results/` (committed): `results.jsonl` (every probe's rows, appended once by `engine-bench/run.sh` when the
  probe succeeds), `meta.txt`, `failures.txt`, `skipped.txt`{', `server-<name>.txt`' if spec.get('engine') == 'vllm' else ''},
  `charts/`, `appendix.md`, `gpu_peaks.json`.
- `tmp/` (git-ignored raw): `done/` markers, one `<stamp>-engine-<probe>/` dir per probe (meta, prompt copies,
  `/props`, `gpu_samples.csv`).

## Matrix
| server | ctx | np | kv | mtp | probe | conc | prompts |
|--------|----:|---:|:--:|:---:|-------|-----:|---------|
{chr(10).join(rows)}

## Write-up
**benchmark-results** skill → `docs/findings/<topic>/{date}-{slug}.md` (summary + table first,
**memory column mandatory**), with `campaign: {cd}` (plus `date:` and `takeaway:`) in its
`<!-- meta -->` block. `run.sh`'s last step auto-generates theme-aware SVG charts in `results/charts/` +
`results/appendix.md` (`bench/core/report.py`) — embed the appendix in the write-up, then run
`docs/reindex.py`.
"""


def emit_quality_runsh(spec):
    """Driver for a `kind:"quality"` campaign: for each config (model × MTP) launch one server,
    sample GPU telemetry, capture the task suite with capture_engine `tasks`, score deterministically,
    then render SVG charts. Resumable (tmp/done/<label>), continue-on-fail, pre-flight VRAM guard."""
    slug = spec["slug"]
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
    ad(f"# GENERATED by bench/core/gen_campaign.py — QUALITY campaign '{slug}'. Resumable: rerun to")
    ad("# continue (per-config markers in tmp/done/). Edit the spec and regenerate. Behaviour:")
    ad("#   * Per config: serve ONE llama-server → sample VRAM/GTT/power → capture the task suite")
    ad("#     (capture_engine tasks: full telemetry, saved responses) → stop. Then deterministic")
    ad("#     scoring + SVG report. CONTINUE-ON-FAIL; PRE-FLIGHT VRAM GUARD skips a model predicted")
    ad("#     over budget (VRAM-only, no GTT spill/freeze).")
    ad("#   * Subset / short pass: ONLY='glob' picks configs; REPS=/MAX_TOKENS= shorten a run.")
    ad("#   * TWO ROOTS: raw (outputs.jsonl replies, props, GPU CSVs, done/ markers) -> <campaign>/tmp/;")
    ad("#     results (vram.jsonl, scores, failures/skipped, charts, appendix) -> <campaign>/results/.")
    for line in ([spec["notes"]] if isinstance(spec.get("notes"), str) else spec.get("notes", [])):
        ad(f"# NOTE: {line}")
    ad("set -uo pipefail")
    ad(RUNSH_ROOTS)
    ad('CORE="$ROOT/bench/core"; GPU="$ROOT/stack/gpu"; SERVE="$ROOT/stack/serve/llamacpp/serve_llamacpp.sh"')
    ad('mkdir -p "$RAW/done"')
    ad('OUTF="$RAW/outputs.jsonl"; VRAMF="$RES/vram.jsonl"   # raw replies+telemetry / per-config memory rows')
    ad(f'MODELS_DIR="${{MODELS_DIR:-{models_dir}}}"')
    ad(f'TASKS="${{TASKS:-$CAMPAIGN_DIR/inputs/{tasks_rel}}}"   # spec "tasks" is relative to the campaign\'s inputs/')
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
    ad('      | tee -a "$RES/skipped.txt"; return 1; fi')
    ad('  echo "  VRAM predicted ${pred} MiB (budget ${VRAM_BUDGET_MIB})"; return 0; }')
    ad(f'stop_server(){{ PORT={port} bash "$SERVE" stop 2>/dev/null || true; }}')
    ad("trap stop_server EXIT")
    ad("")
    ad('for entry in "${CONFIGS[@]}"; do')
    ad('  IFS="|" read -r label file mtp <<< "$entry"')
    ad('  want "$label" || { echo "skip (ONLY): $label"; continue; }')
    ad('  [ -f "$RAW/done/$label" ] && { echo "skip (done): $label"; continue; }')
    ad('  model="$MODELS_DIR/$file"')
    ad('  [ -f "$model" ] || { echo "MISSING MODEL: $model" | tee -a "$RES/failures.txt"; continue; }')
    ad('  echo "=== $label  (mtp=$mtp)  $file ==="')
    ad('  guard_ok "$model" || continue')
    ad('  t0=$(date +%s)')
    ad('  if MODEL="$model" BACKEND="$BACKEND" PORT="$PORT" CTX="$CTX" NP=1 UB="$UB" B="$B" FA="$FA" \\')
    ad('       KV="$KV" MTP="$mtp" bash "$SERVE" start; then')
    ad('    load_s=$(( $(date +%s) - t0 )); used=$(vram_used_mib)')
    ad('    echo "  VRAM at load: ${used} MiB  (load ${load_s}s)"')
    ad('    curl -s -m 10 "http://127.0.0.1:$PORT/props" > "$RAW/props_${label}.json" 2>/dev/null || true')
    ad('    msize=$(stat -c%s "$model" 2>/dev/null || echo 0)')
    ad('    csv="$RAW/gpu_${label}.csv"; SPID=""')
    ad('    if command -v rocm-smi >/dev/null 2>&1 || command -v nvidia-smi >/dev/null 2>&1; then')
    ad('      python3 "$GPU/vram_sampler.py" --out "$csv" --interval 1 & SPID=$!')
    ad('      for _ in 1 2 3 4; do [ -s "$csv" ] && [ "$(wc -l <"$csv")" -ge 2 ] && break')
    ad('        kill -0 "$SPID" 2>/dev/null || break; sleep 0.5; done')
    ad('    fi')
    ad('    python3 "$CORE/capture_engine.py" tasks --url "http://127.0.0.1:$PORT/v1" --config "$label" \\')
    ad('       --tasks "$TASKS" --out "$OUTF" --reps "$REPS" --max-tokens "$MAX_TOKENS" --api "$API" \\')
    ad('       && touch "$RAW/done/$label"')
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
    ad('    echo "SERVER FAILED to start: $label" | tee -a "$RES/failures.txt"')
    ad('  fi')
    ad('  stop_server; sleep 2')
    ad('done')
    ad("")
    ad('echo; echo "=== deterministic scoring ==="')
    ad('python3 "$ROOT/bench/quality/graders/score_deterministic.py" --tasks "$TASKS" \\')
    ad('  --outputs "$OUTF" --out "$RES/scores_deterministic.jsonl" || true')
    ad('echo; echo "=== charts + appendix (SVG, embedded in the write-up) ==="')
    ad('python3 "$CORE/report.py" "$CAMPAIGN_DIR" || true')
    ad('echo; echo "Phase A complete. Raw telemetry: $OUTF ; per-config VRAM/power: $VRAMF"')
    ad('echo "Next: Phase B (LLM-judge, see plan.md) → Phase C (write-up in docs/findings/, see plan.md)."')
    ad('[ -f "$RES/skipped.txt" ] && { echo "--- guard-skipped ---"; cat "$RES/skipped.txt"; } || true')
    return "\n".join(L) + "\n"


def emit_quality_plan(spec):
    slug = spec["slug"]
    date = campaign_date(spec)
    cd = campaign_rel(spec)
    title = spec.get("title", f"{slug} — quality shootout")
    rows = "\n".join(f"| `{c['label']}` | `{c['file']}` | {c.get('mtp', 0)} |" for c in spec["configs"])
    tune = spec.get("tuning", {})
    return f"""# {title} (R9700, {date})

*This is the campaign runbook (a **plan**, not a passive README). The results write-up lands in
`docs/findings/<topic>/{date}-{slug}.md` (meta `campaign: {cd}`, indexed by `docs/reindex.py`) after Phase C.*

Scaffolded by `bench/core/gen_campaign.py` (`kind: quality`). **Owner split:** Phase A (GPU capture +
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
bash {cd}/run.sh
# resume after interruption: same command (tmp/done/ markers skip finished configs)
# subset / short pass:  ONLY='unsloth*' REPS=1 MAX_TOKENS=2048 bash {cd}/run.sh
```
Writes raw `tmp/outputs.jsonl` (full responses + telemetry), `tmp/props_<label>.json`, `tmp/gpu_<label>.csv`;
results `results/vram.jsonl` (peak VRAM/GTT/power/thermal per config), `results/scores_deterministic.jsonl`,
`results/failures.txt` / `skipped.txt`, and `results/charts/` + `results/appendix.md`.

## Phase B — LLM-judge the open-ended tasks (in a Claude session)
The `judge`-category tasks (code review, explanations, refactors) have no deterministic answer.
Extract them into a paste-ready bundle, then judge them **in a Claude session** with the prompt
below (deterministic instruction; temp is the session's, so note it in the write-up):
```bash
python3 bench/quality/graders/prepare_judge.py \\
  --outputs {cd}/tmp/outputs.jsonl \\
  --tasks   {cd}/inputs/{spec.get('tasks', 'tasks/tasks.jsonl')} \\
  --out     {cd}/tmp/judge_bundle.md
```
Paste the ENTIRE `judge_bundle.md` into Claude under this exact prompt (the blocks are already
blind — opaque ids, shuffled — so you can't tell which model wrote which):

> You are grading LLM answers to open-ended tasks. For EACH `## Block <id>` below, score three axes
> as integers 0–5: **correctness** (factually right, no errors), **depth** (completeness / insight),
> **clarity** (well-structured, readable). Be strict and consistent; use the whole 0–5 range. Output
> ONLY a JSON array, one object per block, exact shape:
> `[{{"id": "b01", "correctness": 0, "depth": 0, "clarity": 0, "note": "one-line reason"}}]`
> No prose outside the JSON.

Save Claude's JSON array to `results/judge_raw.json` (committed: a judge session is not reproducible
by a rerun), then fold it in:
```bash
python3 bench/quality/graders/apply_judge_scores.py \\
  --raw {cd}/results/judge_raw.json \\
  --out {cd}/results/judge_scores.jsonl
python3 bench/core/report.py {cd}     # re-render with judge data
```

## Phase C — write-up (Claude)
Write `docs/findings/<topic>/{date}-{slug}.md` (summary + headline table first, **memory column
mandatory**), embed `results/appendix.md`, add a `<!-- meta -->` block with `date:`, `takeaway:` and
`campaign: {cd}`, and run `docs/reindex.py`.
"""


# ======================================================================================
# kind "agentic": real Claude Code sessions against a vllm server or a llama-swap row
# (one fresh server + worktree per rep x arm)
# ======================================================================================
AGENTIC_ENGINES = ("vllm", "llama-swap")
AGENTIC_DEFAULTS = {"maxseqs": 1, "kv_dtype": "fp8", "gpu_util": 0.93, "watchdog_mib": 32,
                    "free_mib_floor": 30000}      # dp-forge vllm.sh values; 30000 = sly-official floor
AGENTIC_SERVER_KEYS = ("maxlen", "maxseqs", "kv_dtype", "gpu_util", "watchdog_mib", "free_mib_floor")
LLAMASWAP_SERVER_KEYS = ("free_mib_floor",)       # the llama-swap row's config owns everything else
AGENTIC_KEYS = ("kind", "type", "slug", "date", "title", "notes", "engine", "port", "repo", "base", "worktree",
                "served_model", "server", "env", "claude", "prompt", "resume_prompt", "install", "rewrite",
                "symlinks", "done_when", "collect", "tmp_dirs", "cap_s", "max_resumes", "reps", "server_info",
                "post", "capture_requests", "remove_worktree", "stop_when", "arms", "reuse_server")
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

# `watch` subcommand: appended to the helper ONLY for specs with stop_when (other specs' run.sh stay unchanged).
AGENTIC_HELPER_WATCH = r'''

def _sw_match(obj, tool_re, input_re):
    """(name, input) of the first matching assistant tool_use block in a stream-json object, else None."""
    if not isinstance(obj, dict) or obj.get("type") != "assistant":
        return None
    msg = obj.get("message")
    content = msg.get("content") if isinstance(msg, dict) else None
    if not isinstance(content, list):
        return None
    for b in content:
        if isinstance(b, dict) and b.get("type") == "tool_use" and isinstance(b.get("name"), str):
            if tool_re.search(b["name"]) and input_re.search(json.dumps(b.get("input"), ensure_ascii=False)):
                return b["name"], b.get("input")
    return None


def _sw_signal(cpid, sig):
    for target in (-cpid, cpid):
        try:
            os.kill(target, sig)
            return True
        except OSError:
            pass
    return False


def cmd_watch(a):
    """watch CFG SESSION_FILE OUT_FILE CALL_IDX [CPID]: poll the growing stream-json file; at the first matching
    tool_use write OUT_FILE, then SIGINT the session's process group (escalating TERM, KILL) and exit 0."""
    import signal, time, datetime
    sw = json.load(open(a[0]))["stop_when"]
    tool_re, input_re = re.compile(sw["tool_regex"]), re.compile(sw["input_regex"])
    path, out, idx = a[1], a[2], a[3]
    cpid = int(a[4]) if len(a) > 4 and a[4] not in ("", "0") else 0
    pos, buf, lineno = 0, b"", 0
    while True:
        try:
            with open(path, "rb") as fh:
                fh.seek(pos)
                chunk = fh.read()
        except OSError:
            chunk = b""
        pos += len(chunk)
        buf += chunk
        while b"\n" in buf:
            raw, buf = buf.split(b"\n", 1)
            lineno += 1
            try:
                obj = json.loads(raw.decode("utf-8", errors="replace"))
            except ValueError:
                continue
            hit = _sw_match(obj, tool_re, input_re)
            if hit:
                ts = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
                txt = (f"call={idx}\nts={ts}\ntool={hit[0]}\nline={lineno}\n"
                       f"input={json.dumps(hit[1], ensure_ascii=False)}\n")
                with open(out + ".tmp", "w", encoding="utf-8") as fh:
                    fh.write(txt)
                os.replace(out + ".tmp", out)
                if cpid:
                    for sig, grace in ((signal.SIGINT, 30), (signal.SIGTERM, 30), (signal.SIGKILL, 0)):
                        if not _sw_signal(cpid, sig):
                            break
                        time.sleep(grace)    # the driver kills this watcher once the call has ended
                return 0
        time.sleep(1)
'''


def agentic_helper(stop_when):
    """The helper source embedded in run.sh (the `watch` subcommand only when the spec has stop_when)."""
    if not stop_when:
        return AGENTIC_HELPER
    head, tail = AGENTIC_HELPER.split("\n\nif __name__", 1)
    return head + "\n" + AGENTIC_HELPER_WATCH.rstrip("\n") + "\n\n\nif __name__" + tail


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
    """Per-arm resolved config: name, profile, image, env (merged), server (defaults < spec < arm).
    llama-swap: only free_mib_floor is resolved (profile/image empty, env {})."""
    ls = spec.get("engine") == "llama-swap"
    arms = []
    for a in spec["arms"]:
        srv = {k: v for k, v in AGENTIC_DEFAULTS.items() if not ls or k in LLAMASWAP_SERVER_KEYS}
        srv.update(spec.get("server") or {})
        srv.update(a.get("server") or {})
        arms.append({"name": a["name"], "profile": a.get("profile", ""), "image": a.get("image", ""),
                     "env": merge_env(spec.get("env"), a.get("env")), "server": srv})
    return arms


def validate_agentic(spec):
    """Emit-time validation for kind "agentic" (sys.exit with a clear message)."""
    for k in ("slug", "engine", "port", "repo", "base", "worktree", "served_model", "claude",
              "prompt", "resume_prompt", "done_when", "arms"):
        if k not in spec:
            sys.exit(f"agentic spec missing required key: {k}")
    unknown = [k for k in spec if k not in AGENTIC_KEYS]
    if unknown:
        sys.exit(f"agentic spec: unknown key(s) {unknown} (typo? known: {', '.join(AGENTIC_KEYS)})")
    if spec["engine"] not in AGENTIC_ENGINES:
        sys.exit('agentic spec: engine must be "vllm" or "llama-swap" (the engines the agentic driver launches)')
    ls = spec["engine"] == "llama-swap"
    reuse = bool(spec.get("reuse_server"))
    if not ls and not reuse and "server" not in spec:
        sys.exit("agentic spec missing required key: server (or set reuse_server=true to run against an already-running server)")
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
    if "reuse_server" in spec and not isinstance(spec["reuse_server"], bool):
        sys.exit("agentic spec: reuse_server must be true or false")
    if spec.get("reuse_server") and spec.get("capture_requests"):
        sys.exit("agentic spec: reuse_server and capture_requests are mutually exclusive -- the capture proxy puts the "
                 "server on port+1, but a user-managed server is fixed on the client port")
    if ls and spec.get("capture_requests"):
        sys.exit("agentic spec: capture_requests is vllm-only -- under engine llama-swap the router's port is fixed, "
                 "and the capture proxy needs the server on port+1")
    for k, lo in (("cap_s", 1), ("max_resumes", 0), ("reps", 1)):
        if k in spec and not _is_int(spec[k], lo):
            sys.exit(f"agentic spec: {k} must be an integer >= {lo}: {spec[k]!r}")
    for k in ("server_info", "post", "collect", "install", "rewrite", "symlinks", "tmp_dirs", "arms"):
        if k in spec and not isinstance(spec[k], list):
            sys.exit(f"agentic spec: {k} must be a list")
    for k in ("server_info", "post"):
        if not all(isinstance(c, str) and c.strip() for c in spec.get(k, [])):
            sys.exit(f"agentic spec: {k} must be a list of non-empty command strings")
    if "stop_when" in spec:
        sw = spec["stop_when"]
        if not isinstance(sw, dict) or set(sw) != {"tool_regex", "input_regex"}:
            sys.exit('agentic spec: stop_when must be {"tool_regex": "...", "input_regex": "..."} (both keys, no others)')
        for k, v in sw.items():
            if not isinstance(v, str) or not v:
                sys.exit(f"agentic spec: stop_when.{k} must be a non-empty python regex string")
            try:
                re.compile(v)
            except re.error as e:
                sys.exit(f"agentic spec: stop_when.{k} is not a valid python regex: {e}")

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
        vonly = [k for k in srv if ls and k in AGENTIC_SERVER_KEYS and k not in LLAMASWAP_SERVER_KEYS]
        if vonly:
            sys.exit(f"{where}: vllm-only key(s) {vonly} under engine llama-swap -- the llama-swap row's config "
                     f"owns them; allowed: {', '.join(LLAMASWAP_SERVER_KEYS)}")
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
    if not isinstance(spec.get("server", {}), dict):
        sys.exit("agentic spec: server must be an object")
    check_server(spec.get("server", {}), "agentic spec server")
    if "env" in spec:
        if ls:
            sys.exit("agentic spec: env is vllm-only -- under engine llama-swap the row's env lives in the "
                     "llama-swap config")
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
        if ls:
            vonly = [k for k in ("profile", "image", "env") if k in a]
            if vonly:
                sys.exit(f"{where}: vllm-only key(s) {vonly} under engine llama-swap -- model, build, flags and env "
                         "are the llama-swap row's (served_model); an arm takes only name (+ server.free_mib_floor)")
        elif reuse:
            # user-managed server: profile/image/env are ignored (the server is already running, on the client port);
            # an arm takes only name (env is carried but inert -- the server does not read per-arm env).
            pass
        else:
            if "profile" not in a:
                sys.exit(f"{where}: missing profile")
            prof = os.path.join(VLLM_PROFILES, str(a["profile"]) + ".env")
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
        if not ls and not reuse and "maxlen" not in a["server"]:
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
        if u.port is None:
            sys.exit(f"agentic spec: settings ANTHROPIC_BASE_URL has no explicit port ({sp})")
        if u.port != spec["port"]:
            sys.exit(f"agentic spec: settings ANTHROPIC_BASE_URL port {u.port} != spec port {spec['port']} ({sp})")
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


# Engine-specific run.sh fragments, selected at emit time (@@KEY@@ in AGENTIC_RUNSH), so each run.sh carries only
# its own engine's code. Everything else (served-name check, worktree, session loop, collect) is shared.
#
# SERVER_ACQUIRE is the server acquisition step: GPU-exclusive floor + (vllm/llama-swap) print + start. With
# reuse_server=true it is replaced by the "reuse" fragment: the user already has the server running, so the driver
# only verifies it (served-name check, shared), and does NOT boot, stop or unload it (iron rule 14 -- no gpu_exclusive,
# no kill of a process the driver does not own). The GPU sampler still runs to measure usage during the arm.
_AGENTIC_ENGINE_COMMON = {
    "vllm": {
        "SERVER_KIND": "vllm server",
        "ENGINE_HDR": r'''#   * Teardown is trap-protected (Ctrl-C/TERM): sampler, proxy, docker logs, serve_vllm stop, port-free check.
#   * Knobs: ONLY='armglob,..' REPS=N CAP_S=sec MAX_RESUMES=N CAMPAIGN_DIR=dir IMAGE=ref (beats the spec's per-arm image).
#     Tool paths (stub testing): SERVE_VLLM GPU_EXCLUSIVE VRAM_SAMPLER CAPTURE_PROXY CLAUDE_BIN DOCKER CURL SS.''',
        "SERVE_TOOL": 'SERVE_VLLM="${SERVE_VLLM:-$ROOT/stack/serve/vllm/serve_vllm.sh}"',
        "SERVE": "SERVE_VLLM",
        "PORT_FREE_FN": r'''port_free_check() {
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
}''',
    },
    "llama-swap": {
        "SERVER_KIND": "llama-server via llama-swap",
        "ENGINE_HDR": r'''#   * Teardown is trap-protected (Ctrl-C/TERM): sampler, serve_llamaswap stop (GET /unload). The llama-swap router
#     keeps its port by design (never stopped), so summary.tsv's port_free column is unloaded=yes|no.
#   * Knobs: ONLY='armglob,..' REPS=N CAP_S=sec MAX_RESUMES=N CAMPAIGN_DIR=dir.
#     Tool paths (stub testing): SERVE_LLAMASWAP GPU_EXCLUSIVE VRAM_SAMPLER CLAUDE_BIN CURL.''',
        "SERVE_TOOL": 'SERVE_LLAMASWAP="${SERVE_LLAMASWAP:-$ROOT/stack/serve/llamacpp/serve_llamaswap.sh}"',
        "SERVE": "SERVE_LLAMASWAP",
        "PORT_FREE_FN": r'''unload_check() {  # the router keeps its port by design: port_free records serve_llamaswap.sh stop's verdict
  R_PORTFREE=unloaded=no
  grep -qx 'unloaded=yes' "$ARM_DIR/server-stop.txt" 2>/dev/null && R_PORTFREE=unloaded=yes
  [ "$R_PORTFREE" = unloaded=yes ] || log "WARNING llama-swap did not confirm the unload of $SERVED (see $ARM_DIR/server-stop.txt)"
}''',
    },
    "reuse": {
        "SERVER_KIND": "user-managed vllm server (reuse_server)",
        "ENGINE_HDR": r'''#   * reuse_server=true: the server is ALREADY RUNNING (user-managed, :@@PORT@@). The driver does NOT boot, stop or
#     unload it -- no GPU-exclusive, no kill of a process the driver does not own (iron rule 14). It verifies the
#     served name (shared check) and samples the GPU (VRAM sampler) for the arm's memory column; teardown stops only
#     the sampler/proxy, leaving the server untouched. summary.tsv's port_free column reads 'reused'.
#   * Knobs: ONLY='armglob,..' REPS=N CAP_S=sec MAX_RESUMES=N CAMPAIGN_DIR=dir.
#     Tool paths (stub testing): SERVE_VLLM VRAM_SAMPLER CAPTURE_PROXY CLAUDE_BIN CURL.''',
        "SERVE_TOOL": 'SERVE_VLLM="${SERVE_VLLM:-$ROOT/stack/serve/vllm/serve_vllm.sh}"',
        "SERVE": "SERVE_VLLM",
        "PORT_FREE_FN": r'''reuse_check() {  # the driver never stops the server: port_free is 'reused' by definition
  R_PORTFREE=reused
}''',
    },
}

AGENTIC_ENGINE_SH = {
    "vllm": {
        **_AGENTIC_ENGINE_COMMON["vllm"],
        "LOOP_DESC": ("boots a FRESH vllm server (no prefix-cache carry-over between sessions),"),
        "SERVER_ACQUIRE": r'''  # 3. GPU exclusive (iron rule 14)
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
''',
        "SERVER_DOWN": r'''  "$DOCKER" logs "vllm-$SPORT" > "$ARM_DIR/server-container.log" 2>&1
  env PORT="$SPORT" "$SERVE_VLLM" stop > "$ARM_DIR/server-stop.txt" 2>&1
  port_free_check
  echo "port_free=$R_PORTFREE" >> "$ARM_DIR/server-stop.txt"''',
    },
    "llama-swap": {
        **_AGENTIC_ENGINE_COMMON["llama-swap"],
        "LOOP_DESC": ("preloads the llama-swap row (a fresh llama-server, no prefix-cache carry-over between sessions),"),
        "SERVER_ACQUIRE": r'''  # 3. GPU exclusive (iron rule 14)
  local gout rc
  gout=$("$GPU_EXCLUSIVE" "$A_FLOOR" 2>&1); rc=$?
  printf '%s\n' "$gout" > "$ARM_DIR/gpu_exclusive.txt"
  if [ "$rc" -ne 0 ]; then end_arm gpu_busy "$(printf '%s' "$gout" | tr '\t\n' '  ')"; return 0; fi
  # 4. server: provenance (print) then start = preload the llama-swap row (gpu_exclusive unloaded everything, so this
  #    is a fresh llama-server per (rep, arm)); its upstream log streams into server-container.log until stop
  local SRV_ENV=(MODEL="$SERVED" PORT="$SPORT" LOG_OUT="$ARM_DIR/server-container.log")
  log "preloading llama-swap row: ${SERVED}"
  TD_ACTIVE=1
  env "${SRV_ENV[@]}" "$SERVE_LLAMASWAP" print > "$ARM_DIR/server.txt" 2>&1
  if ! env "${SRV_ENV[@]}" "$SERVE_LLAMASWAP" start > "$ARM_DIR/server-start.txt" 2>&1; then
    detail=$(tail -n 3 "$ARM_DIR/server-start.txt" | tr '\t\n' '  ')
    teardown; end_arm server_fail "$detail"; return 0
  fi
''',
        "SERVER_DOWN": r'''  # server-container.log was written by serve_llamaswap.sh's log follower (start .. stop)
  env PORT="$SPORT" MODEL="$SERVED" "$SERVE_LLAMASWAP" stop > "$ARM_DIR/server-stop.txt" 2>&1
  unload_check
  echo "port_free=$R_PORTFREE" >> "$ARM_DIR/server-stop.txt"''',
    },
    "reuse": {
        **_AGENTIC_ENGINE_COMMON["reuse"],
        "LOOP_DESC": ("reuses the ALREADY-RUNNING user-managed server on :@@PORT@@ (no boot/stop/unload; the same prefix cache "
                      "is shared across arms),"),
        "SERVER_ACQUIRE": r'''  # 3. server: already running (reuse_server) -- verify it serves the right name, do NOT boot, stop or unload it
  #     (no GPU exclusive: the user's server owns the GPU; we must not unload or kill it)
  local SRV_ENV=(PORT="$SPORT")
  local img="(user's running server; reuse_server=true)"
  TD_ACTIVE=1
  log "reusing user-managed server on :$SPORT (no boot/stop; no GPU exclusive)"
  { printf '# reuse_server=true -- server managed by the user, not by this driver\n'
    printf '#   IMAGE=reused (user-managed)\n#   PORT=%s SERVED=%s\n' "$SPORT" "$SERVED"; } > "$ARM_DIR/server.txt" 2>&1
  if ! "$CURL" -sf -m 10 "http://127.0.0.1:$SPORT/v1/models" > "$ARM_DIR/served-models-live.txt" 2>&1; then
    detail="server on :$SPORT is not responding (reuse_server=true) -- is it up?"
    teardown; end_arm server_fail "$detail"; return 0
  fi
''',
        "SERVER_DOWN": r'''  # reuse_server: leave the user's server alone (no stop, no unload). The GPU sampler was stopped above.
  reuse_check
  echo "port_free=reused (user-managed server left untouched)" > "$ARM_DIR/server-stop.txt"''',
    },
}

AGENTIC_RUNSH = r'''#!/usr/bin/env bash
# GENERATED by bench/core/gen_campaign.py -- AGENTIC campaign '@@SLUG@@'. Rerun to continue; edit the spec and regenerate.
# Loop: reps outer, arms inner. EVERY (rep, arm) @@LOOP_DESC@@ creates a fresh git worktree at the base
# commit, runs `claude -p` (same session resumed until done_when / cap / max_resumes), then tears down and collects.
# Behaviour baked in (no hand-editing needed):
#   * CONTINUE-ON-FAILURE: wt_exists | gpu_busy | server_fail | served_name_mismatch | wt_fail | prep_fail |
#     proxy_fail are recorded in failures.txt and the run moves on. They leave NO marker, so a rerun retries them.
#   * tmp/started/rep<R>.<arm> is written when the session loop begins; tmp/done/... only for the RESULT
#     statuses done|cap|max_resumes (a cap is a measured outcome). Started-without-done = `interrupted`
#     (also what a claude_error leaves): recorded, SKIPPED, never auto-deleted or auto-retried (iron rule 18).
#   * TWO ROOTS: raw -> <campaign>/tmp/ (done/ started/ markers, .lock, driver.log, agentic_helper.py, stale/,
#     per-arm dirs rep<R>/<arm>/ with server logs, transcripts, GPU CSV, diffs, outputs);
#     results -> <campaign>/results/ (summary.tsv, failures.txt, spec.resolved.json).
@@ENGINE_HDR@@
@@NOTES@@
set -uo pipefail
[ -z "${RUN_DIR:-}" ] || { echo "RUN_DIR is no longer a knob: set CAMPAIGN_DIR (raw -> \$CAMPAIGN_DIR/tmp, results -> \$CAMPAIGN_DIR/results)" >&2; exit 2; }
@@ROOTS@@
RUN_DIR="$RAW"   # the raw root (markers, lock, driver log, per-arm dirs)
@@SERVE_TOOL@@
GPU_EXCLUSIVE="${GPU_EXCLUSIVE:-$ROOT/stack/gpu/gpu_exclusive.sh}"
VRAM_SAMPLER="${VRAM_SAMPLER:-$ROOT/stack/gpu/vram_sampler.py}"
CAPTURE_PROXY="${CAPTURE_PROXY:-$ROOT/bench/core/capture_proxy.py}"
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
flock -n 9 || { echo "another run.sh holds $RUN_DIR/.lock -- refusing to run two drivers on one campaign dir" >&2; exit 1; }
# provenance: the exact helper and resolved config this run used
cat > "$RUN_DIR/agentic_helper.py" <<'@@HTAG@@'
@@HELPER@@
@@HTAG@@
cat > "$RES/spec.resolved.json" <<'@@CTAG@@'
@@CFGJSON@@
@@CTAG@@
CFG="$RES/spec.resolved.json"

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
  [ -e "$RES/summary.tsv" ] || printf 'rep\tarm\tstatus\twall_s\tcalls\tresumes\tdone_line\tmain_unchanged\tport_free\timage\tenv\n' \
    > "$RES/summary.tsv"
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$REP" "$ARM" "$R_STATUS" "$R_WALL" "$R_CALLS" "$R_RESUMES" \
    "$(printf '%s' "$R_DONE_LINE" | tr '\t\n' '  ')" "$R_MAIN" "$R_PORTFREE" "$img" "${A_ENV_STR:--}" >> "$RES/summary.tsv"
}
end_arm() {  # status [detail]: record the outcome (non-result statuses also go to failures.txt)
  R_STATUS=$1
  case "$R_STATUS" in
    done|cap|max_resumes@@STOP_STATUS@@) ;;
    *) printf 'rep%s\t%s\t%s\t%s\n' "$REP" "$ARM" "$R_STATUS" "${2:-}" >> "$RES/failures.txt"
       log "FAILED $R_STATUS: ${2:-}" ;;
  esac
  summary_row
}

@@PORT_FREE_FN@@
teardown() {  # idempotent; also runs from the EXIT/INT/TERM traps
  [ "${TD_ACTIVE:-0}" = 1 ] || return 0
  TD_ACTIVE=0
  [ -n "${SAMP:-}" ] && { kill "$SAMP" 2>/dev/null; wait "$SAMP" 2>/dev/null; SAMP=""; }
  [ -n "${PROXY:-}" ] && { kill "$PROXY" 2>/dev/null; wait "$PROXY" 2>/dev/null; PROXY=""; }
  [ -d "$ARM_DIR/requests" ] && find "$ARM_DIR/requests" -type f ! -name '*.gz' -exec gzip -f {} +
@@SERVER_DOWN@@
}
on_signal() {
  local code=130; [ "$1" = TERM ] && code=143
  trap - INT TERM@@WATCH_SIGNAL@@
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
    if ! grep -qF "$(printf 'rep%s\t%s\tinterrupted\t' "$REP" "$ARM")" "$RES/failures.txt" 2>/dev/null; then
      mkdir -p "$ARM_DIR"; end_arm interrupted "started marker without done marker; see driver.log"
    fi
    return 0
  fi
  mkdir -p "$ARM_DIR"
  # 2. worktree path already taken: never touch it
  if [ -e "$WT" ]; then end_arm wt_exists "worktree path exists, not touched: $WT"; return 0; fi
@@SERVER_ACQUIRE@@
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
    set +m@@WATCH_START@@
    wait "$CPID"; rc=$?@@WATCH_STOP@@
    CPID=""
    te=$(date +%s)
    printf '%s\t%s\t%s\t%s\n' "$n" "$now" "$te" "$rc" >> "$ARM_DIR/calls.tsv"
    s=$(pyh sid "$ARM_DIR/session-$n.jsonl"); [ -n "$s" ] && sid=$s
    log "call $n rc=$rc session=$sid"@@STOP_CHECK@@
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
  case "$R_STATUS" in done|cap|max_resumes@@STOP_STATUS@@) date -Iseconds > "$RUN_DIR/done/$key";; esac
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
echo; echo "=== run done: $CAMPAIGN_DIR (results: $RES, raw: $RUN_DIR) ==="
[ -f "$RES/summary.tsv" ] && cat "$RES/summary.tsv"
[ -f "$RES/failures.txt" ] && { echo "--- failures (nothing here is auto-retried if it was interrupted/claude_error) ---"; cat "$RES/failures.txt"; }
exit 0
'''


# run.sh fragments for stop_when (emit-time selection: specs without it get AGENTIC_STOP_OFF = all empty, so their
# run.sh is unchanged). The watcher is a direct background python (so $WPID is the real pid, killable).
AGENTIC_STOP_OFF = {k: "" for k in ("STOP_STATUS", "WATCH_SIGNAL", "WATCH_START", "WATCH_STOP", "STOP_CHECK")}
AGENTIC_STOP_SH = {
    "STOP_STATUS": "|stopped",
    "WATCH_SIGNAL": '\n  [ -n "${WPID:-}" ] && { kill "$WPID" 2>/dev/null; wait "$WPID" 2>/dev/null; WPID=""; }',
    "WATCH_START": '\n    rm -f "$ARM_DIR/stop_when.txt"\n'
                   '    python3 -I "$RUN_DIR/agentic_helper.py" watch "$CFG" "$ARM_DIR/session-$n.jsonl" '
                   '"$ARM_DIR/stop_when.txt" "$n" "$CPID" > /dev/null 2>> "$ARM_DIR/watch.err" 9>&- &\n'
                   '    WPID=$!',
    "WATCH_STOP": '\n    [ -n "${WPID:-}" ] && { kill "$WPID" 2>/dev/null; wait "$WPID" 2>/dev/null; WPID=""; }',
    "STOP_CHECK": '\n    # stop_when fired: the watcher wrote stop_when.txt and sent INT -- a RESULT, whatever rc/done_when say\n'
                  '    [ -s "$ARM_DIR/stop_when.txt" ] && { R_STATUS=stopped; break; }',
}


def emit_agentic_runsh(spec):
    arms = agentic_arms(spec)
    base = _resolve_base(spec)
    cfg = {"install": _norm_install(spec), "rewrite": spec.get("rewrite", []), "symlinks": spec.get("symlinks", []),
           "done_when": spec["done_when"], "collect": spec.get("collect", []), "spec": spec}
    if spec.get("stop_when"):
        cfg["stop_when"] = spec["stop_when"]
    cfg_json = json.dumps(cfg, indent=1, ensure_ascii=False)
    reuse = bool(spec.get("reuse_server"))
    cases = []
    for a in arms:
        sv = a["server"]
        cases.append(f"    {sh_quote(a['name'])})")
        if reuse:  # user-managed server: the server block is ignored; the arm carries only its env
            cases.append(f"      A_ENV=({' '.join(sh_quote(f'{k}={v}') for k, v in a['env'].items())}); "
                         f"A_ENV_STR={sh_quote(env_assign(a['env']))} ;;")
            continue
        if spec["engine"] == "llama-swap":       # the row's config owns the rest; A_ENV stays empty
            cases.append(f"      A_FLOOR={sh_quote(sv['free_mib_floor'])} ;;")
            continue
        cases.append(f"      A_PROFILE={sh_quote(a['profile'])}; A_IMAGE={sh_quote(a['image'])}; "
                     f"A_MAXLEN={sh_quote(sv['maxlen'])}; A_MAXSEQS={sh_quote(sv['maxseqs'])}; "
                     f"A_KV={sh_quote(sv['kv_dtype'])}; A_GPU_UTIL={sh_quote(sv['gpu_util'])}; "
                     f"A_WD={sh_quote(sv['watchdog_mib'])}; A_FLOOR={sh_quote(sv['free_mib_floor'])}")
        cases.append(f"      A_ENV=({' '.join(sh_quote(f'{k}={v}') for k, v in a['env'].items())}); "
                     f"A_ENV_STR={sh_quote(env_assign(a['env']))} ;;")
    notes = spec.get("notes")
    note_lines = "\n".join(f"# NOTE: {l}" for l in ([notes] if isinstance(notes, str) else (notes or [])))
    sw = spec.get("stop_when")
    engine_frag = "reuse" if reuse else spec["engine"]
    helper_tag = _heredoc_tag("GC_HELPER_EOF", agentic_helper(sw))
    cfg_tag = _heredoc_tag("GC_CFG_EOF", cfg_json)
    vals = {
        "SLUG": spec["slug"], "ROOTS": RUNSH_ROOTS, "NOTES": note_lines,
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
        "HELPER": agentic_helper(sw).rstrip("\n"), "CFGJSON": cfg_json,
    **(AGENTIC_STOP_SH if sw else AGENTIC_STOP_OFF),
    }
    # some engine fragments carry @@PORT@@ inside their values (e.g. reuse's LOOP_DESC/ENGINE_HDR); the template
    # pass only substitutes placeholders in the template, not the inserted values, so pre-substitute those here.
    # Only the fragment values are pre-substituted, so a literal @@WT@@ runtime placeholder in the cfg_json or
    # helper (which are NOT fragments) is never touched.
    engine = dict(AGENTIC_ENGINE_SH[engine_frag])
    for k, v in engine.items():
        if isinstance(v, str) and "@@" in v:
            engine[k] = re.sub(r"@@(\w+)@@", lambda m: vals[m.group(1)], v)
    vals.update(engine)
    return re.sub(r"@@(\w+)@@", lambda m: vals[m.group(1)], AGENTIC_RUNSH)


def _fence(text):
    n = max([len(m) for m in re.findall(r"`+", text)] + [2]) + 1
    return "`" * n


def emit_agentic_readme(spec):
    slug = spec["slug"]
    date = campaign_date(spec)
    cd = campaign_rel(spec)
    title = spec.get("title", f"{slug} agentic campaign")
    arms = agentic_arms(spec)
    base = _resolve_base(spec)
    served, port = spec["served_model"], spec["port"]
    if spec.get("reuse_server"):
        boot = (f"reuses the **already-running** user-managed server on :{port} (the driver does **not** boot, stop or "
                f"unload it, and does not run `gpu_exclusive.sh`)")
        engine = (f"- Engine **user-managed vllm** (reuse_server): the server is **already running** on :{port} (served "
                  f"model\n  `{served}`; must match the claude settings' model names, checked against `/v1/models` "
                  f"before each arm). The driver does **not** boot, stop or unload it\n  (iron rule 14): it never runs "
                  f"`gpu_exclusive.sh` and never kills a process it does not own. Each arm's `server.txt` notes the "
                  f"reuse; the GPU sampler records VRAM/GTT\n  during the arm. `summary.tsv`'s `port_free` column reads "
                  f"`reused` (the server is left running after every arm).")
        prov = ("- The server's exact template/δ/KV come from the running container (the user manages it); `server.txt` "
                "records\n  `reuse_server=true` and the live `/v1/models` response. The `server` block is ignored in "
                "reuse mode.")
        arms_tbl = f"| arm | served model | port |\n|-----|--------------|-----:|\n" + \
                   "\n".join(f"| `{a['name']}` | `{served}` | {port} |" for a in arms)
        per_boot = f"Per arm, the driver verifies the server is up and serves `{served}` (shared `/v1/models` check); it " \
                   "does not touch the GPU otherwise."
    elif spec["engine"] == "llama-swap":
        boot = (f"loads the llama-swap row `{served}` **fresh** (`gpu_exclusive.sh` unloads every model first, so the "
                "prefix cache never carries over)")
        engine = ("- Engine **llama-swap** via `stack/serve/llamacpp/serve_llamaswap.sh`: the server is the llama-swap row "
                  f"`{served}` of the\n  persistent router on :{port} (also the client port; the row id must equal the "
                  "claude settings' model names,\n  checked at emit time and against `/v1/models` per boot). `start` "
                  "preloads the row and streams its upstream\n  llama-server log into `server-container.log`; after each "
                  "arm `stop` unloads it (GET `/unload`) and `summary.tsv`'s\n  `port_free` column records "
                  "`unloaded=yes|no`. The router itself stays up by design (never stopped).")
        prov = ("- The row's binary, gguf, ctx, KV, flags, env and chat template come from the llama-swap config; "
                "`serve_llamaswap.sh print`\n  records them (config sha256, resolved cmd, llama-server version, gguf) "
                "in each arm's `server.txt`.")
        arms_tbl = ("| arm | served model (llama-swap row) | free_mib_floor |\n|-----|-------------------------------|"
                    "---------------:|\n" + "\n".join(f"| `{a['name']}` | `{served}` | {a['server']['free_mib_floor']} |"
                                                     for a in arms))
        per_boot = "Per boot, `gpu_exclusive.sh <free_mib_floor>` unloads llama-swap and asserts the floor before `start`."
    else:
        rows = []
        for a in arms:
            sv = a["server"]
            rows.append(f"| `{a['name']}` | `{a['profile']}` | " + (f"`{a['image']}`" if a["image"] else "profile default")
                        + f" | {('`' + env_assign(a['env']) + '`') if a['env'] else '-'} | `{served}` | "
                        f"{sv['maxlen']} | {sv['maxseqs']} | {sv['kv_dtype']} | {sv['gpu_util']} |")
        boot = "boots a **fresh** vllm server (so the prefix cache never carries over)"
        engine = (f"- Engine vLLM (docker) via `stack/serve/vllm/serve_vllm.sh` · served model `{served}` (exported as\n"
                  "  `SERVED_NAME`; must equal the claude settings' model names, checked at emit time and against "
                  f"`/v1/models` per boot)\n  · client port :{port}"
                  + (f" (capture proxy; server on :{port + 1})" if spec.get("capture_requests") else "") + ".")
        prov = ("- Per-arm `IMAGE=` / run-time `IMAGE=` beat the profile default; the resolved image is in each arm's "
                "`server.txt`.")
        arms_tbl = ("| arm | profile | image | env | served model | maxlen | maxseqs | kv | gpu_util |\n"
                    "|-----|---------|-------|-----|--------------|-------:|--------:|----|---------:|\n" + "\n".join(rows))
        per_boot = ("Also per boot: `WATCHDOG_MIB`/`FREE_MIB_FLOOR` as in `server.txt`; the exact env of every boot is "
                    "printed there\n(`serve_vllm.sh print`, written before `start`).")
    inst = []
    for it in _norm_install(spec):
        inst.append(f"| `{it['src']}` | `{it['dst']}` | `{_file_sha256(it['src'])}` |")
    inst_tbl = ("| src | dst (worktree-relative) | sha256 at emit time |\n|-----|-----|-----|\n" + "\n".join(inst)
                if inst else "(none)")
    pf, rf = _fence(spec["prompt"]), _fence(spec["resume_prompt"])
    swd = spec.get("stop_when")
    sw_md = ("" if not swd else
             f"- `stop_when`: tool name `{swd['tool_regex']}` AND tool input (JSON) `{swd['input_regex']}` (python `re.search`). "
             "A watcher follows each call's stream-json file; at the FIRST assistant `tool_use` matching both it writes "
             "`<arm_dir>/stop_when.txt` (call, ts, tool, line, input) and sends SIGINT to the session's process group. "
             "The arm then ends with status `stopped` -- a **result** (done marker written, never resumed); it takes "
             "precedence over `done_when`/`cap`/`max_resumes`/`claude_error` for that call. Text, `tool_result` and "
             "user messages never match.\n")
    dw = spec["done_when"]
    wt_extra = []
    for k in ("rewrite", "symlinks", "collect", "tmp_dirs", "server_info", "post"):
        if spec.get(k):
            wt_extra.append(f"- `{k}`: `{json.dumps(spec[k], ensure_ascii=False)}`")
    cap = spec.get("cap_s", 10800)
    return f"""# {title} (R9700, {date})

Scaffolded by `bench/core/gen_campaign.py` (`kind: agentic`). The executable driver is **`run.sh`** in this folder.
Each (rep, arm) {boot}, creates a **fresh git
worktree** of `{spec['repo']}` at `{base}`, runs a real `claude -p` session (same session resumed until `done_when`),
tears the server down and collects the outputs. Loop order: reps outer, arms inner (arms interleave).

## Fixed parameters
{engine}
- Claude settings `{spec['claude']['settings']}` · args `{' '.join(spec['claude'].get('args', []))}`.
- Base `{spec['base']}` = `{base}` · worktree template `{spec['worktree']}`.
{prov}

## Arms
{arms_tbl}

{per_boot}

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
{sw_md}- Statuses: `done`, `cap`, `max_resumes`{', `stopped`' if swd else ''} are results (done marker written). `interrupted`/`claude_error` are quarantined
  (never auto-deleted, never auto-retried). `wt_exists`, `gpu_busy`, `server_fail`, `served_name_mismatch`, `wt_fail`,
  `prep_fail`, `proxy_fail` leave no marker, so a rerun retries them.

## Placeholders
`{{wt}}` `{{arm}}` `{{rep}}` `{{arm_dir}}` `{{port}}` `{{server_port}}` in the worktree template (no `{{wt}}`), `rewrite.to`,
`server_info` and `post` commands. Prompts are NOT substituted.

## Run / rerun / re-collect
```bash
bash {cd}/run.sh
# resume after interruption: same command (tmp/done/ markers skip finished arms)
# subset / shorter:  ONLY='s1-*' REPS=1 CAP_S=3600 MAX_RESUMES=2 bash {cd}/run.sh
# another campaign dir: CAMPAIGN_DIR=/path bash {cd}/run.sh
```
Output: `results/` (committed): `summary.tsv` (rep, arm, status, wall_s, calls, resumes, done_line,
main_unchanged, port_free, image, env), `failures.txt`, `spec.resolved.json`; `tmp/` (git-ignored raw):
`done/`, `started/`, `.lock`, `driver.log`, `agentic_helper.py`, `stale/`, and per (rep, arm) `rep<R>/<arm>/`:
`server.txt`, `calls.tsv`, `session-N.jsonl`, `gpu_samples.csv`, `wt.diff`, `outputs/`, `tmp/`,
`claude-project/`, `main-*.txt`.

An **interrupted** arm (started marker, no done marker) is reported and skipped on every rerun. Nothing is deleted. To
re-collect by hand use the commands `run.sh` prints (worktree status/diff, the spec's `collect` paths, the
`~/.claude/projects/` transcript). To retry from scratch: remove its `started/` marker, move its arm dir aside, and
`git worktree remove --force` its worktree, then rerun.

## Write-up
**benchmark-results** skill -> `docs/findings/<topic>/{date}-{slug}.md` (summary + table first), with
`campaign: {cd}` (plus `date:` and `takeaway:`) in its `<!-- meta -->` block; run `docs/reindex.py`.
"""


# ======================================================================================
# Multi-engine throughput (G1, 27B-arms speed plan §4): servers[].engine in {llamacpp, vllm, radiance}
# in ONE campaign, one engine at a time. The probe cells come from a campaign-wide `workload` block
# (cold depth ladder, n=2 concurrency, growing conversation, drift sentinel, opt-in smoke cells).
# The single-engine throughput path above is untouched (a spec whose servers carry no `engine`).
# ======================================================================================
MULTI_ENGINES = ("llamacpp", "vllm", "radiance")
PHYS_VRAM_MIB = 32624                    # R9700 physical VRAM (MiB): a free-VRAM floor above it never passes
LLAMASWAP_PORT = 9292                    # gpu_exclusive.sh's SWAP_PORT: the persistent llama-swap router
TASKS_DIR = os.path.join(REPO, "bench", "workloads", "tasks")
MULTI_TOP_KEYS = ("kind", "type", "slug", "date", "title", "notes", "port", "tuning", "workload", "sampling",
                  "pins", "servers")
SINGLE_ONLY_TOP = ("model", "engine", "profile", "served_model", "image", "backend", "env", "vram")
MULTI_COMMON_KEYS = ("name", "engine", "arm", "pass", "tier", "served_model", "ctx", "np", "kv", "port", "env",
                     "extra_args", "free_mib_floor", "working_set_mib", "rep_penalty_key", "spec", "depths",
                     "conv_max_depth")
MULTI_ENGINE_KEYS = {   # per-engine fields: required, optional (any other engine's field is rejected)
    "llamacpp": (("gguf", "bin"), ("backend", "mtp")),
    "vllm": (("profile", "image", "spec"), ("model",)),
    "radiance": (("rad_file", "image", "spec_tokens"), ()),
}
REP_KEYS = ("repeat_penalty", "repetition_penalty")
DEFAULT_REP_KEY = {"llamacpp": "repeat_penalty", "vllm": "repetition_penalty", "radiance": None}  # radiance: UNVERIFIED
MULTI_RESERVED_ENV = RESERVED_ENV + ("SERVED_NAME", "FREE_MIB_FLOOR", "EXTRA_ARGS", "RAD_FILE", "CONTAINER_NAME",
                                     "TP", "WAIT", "MODEL", "LLAMA_SERVER", "BACKEND", "CTX", "NP", "KV", "MTP",
                                     "UB", "B", "FA")
OWN_FLAGS = {   # extra_args may not repeat a flag the server has its own field for
    "llamacpp": ("--alias", "-m", "--model", "-c", "--ctx-size", "-np", "--parallel", "-ctk", "-ctv",
                 "--cache-type-k", "--cache-type-v", "--port", "--host", "--spec-type", "-ub", "-b", "-fa", "-ngl"),
    "vllm": ("--served-model-name", "--max-model-len", "--max-num-seqs", "--kv-cache-dtype", "--port", "--host",
             "--model", "--gpu-memory-utilization"),
    "radiance": ("--num-speculative-tokens", "--served-model-name", "--max-model-len", "--max-num-seqs",
                 "--kv-cache-dtype", "--port", "--host", "--model", "--tp"),
}
EXTRA_TOKEN_RE = re.compile(r"[\w.:/@,+=-]+", re.ASCII)
PATH_RE = re.compile(r"/[\w./@:+-]+", re.ASCII)       # shell-inert and printf-%q-stable (cmdline needles)
GLOB_RE = re.compile(r"/[\w./@:+*?-]+", re.ASCII)
TAG_VAL_RE = re.compile(r"[A-Za-z0-9._-]+")
SERVED_RE = re.compile(r"[A-Za-z0-9._:/-]+")
SHA256_RE = re.compile(r"[0-9a-f]{64}")
DIGEST_RE = re.compile(r"(sha256:)?[0-9a-f]{12,64}")
WORKLOAD_DEFAULTS = {"tier": "minimal", "pass": "A", "api": "chat", "max_tokens": 1024, "min_gen": 900,
                     "prefix_mode": "unique", "fixture": "codereview-{depth}.txt", "first_warmup": 2,
                     "repetition_penalty": 1.0}
MULTI_TUNING_DEFAULTS = {"ub": 2048, "b": 8192, "fa": "on"}     # serve_llamacpp.sh's defaults, passed explicitly
EB_CONTRACT = ("SAMPLING", "MIN_GEN", "TAGS", "SPEC_ROWS", "STATUS_OUT")   # `engine-bench/run.sh --capabilities`
SPEC_ROWS_MODE = {"llamacpp": "rows", "vllm": "diff", "radiance": "diff"}    # G3 wiring: rows on llama.cpp only
RADIANCE_REP_WARN = ("penalty UNVERIFIED until the smoke confirms radiance's key: no repetition penalty is sent, so "
                     "the engine's own default applies")
FIXTURES_SHA_FORMAT = ("`sha256sum` output for bare file names, checked from bench/workloads/tmp/: build it with "
                       "`(cd bench/workloads/tmp && sha256sum codereview-8000.txt ...) > inputs/fixtures.sha256`")


def is_multi(spec):
    """A throughput spec is multi-engine when its servers carry `engine` (validate_multi: all or none)."""
    srv = spec.get("servers")
    return isinstance(srv, list) and any(isinstance(s, dict) and "engine" in s for s in srv)


def _isint(v, lo=None):
    return isinstance(v, int) and not isinstance(v, bool) and (lo is None or v >= lo)


def _isnum(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def multi_workload(spec):
    w = dict(WORKLOAD_DEFAULTS)
    w.update(spec.get("workload") or {})
    return w


def _workload_name(fixture):
    """codereview-{depth}.txt -> codereview (the `workload` tag)."""
    return fixture.split("{depth}")[0].rstrip("-_.") or "fixture"


def multi_server(spec, s):
    """Normalized view of one multi-engine server (defaults applied; validate_multi has run)."""
    w = multi_workload(spec)
    eng = s["engine"]
    lad = w["ladder"]
    if eng == "llamacpp":
        derived = s.get("mtp", 0) == 1
    elif eng == "radiance":
        derived = _isint(s.get("spec_tokens")) and s["spec_tokens"] > 0
    else:
        derived = bool(s.get("spec"))
    conv = w.get("conversation") or {}
    return {
        "name": s["name"], "engine": eng, "arm": s.get("arm", s["name"]),
        "pass": s.get("pass", w["pass"]), "tier": s.get("tier", w["tier"]),
        "port": s.get("port", spec.get("port", 8000)),
        "floor": s.get("free_mib_floor", 30000), "ws": s["working_set_mib"],
        "rep_key": s.get("rep_penalty_key", DEFAULT_REP_KEY[eng]),
        "spec": bool(s.get("spec", derived)),
        "depths": list(s.get("depths", lad["depths"])),
        "conv_max_depth": s.get("conv_max_depth", conv.get("max_depth")),
        "kv_unified": "--kv-unified" in (s.get("extra_args") or "").split(),
        "rep_tag": s.get("rep_penalty_key", DEFAULT_REP_KEY[eng]) or "UNVERIFIED",
    }


def conv_min_gen(w):
    """The conversation min-gen gate: explicit `conversation.min_gen`, else 0 (off; user decision
    2026-11-13: natural agent turns end early, a short turn is real behaviour, not an interrupted run)."""
    return (w.get("conversation") or {}).get("min_gen", 0)


def multi_sampling(spec, s):
    """The compact --sampling JSON for one server: campaign sampling + the repetition penalty under the
    engine's own key (llama.cpp repeat_penalty, vLLM repetition_penalty, radiance: none unless set)."""
    smp = dict(spec["sampling"])
    rp = multi_workload(spec).get("repetition_penalty")
    key = multi_server(spec, s)["rep_key"]
    if key and rp is not None:
        smp[key] = rp
    return json.dumps(smp, separators=(",", ":"))


def multi_cells(spec, s):
    """Probe cells of one server, in run order (plan §2.5): smoke (opt-in) -> ladder ascending, each n=N cell
    right after the ladder cell of its depth -> drift sentinel right after the ladder -> conversation.
    Tags exclude tg and residency (run.sh appends tg=<effective max_tokens>, residency=<this boot's check>)."""
    w = multi_workload(spec)
    m = multi_server(spec, s)
    lad, wl = w["ladder"], _workload_name(w["fixture"])
    base = {"arm": m["arm"]}
    tail = {"pass": m["pass"], "tier": m["tier"]}
    cells = []
    cmg = conv_min_gen(w) if w.get("conversation") else 0

    def probe(slug, cell, depth, n, reps, tier=None):
        tags = dict(base, depth=depth, n=n, workload=wl, **tail)
        if tier:
            tags["tier"] = tier
        tags["cell"] = cell
        tags["rep_key"] = m["rep_tag"]
        cells.append({"slug": slug, "mode": "probe", "cell": cell, "depth": depth, "n": n, "reps": reps,
                      "max_tokens": w["max_tokens"], "min_gen": w["min_gen"],
                      "fixture": w["fixture"].replace("{depth}", str(depth)), "tags": tags})

    def conv(slug, cell, max_depth, reps, tier=None):
        c = w["conversation"]
        tags = dict(base, n=1, workload="conversation", **tail)
        if tier:
            tags["tier"] = tier
        tags["cell"] = cell
        tags["rep_key"] = m["rep_tag"]
        cells.append({"slug": slug, "mode": "conv", "cell": cell, "n": 1, "reps": reps,
                      "max_tokens": c.get("max_tokens", 512), "min_gen": cmg, "fixture": c["prompt"],
                      "start": c.get("start_tokens", 10000), "step": c.get("step_tokens", 20000),
                      "max_depth": max_depth, "turn_prompt": c.get("turn_prompt", ""),
                      "kwargs": json.dumps(c["chat_template_kwargs"], separators=(",", ":"))
                      if c.get("chat_template_kwargs") else "", "tags": tags})

    sm = w.get("smoke")
    if sm:
        probe(f"{m['name']}-smoke-d{sm['depth']}", "smoke", sm["depth"], 1, 1, tier="smoke")
        if w.get("conversation"):   # one turn: max_depth = start_tokens stops after turn 0
            conv(f"{m['name']}-smoke-conv", "smoke", w["conversation"].get("start_tokens", 10000), 1, tier="smoke")
    spec_depths = set(lad.get("spec_depths", []))
    cc = w.get("concurrency")
    conc_d = list(cc["depths"]) if cc and int(s["np"]) >= cc["n"] else []
    order = sorted([(d, 0) for d in m["depths"]] + [(d, 1) for d in conc_d])   # (depth, ladder before n=N)
    for d, k in order:
        if k == 0:
            reps = lad.get("spec_reps", lad.get("reps", 3)) if m["spec"] and d in spec_depths else lad.get("reps", 3)
            probe(f"{m['name']}-d{d}-n1", "ladder", d, 1, reps)
        else:
            probe(f"{m['name']}-d{d}-n{cc['n']}", "conc", d, cc["n"], cc.get("reps", 3))
    se = w.get("sentinel")
    if se:
        probe(f"{m['name']}-sentinel-d{se['depth']}", "sentinel", se["depth"], 1, se.get("reps", 1))
    if w.get("conversation"):
        conv(f"{m['name']}-conv", "conv", m["conv_max_depth"], w["conversation"].get("reps", 1))
    return cells


def _profile_served(profile):
    """The SERVED_NAME a vllm profile defines itself (first definition; ${SERVED_NAME:-x} -> x), else None."""
    try:
        with open(os.path.join(VLLM_PROFILES, profile + ".env"), encoding="utf-8") as fh:
            for line in fh:
                mm = re.match(r"\s*SERVED_NAME=(?:\$\{SERVED_NAME:-([^}]*)\}|(\S+))", line)
                if mm:
                    return (mm.group(1) or mm.group(2)).strip("'\"")
    except OSError:
        pass
    return None


def _check_extra(eng, xa, where):
    if not isinstance(xa, str):
        sys.exit(f"{where}: extra_args must be a string of flags, got {xa!r}")
    for tok in xa.split():
        if not EXTRA_TOKEN_RE.fullmatch(tok):
            sys.exit(f"{where}: extra_args token {tok!r} must match ^[\\w.:/@,+=-]+$ (the launchers split on "
                     "whitespace and honour no quotes)")
        if tok.split("=")[0] in OWN_FLAGS[eng]:
            sys.exit(f"{where}: extra_args may not set {tok.split('=')[0]} (it has its own field on {eng})")


def _check_path(p, where, key, suffix=None):
    if not isinstance(p, str) or not PATH_RE.fullmatch(p):
        sys.exit(f"{where}: {key} must be an absolute path of [\\w./@:+-] characters, got {p!r}")
    if suffix and not p.endswith(suffix):
        sys.exit(f"{where}: {key} must end in {suffix}: {p!r}")


def _validate_sampling(spec):
    smp = spec.get("sampling")
    if not isinstance(smp, dict) or "temperature" not in smp:
        sys.exit("multi-engine spec: `sampling` is required and must set temperature explicitly (every engine "
                 "otherwise fills in its own defaults: a hidden asymmetry, plan §2.1)")
    import capture_engine   # one owner of the allowed sampler keys (same dir)
    for k, v in smp.items():
        if k in REP_KEYS:
            sys.exit(f"sampling: {k} is engine-specific -- set workload.repetition_penalty and each server's "
                     "rep_penalty_key instead")
        if k not in capture_engine.SAMPLER_KEYS:
            sys.exit(f"sampling: {k!r} is not a capture_engine sampler key {sorted(capture_engine.SAMPLER_KEYS)}")
        if not _isnum(v) or (k in capture_engine.SAMPLER_INT and not _isint(v)):
            sys.exit(f"sampling: {k} must be a{'n integer' if k in capture_engine.SAMPLER_INT else ' number'}, "
                     f"got {v!r}")


def _validate_workload(spec):
    w = multi_workload(spec)
    for k in ("tier", "pass"):
        if not isinstance(w[k], str) or not TAG_VAL_RE.fullmatch(w[k]):
            sys.exit(f"workload.{k} must match ^[A-Za-z0-9._-]+$ (a --tag value), got {w[k]!r}")
    if w["api"] not in ("chat", "completions"):
        sys.exit(f"workload.api must be chat|completions, got {w['api']!r}")
    if w["prefix_mode"] not in ("none", "unique", "shared"):
        sys.exit(f"workload.prefix_mode must be none|unique|shared, got {w['prefix_mode']!r}")
    if not _isint(w["max_tokens"], 1) or not _isint(w["min_gen"], 0) or w["min_gen"] > w["max_tokens"]:
        sys.exit("workload: max_tokens must be an int >= 1 and min_gen an int in 0..max_tokens")
    if not _isint(w["first_warmup"], 0):
        sys.exit("workload.first_warmup must be an int >= 0")
    if w["repetition_penalty"] is not None and not _isnum(w["repetition_penalty"]):
        sys.exit("workload.repetition_penalty must be a number or null")
    fx = w["fixture"]
    if not (isinstance(fx, str) and "{depth}" in fx and re.fullmatch(r"[\w.{}-]+", fx)
            and TAG_VAL_RE.fullmatch(_workload_name(fx))):
        sys.exit(f"workload.fixture must be a bench/workloads/tmp file name containing {{depth}}, got {fx!r}")
    lad = w.get("ladder")
    if not isinstance(lad, dict) or "depths" not in lad:
        sys.exit("workload.ladder.depths is required (the cold depth ladder)")
    _check_depths(lad["depths"], "workload.ladder.depths")
    for k in ("reps", "spec_reps"):
        if k in lad and not _isint(lad[k], 1):
            sys.exit(f"workload.ladder.{k} must be an int >= 1")
    if not isinstance(lad.get("spec_depths", []), list) or not all(_isint(d, 1) for d in lad.get("spec_depths", [])):
        sys.exit("workload.ladder.spec_depths must be a list of depths")
    cc = w.get("concurrency")
    if cc is not None:
        if not isinstance(cc, dict) or not _isint(cc.get("n"), 2) or not isinstance(cc.get("depths"), list) \
                or not cc["depths"] or not all(_isint(d, 1) for d in cc["depths"]) \
                or not _isint(cc.get("reps", 3), 1):
            sys.exit("workload.concurrency needs n (int >= 2), depths (non-empty list of ints), optional reps")
    cv = w.get("conversation")
    if cv is not None:
        if not isinstance(cv, dict) or not isinstance(cv.get("prompt"), str) \
                or not re.fullmatch(r"[\w.-]+", cv["prompt"]):
            sys.exit("workload.conversation.prompt (a bench/workloads/tmp file name) is required")
        for k in ("start_tokens", "step_tokens", "max_depth", "max_tokens", "reps", "min_gen"):
            if k in cv and not _isint(cv[k], 0 if k in ("step_tokens", "min_gen") else 1):
                sys.exit(f"workload.conversation.{k} must be a positive int")
        if conv_min_gen(w) > cv.get("max_tokens", 512):
            sys.exit("workload.conversation.min_gen must be <= the conversation's max_tokens")
        if cv.get("turn_prompt") and (not re.fullmatch(r"[\w.-]+", cv["turn_prompt"])
                                      or not os.path.isfile(os.path.join(TASKS_DIR, cv["turn_prompt"]))):
            sys.exit(f"workload.conversation.turn_prompt {cv['turn_prompt']!r}: not a file in bench/workloads/tasks/")
        if "chat_template_kwargs" in cv and cv["chat_template_kwargs"] is not None \
                and not isinstance(cv["chat_template_kwargs"], dict):
            sys.exit("workload.conversation.chat_template_kwargs must be an object or null")
    for blk in ("sentinel", "smoke"):
        b = w.get(blk)
        if b is not None and (not isinstance(b, dict) or not _isint(b.get("depth"), 1)
                              or not _isint(b.get("reps", 1), 1)):
            sys.exit(f"workload.{blk} needs depth (int), optional reps")
    if w.get("sentinel") and not _isnum(w["sentinel"].get("tol_pct", 5)):
        sys.exit("workload.sentinel.tol_pct must be a number")


def _check_depths(ds, where):
    if not isinstance(ds, list) or not all(_isint(d, 1) for d in ds) or ds != sorted(set(ds)):
        sys.exit(f"{where} must be a strictly ascending list of int depths, got {ds!r}")
    if len(ds) < 4:
        sys.exit(f"{where}: >= 4 depths are required (iron rule 16: fit the log-log exponent), got {len(ds)}")


def _validate_pins(spec):
    pins = spec.get("pins") or {}
    if not isinstance(pins, dict) or set(pins) - {"files", "images", "binaries", "single", "fixtures_sha256"}:
        sys.exit("pins must be an object with files / images / binaries / single / fixtures_sha256")
    for p, h in (pins.get("files") or {}).items():
        _check_path(p, "pins.files", "path")
        if not isinstance(h, str) or not SHA256_RE.fullmatch(h):
            sys.exit(f"pins.files[{p}]: sha256 must be 64 lowercase hex chars, got {h!r}")
    for ref, dg in (pins.get("images") or {}).items():
        validate_image(ref, "pins.images")
        if not isinstance(dg, str) or not DIGEST_RE.fullmatch(dg):
            sys.exit(f"pins.images[{ref}]: digest must be [sha256:]<12-64 hex> (image id or repo digest), got {dg!r}")
    for p in pins.get("binaries") or []:
        _check_path(p, "pins.binaries", "path")
    for g in pins.get("single") or []:
        if not isinstance(g, str) or not GLOB_RE.fullmatch(g):
            sys.exit(f"pins.single: {g!r} must be an absolute glob of [\\w./@:+*?-] characters")
    fs = pins.get("fixtures_sha256")
    if fs is not None and (not isinstance(fs, str) or os.path.isabs(fs) or ".." in fs.split("/")
                           or not re.fullmatch(r"[\w./-]+", fs)):
        sys.exit(f"pins.fixtures_sha256 must be a campaign-relative path (e.g. inputs/fixtures.sha256: "
                 f"{FIXTURES_SHA_FORMAT}), got {fs!r}")


def validate_multi(spec):
    """Emit-time validation of a multi-engine throughput spec (sys.exit with a clear message)."""
    if "slug" not in spec:
        sys.exit("spec missing required key: slug")
    srvs = spec["servers"]
    if not all(isinstance(s, dict) and "engine" in s for s in srvs):
        sys.exit("multi-engine spec: every server needs an `engine` (llamacpp | vllm | radiance), or none does")
    for k in spec:
        if k in SINGLE_ONLY_TOP:
            sys.exit(f"multi-engine spec: top-level {k!r} is single-engine only -- set it per server")
        if k not in MULTI_TOP_KEYS:
            sys.exit(f"multi-engine spec: unknown top-level key {k!r} (allowed: {', '.join(MULTI_TOP_KEYS)})")
    tune = spec.get("tuning") or {}
    if set(tune) - {"ub", "b", "fa"} or not all(_isint(tune[k], 1) for k in ("ub", "b") if k in tune) \
            or tune.get("fa", "on") not in ("on", "off", "auto"):
        sys.exit("tuning takes ub, b (ints) and fa (on|off|auto) -- llama.cpp servers only")
    _validate_sampling(spec)
    _validate_workload(spec)
    _validate_pins(spec)
    w = multi_workload(spec)
    names, arm_pass = set(), set()
    for i, s in enumerate(srvs):
        where = f"server #{i + 1} ({s.get('name', '?')!r})"
        eng = s["engine"]
        if eng not in MULTI_ENGINES:
            sys.exit(f"{where}: unknown engine {eng!r} (one of {' | '.join(MULTI_ENGINES)})")
        if "probes" in s or "mtp" in s and eng != "llamacpp":
            sys.exit(f"{where}: {'probes' if 'probes' in s else 'mtp'} is not a multi-engine {eng} field "
                     "(cells come from `workload`; spec decoding: llamacpp mtp, radiance spec_tokens, vllm profile)")
        req, opt = MULTI_ENGINE_KEYS[eng]
        for k in s:
            if k in MULTI_COMMON_KEYS or k in req or k in opt:
                continue
            owner = [e for e, (r, o) in MULTI_ENGINE_KEYS.items() if k in r or k in o]
            sys.exit(f"{where}: {k!r} is " + (f"a {'/'.join(owner)}-only field" if owner else "not a server field"))
        for k in ("name", "served_model", "ctx", "np", "kv", "working_set_mib") + req:
            if k not in s:
                sys.exit(f"{where}: {eng} server missing required field {k!r}")
        if not isinstance(s["name"], str) or not ARM_RE.fullmatch(s["name"]) or "smoke" in s["name"]:
            sys.exit(f"{where}: name must match ^[a-z0-9][a-z0-9._-]*$ and not contain 'smoke'")
        if s["name"] in names:
            sys.exit(f"{where}: duplicate server name {s['name']!r} (it prefixes every cell slug)")
        clash = [n for n in names if s["name"].startswith(n + "-") or n.startswith(s["name"] + "-")]
        if clash:
            sys.exit(f"{where}: server name {s['name']!r} and {clash[0]!r} share a '<name>-' prefix, so "
                     f"ONLY='{min(clash[0], s['name'], key=len)}-*' would select both servers' cells -- rename one")
        names.add(s["name"])
        m = multi_server(spec, s)
        for k in ("arm", "pass", "tier"):
            if not isinstance(m[k], str) or not TAG_VAL_RE.fullmatch(m[k]) or (k == "arm" and not ARM_RE.fullmatch(m[k])):
                sys.exit(f"{where}: {k} must be a tag-safe id ([a-z0-9._-]), got {m[k]!r}")
        if (m["arm"], m["pass"]) in arm_pass:
            sys.exit(f"{where}: arm {m['arm']!r} already has a server in pass {m['pass']!r}")
        arm_pass.add((m["arm"], m["pass"]))
        if not isinstance(s["served_model"], str) or not SERVED_RE.fullmatch(s["served_model"]):
            sys.exit(f"{where}: served_model must match ^[A-Za-z0-9._:/-]+$")
        if not _isint(s["ctx"], 1) or not _isint(s["np"], 1):
            sys.exit(f"{where}: ctx and np must be positive ints")
        if not isinstance(s["kv"], str) or not re.fullmatch(r"[\w.]+", s["kv"]):
            sys.exit(f"{where}: kv must be a KV type (f16, q8_0, fp8, auto, ...)")
        if not _isint(m["port"], 1024) or m["port"] > 65535 or m["port"] == LLAMASWAP_PORT:
            sys.exit(f"{where}: port must be 1024..65535 and not {LLAMASWAP_PORT} (the llama-swap router "
                     "gpu_exclusive.sh unloads), got {m['port']!r}")
        if not _isint(m["ws"], 1) or not _isint(m["floor"], 1):
            sys.exit(f"{where}: working_set_mib and free_mib_floor must be positive ints (MiB)")
        if m["ws"] > m["floor"]:
            sys.exit(f"{where}: working_set_mib {m['ws']} > free_mib_floor {m['floor']}: the boot gate would admit a "
                     "boot whose expected working set cannot fit (raise the floor or fix the working set)")
        if m["floor"] > PHYS_VRAM_MIB:
            sys.exit(f"{where}: free_mib_floor {m['floor']} > physical VRAM {PHYS_VRAM_MIB} MiB: the gate never passes")
        if m["rep_key"] not in REP_KEYS + (None,):
            sys.exit(f"{where}: rep_penalty_key must be repeat_penalty | repetition_penalty | null, got {m['rep_key']!r}")
        if eng != "radiance" and m["rep_key"] != DEFAULT_REP_KEY[eng]:
            sys.exit(f"{where}: rep_penalty_key on {eng} must be {DEFAULT_REP_KEY[eng]!r} (the only key {eng} reads; "
                     f"any other name drops the penalty to the engine default), got {m['rep_key']!r}")
        if "env" in s:
            validate_env(s["env"], where, reserved=MULTI_RESERVED_ENV)
        if "extra_args" in s:
            _check_extra(eng, s["extra_args"], where)
        if "spec" in s and not isinstance(s["spec"], bool):
            sys.exit(f"{where}: spec must be true|false")
        if eng == "llamacpp":
            _check_path(s["gguf"], where, "gguf", ".gguf")
            _check_path(s["bin"], where, "bin")
            if "/latest-" in s["bin"]:
                sys.exit(f"{where}: bin {s['bin']!r} goes through a latest-* symlink, which moves on promote -- pin "
                         "the resolved build dir (rule 2)")
            if s.get("backend", "vulkan") not in BACKEND_PORT:
                sys.exit(f"{where}: backend must be vulkan|rocm")
            if s.get("mtp", 0) not in (0, 1):
                sys.exit(f"{where}: mtp must be 0|1")
            derived = s.get("mtp", 0) == 1
        elif eng == "radiance":
            _check_path(s["rad_file"], where, "rad_file", ".rad")
            validate_image(s["image"], where)
            if not _isint(s["spec_tokens"], 0):
                sys.exit(f"{where}: spec_tokens must be an int >= 0 (0 = spec decoding off)")
            derived = s["spec_tokens"] > 0
        else:
            prof = os.path.join(VLLM_PROFILES, str(s["profile"]) + ".env")
            if not os.path.exists(prof):
                sys.exit(f"{where}: vllm profile not found: {prof}")
            validate_image(s["image"], where)
            if not isinstance(s["spec"], bool):
                sys.exit(f"{where}: vllm spec must be true|false (speculative decoding lives in the profile)")
            ps = _profile_served(s["profile"])
            if ps and ps != s["served_model"]:
                sys.exit(f"{where}: served_model {s['served_model']!r} != the profile's SERVED_NAME {ps!r}")
            if "model" in s:
                _check_path(s["model"], where, "model")
            derived = s["spec"]
        if "spec" in s and s["spec"] != derived:
            sys.exit(f"{where}: spec={s['spec']} contradicts the server's own spec setting ({eng})")
        if "depths" in s:
            _check_depths(s["depths"], f"{where}: depths")
        se = w.get("sentinel")
        if se and se["depth"] not in m["depths"]:
            sys.exit(f"{where}: sentinel depth {se['depth']} is not in its ladder {m['depths']} (it repeats a ladder cell)")
        if w.get("conversation") and not _isint(m["conv_max_depth"], 1):
            sys.exit(f"{where}: workload.conversation.max_depth (or the server's conv_max_depth) is required")
        _check_ctx(s, m, w, where)
    print(f"note: multi-engine run.sh needs `bench/perf/engine-bench/run.sh --capabilities` to list "
          f"{', '.join(EB_CONTRACT)} (its preflight refuses otherwise).", file=sys.stderr)
    unpinned = multi_unpinned(spec)
    if unpinned:
        print("⚠️  WARNING: not pinned (pins.files sha256 / pins.images digest / pins.binaries): "
              + ", ".join(unpinned) + " -- run.sh refuses every non-smoke cell until they are", file=sys.stderr)
    for s in srvs:
        if s["engine"] == "radiance" and s.get("rep_penalty_key") is None:
            print(f"⚠️  WARNING: radiance server {s['name']!r}: {RADIANCE_REP_WARN}; its rows carry "
                  "rep_key=UNVERIFIED", file=sys.stderr)
    pins = spec.get("pins") or {}
    ph = [k for k, v in list((pins.get("files") or {}).items()) + list((pins.get("images") or {}).items())
          if set(v.replace("sha256:", "")) == {"0"}]
    if ph:
        print("⚠️  WARNING: PLACEHOLDER pins (all zeros) for " + ", ".join(ph)
              + " -- replace them with the real sha256 / image digest (the preflight fails on them)", file=sys.stderr)


def multi_unpinned(spec):
    """Weights / builds / images the spec does not pin (gguf, rad_file and bin by sha256 or as a binary,
    image by digest). run.sh refuses non-smoke cells while this list is non-empty (m12)."""
    pins = spec.get("pins") or {}
    pinned = set(pins.get("files") or {}) | set(pins.get("images") or {}) | set(pins.get("binaries") or [])
    out = []
    for s in spec["servers"]:
        for k in ("gguf", "rad_file", "bin", "image"):
            v = s.get(k)
            if not v or v in pinned or v in out:
                continue
            out.append(v)
    return out


def _check_ctx(s, m, w, where):
    """Every cell must fit the server's window: depth + max_tokens <= ctx; llama.cpp -np N without
    --kv-unified splits -c into N slots (ctx/np each); an n=N cell on a unified pool needs N windows."""
    ctx, np_, llama = int(s["ctx"]), int(s["np"]), s["engine"] == "llamacpp"
    win = ctx // np_ if llama and np_ > 1 and not m["kv_unified"] else ctx
    hint = " (add --kv-unified to extra_args for one shared pool)" if win < ctx else ""
    for c in multi_cells_raw(s, m, w):
        need = (c["depth"] + c["max_tokens"]) if c["mode"] == "probe" else c["max_depth"]
        if need > win:
            sys.exit(f"{where}: cell {c['slug']} needs {need} tokens > the per-request window {win}{hint}")
        if llama and m["kv_unified"] and c["n"] > 1 and c["n"] * need > ctx:
            sys.exit(f"{where}: cell {c['slug']} needs {c['n']} x {need} tokens > the unified pool {ctx}")


def multi_cells_raw(s, m, w):
    """multi_cells without the spec wrapper (used by _check_ctx during validation)."""
    return multi_cells({"workload": w, "sampling": {}, "servers": [s], "port": m["port"]}, s)


# --------------------------------------------------------------------------- multi-engine run.sh
MULTI_RUNSH_HEAD = r'''#!/usr/bin/env bash
# GENERATED by bench/core/gen_campaign.py -- MULTI-ENGINE throughput campaign '@@SLUG@@' (servers[].engine =
# llamacpp | vllm | radiance; one engine at a time). Resumable: rerun to continue (per-cell markers in
# <campaign>/tmp/done/). Edit the spec and regenerate -- never hand-edit this file.
# Per server, in spec order:
#   power snapshot -> gpu_exclusive.sh <floor> -> boot gate (port free AND free VRAM >= floor, rule 14)
#   -> VRAM sampler across the boot -> serve_<engine>.sh print + start -> boot_diag.py record (boots.jsonl)
#   -> identity gate (/v1/models lists exactly the served name; the state-dir cmdline names the pinned
#      image/build + model; ENGINES_LIST set from the spec, never inherited) -> residency vs the expected
#      working set (amd-smi; VRAM-delta fallback for Vulkan llama-server, rule 15) -> cells, each under a
#      Memory-Fault watcher over the cell's own log window (a fault aborts the run and quarantines the
#      cell's rows, rule 15) -> stop by pidfile/container + port-free + VRAM-idle verify -> power snapshot.
#   Cell order per boot: smoke (opt-in) -> ladder ascending (n=N right after its depth) -> drift sentinel
#   -> conversation. The drift check runs after the server block, so a resumed run still performs it.
#   Preflight (once, before any GPU work): tools, `engine-bench/run.sh --capabilities` (@@EBC@@),
#   pins (files sha256, images digest, binaries, single-revision globs; an unpinned weight/build/image
#   is refused unless only smoke cells are selected), fixtures, the ports free.
# Knobs: ONLY='glob,..' (cell slugs; *-smoke-* cells run only when a glob naming "smoke" selects them; a glob
#   matching no cell is refused) REPS= MAX_TOKENS= MIN_GEN= RETRY_INCOMPLETE=1 (rerun cells stopped as INCOMPLETE)
#   RUN_TAG=<tag> (short run isolated in tmp/runs/<tag>/, rule 19) FLOOR_WAIT=<s> STOP_WAIT=<s> IDLE_WAIT=<s>
#   VRAM_IDLE_SLACK_MIB=<MiB> WATCH_S=<s> (all integers; anything else is refused)
#   Tool paths (stub testing): EB SERVE_LLAMA SERVE_VLLM SERVE_RAD GPU_EXCLUSIVE BOOT_DIAG BOOT_VRAM_SAMPLER
#   SERVER_STATE_DIR DRM_ROOT DOCKER AMD_SMI CURL SS
# Two roots: raw (per-probe run dirs, boot logs/CSVs, done/ markers) -> <campaign>/tmp/; results
#   (results.jsonl, boots.jsonl, residency.jsonl, drift.jsonl, quarantine.jsonl, meta/failures,
#   server-/models-/residency-/power-<slug>.txt) -> <campaign>/results/.
@@NOTES@@set -uo pipefail
@@ROOTS@@
RUN_LOCK="$CAMPAIGN_DIR/tmp/run.lock"   # one run of this campaign at a time (a pid file, not flock: a server
_lock_pid=$(cat "$RUN_LOCK" 2>/dev/null || true)   # launched from here would inherit a lock fd)
if [ -n "$_lock_pid" ] && [ "$_lock_pid" != "$$" ] && kill -0 "$_lock_pid" 2>/dev/null; then
  echo "RUN REFUSED: pid $_lock_pid already runs this campaign ($RUN_LOCK)" >&2; exit 1
fi
echo "$$" > "$RUN_LOCK"
RUN_TAG="${RUN_TAG:-}"
if [ -n "$RUN_TAG" ]; then   # short run: every output in a unique dir under the git-ignored tmp/ (rule 19)
  RUN_DIR="$CAMPAIGN_DIR/tmp/runs/$RUN_TAG"; RAW="$RUN_DIR/tmp"; RES="$RUN_DIR/results"; PROBE_CAMPAIGN="$RUN_DIR"
else
  RUN_DIR=""; PROBE_CAMPAIGN="$CAMPAIGN_DIR"
fi
mkdir -p "$RAW/done" "$RES"
EB="${EB:-$ROOT/bench/perf/engine-bench}"
GEN="$ROOT/bench/workloads/tmp"
SERVE_LLAMA="${SERVE_LLAMA:-$ROOT/stack/serve/llamacpp/serve_llamacpp.sh}"
SERVE_VLLM="${SERVE_VLLM:-$ROOT/stack/serve/vllm/serve_vllm.sh}"
SERVE_RAD="${SERVE_RAD:-$ROOT/stack/serve/radiance/serve_radiance.sh}"
GPU_EXCLUSIVE="${GPU_EXCLUSIVE:-$ROOT/stack/gpu/gpu_exclusive.sh}"
BOOT_DIAG="${BOOT_DIAG:-$ROOT/bench/perf/boot_diag.py}"
BOOT_VRAM_SAMPLER="${BOOT_VRAM_SAMPLER:-python3 $ROOT/stack/gpu/vram_sampler.py}"
SERVER_STATE_DIR="${SERVER_STATE_DIR:-$ROOT/stack/serve/var/servers}"
DRM_ROOT="${DRM_ROOT:-/sys/class/drm}"
VLLM_CACHE_ROOT="${VLLM_CACHE_ROOT:-${VLLM_ROOT:-/mnt/Lin1/work/vllm/sly-radiance}/cache}"   # serve_vllm.sh CACHE_DIR
DOCKER="${DOCKER:-docker}"; AMD_SMI="${AMD_SMI:-amd-smi}"; CURL="${CURL:-curl}"; SS="${SS:-ss}"
# --- run-time knobs ---
ONLY="${ONLY:-}"                     # comma-separated cell-slug globs; empty = every non-smoke cell
REPS_OVERRIDE="${REPS:-}"            # override every cell's reps (quick pass)
MAXTOK_OVERRIDE="${MAX_TOKENS:-}"    # override every cell's max_tokens (the min-gen gate then defaults to off)
MINGEN_OVERRIDE="${MIN_GEN:-}"       # override the min-gen gate (0 = off)
RETRY_INCOMPLETE="${RETRY_INCOMPLETE:-0}"   # 1 = rerun cells an earlier run stopped as INCOMPLETE (short replies)
FLOOR_WAIT="${FLOOR_WAIT-90}"        # boot gate: seconds to wait for port free + VRAM floor
STOP_WAIT="${STOP_WAIT-30}"          # stop verify: seconds for the container to go + the port to free
IDLE_WAIT="${IDLE_WAIT-60}"          # stop verify: seconds for VRAM to fall back to the pre-boot level
VRAM_IDLE_SLACK_MIB="${VRAM_IDLE_SLACK_MIB-1024}"   # stop verify: used <= pre-boot used + slack = idle
WATCH_S="${WATCH_S-5}"               # Memory-Fault watcher poll (s)
for _k in FLOOR_WAIT STOP_WAIT IDLE_WAIT VRAM_IDLE_SLACK_MIB WATCH_S; do   # an empty/non-numeric knob is refused
  case "${!_k}" in ''|*[!0-9]*) echo "RUN REFUSED: $_k='${!_k}' must be a non-negative integer" >&2; exit 1;; esac; done
for _k in REPS_OVERRIDE MAXTOK_OVERRIDE MINGEN_OVERRIDE; do
  case "${!_k}" in *[!0-9]*) echo "RUN REFUSED: ${_k%_OVERRIDE}='${!_k}' must be an integer" >&2; exit 1;; esac; done
[ "$WATCH_S" -ge 1 ] || { echo "RUN REFUSED: WATCH_S must be >= 1" >&2; exit 1; }
FIRST_WARMUP=@@WARMUP@@ API=@@API@@ PREFIX_MODE=@@PREFIX@@
ALL_CELLS=(@@ALL_CELLS@@)
UNPINNED=(@@UNPINNED@@)
if [ ! -f "$RES/meta.txt" ]; then
  { echo "date=$(date -Iseconds)"; echo "campaign=@@SLUG@@ (multi-engine throughput, gen_campaign G1)"
    echo "order=@@ORDER@@"
    echo "kernel=$(uname -r)"
    echo "mesa=$(dpkg-query -W -f='${Version}' mesa-vulkan-drivers 2>/dev/null || echo unknown)"
    echo "rocm=$(cat /opt/rocm/.info/version 2>/dev/null || echo unknown)"
    echo "api=$API prefix_mode=$PREFIX_MODE first_warmup=$FIRST_WARMUP min_gen=@@MINGEN@@ conv_min_gen=@@CONV_MINGEN@@"
@@META@@  } > "$RES/meta.txt"
fi
echo "invocation=$(date -Iseconds) run_tag=${RUN_TAG:-none} only=${ONLY:-all} reps_override=${REPS_OVERRIDE:-none} max_tokens_override=${MAXTOK_OVERRIDE:-none} min_gen_override=${MINGEN_OVERRIDE:-none} retry_incomplete=$RETRY_INCOMPLETE" >> "$RES/meta.txt"

want_cell () {  # slug -> 0 if selected by ONLY; *-smoke-* cells are opt-in: only a glob that says "smoke" selects
  # them (ONLY='q4kxl-*' = q4kxl's measured cells; ONLY='*-smoke-*' or 'q4kxl-smoke-*' = smoke)
  local g smoke=0; case "$1" in *-smoke-*) smoke=1;; esac
  if [ -z "$ONLY" ]; then [ "$smoke" = 0 ]; return; fi
  IFS="," read -ra _globs <<<"$ONLY"
  for g in "${_globs[@]}"; do
    case "$1" in $g) if [ "$smoke" = 0 ]; then return 0; fi; case "$g" in *smoke*) return 0;; esac;; esac
  done; return 1; }
cell_open () {  # slug -> 0 when selected, not done, and not stopped INCOMPLETE (unless RETRY_INCOMPLETE=1)
  want_cell "$1" && [ ! -f "$RAW/done/$1" ] && { [ ! -f "$RAW/done/$1.incomplete" ] || [ "$RETRY_INCOMPLETE" = 1 ]; }; }
cells_pending () {  # slug... -> 0 if >=1 selected cell is still open (a server boots only then)
  local s; for s in "$@"; do cell_open "$s" && return 0; done; return 1; }
check_only () {  # every ONLY glob must select >= 1 cell (a typo would otherwise silently run nothing)
  local g c hit; [ -n "$ONLY" ] || return 0
  IFS="," read -ra _globs <<<"$ONLY"
  for g in "${_globs[@]}"; do hit=0
    for c in "${ALL_CELLS[@]}"; do case "$c" in $g) hit=1; break;; esac; done
    [ "$hit" = 1 ] || { echo "RUN REFUSED: ONLY glob '$g' matches no cell (cells: ${ALL_CELLS[*]})" >&2; exit 1; }
  done; }
check_only

@@ENSURE@@

# --- sysfs + gate helpers (ported from the KLD campaign's run.sh: boot_gate / gate_clear / boot_gate_refuse) ---
vram_used_mib () { local d; for d in "$DRM_ROOT"/card*/device; do
  [ -r "$d/mem_info_vram_used" ] && { echo $(( $(cat "$d/mem_info_vram_used") / 1048576 )); return; }; done; }
gtt_used_mib () { local d; for d in "$DRM_ROOT"/card*/device; do
  [ -r "$d/mem_info_gtt_used" ] && { echo $(( $(cat "$d/mem_info_gtt_used") / 1048576 )); return; }; done; }
gate_port_held () {  # port -> 0 when held OR unknown (ss failed / printed nothing: it always prints a header)
  local l; l=$("$SS" -ltn 2>/dev/null) || return 0; [ -n "$l" ] || return 0
  case "$l" in *":$1 "*) return 0;; esac; return 1; }
gate_free_mib () { local d; for d in "$DRM_ROOT"/card*/device; do
  [ -r "$d/mem_info_vram_total" ] || continue
  echo $(( ($(cat "$d/mem_info_vram_total") - $(cat "$d/mem_info_vram_used")) / 1048576 )); return; done
  echo unreadable; }
gate_clear () { local free; free=$(gate_free_mib)   # port floor -> 0 when the port is free AND free VRAM >= floor
  ! gate_port_held "$1" && [ "$free" != unreadable ] && [ "$free" -ge "$2" ]; }
boot_gate_refuse () {  # slug port floor waited [note] -> ONE "BOOT REFUSED" line; no boot attempted, no boots.jsonl row
  local slug=$1 port=$2 floor=$3 waited=$4 note=${5:-} free port_line line holder
  free=$(gate_free_mib)
  if ! "$SS" -ltn >/dev/null 2>&1; then port_line="port=$port state unknown (ss failed: fail-closed)"
  elif gate_port_held "$port"; then
    holder=$("$SS" -ltnp 2>/dev/null | grep ":$port " | sed -nE 's/.*users:\(\("([^"]*)",pid=([0-9]+).*/\1 pid=\2/p' | sort -u | head -3 | tr '\n' ' ') || true
    port_line="port=$port held by ${holder:-unknown}"
  else port_line="port=$port free"; fi
  line="BOOT REFUSED $slug:"; [ -n "$note" ] && line="$line $note;"
  echo "$line $port_line; free_mib=$free; floor_mib=$floor; waited_s=$waited" | tee -a "$RES/failures.txt"
  { echo "free_mib=$free"; echo "floor_mib=$floor"; echo "$port_line"; echo "waited_s=$waited"; } > "$RAW/boot-$slug.txt"; }
boot_gate () {  # slug port floor -> 0 once the port is free AND free VRAM >= floor at the same check (FLOOR_WAIT s)
  local slug=$1 port=$2 floor=$3 t0 waited
  case "$FLOOR_WAIT" in ''|*[!0-9]*) boot_gate_refuse "$slug" "$port" "$floor" 0 "FLOOR_WAIT=$FLOOR_WAIT invalid"; return 1;; esac
  t0=$(date +%s)
  gate_clear "$port" "$floor" && return 0
  for _ in $(seq "$FLOOR_WAIT"); do sleep 1; gate_clear "$port" "$floor" && return 0; done
  waited=$(( $(date +%s) - t0 )); boot_gate_refuse "$slug" "$port" "$floor" "$waited"; return 1; }
power_snapshot () {  # slug before|after -> the card's power state + VRAM/GTT into $RES/power-<slug>.txt (plan §2.5)
  local d f
  { echo "## $2 $(date -Iseconds)"
    for d in "$DRM_ROOT"/card*/device; do
      [ -r "$d/mem_info_vram_used" ] || continue
      echo "card=$d"
      for f in power_dpm_force_performance_level pp_power_profile_mode pp_od_clk_voltage pp_dpm_mclk pp_dpm_sclk; do
        [ -r "$d/$f" ] && { echo "### $f"; cat "$d/$f" 2>/dev/null; }; done
      for f in "$d"/hwmon/hwmon*/power1_cap "$d"/hwmon/hwmon*/power1_cap_max; do
        [ -r "$f" ] && echo "${f##*/}=$(cat "$f" 2>/dev/null)"; done
      echo "vram_used_mib=$(vram_used_mib) gtt_used_mib=$(gtt_used_mib)"
      break
    done; } >> "$RES/power-$1.txt" 2>/dev/null || true; }

# --- boot provenance (ported from the KLD run.sh: record_boot / fresh_slug / fresh_file / image_id_of) ---
image_id_of () { "$DOCKER" image inspect --format '{{.Id}}' "$1" 2>/dev/null || true; }
vllm_cache_dir () { local tag=${1##*/}; echo "$VLLM_CACHE_ROOT/${tag/:/@}"; }
state_log_sig () { stat -c '%i:%s:%.9Y' "$SERVER_STATE_DIR/$1.log" 2>/dev/null || echo absent; }
fresh_slug () {  # name -> name, or name-boot2, -boot3 ... when an earlier boot left records (never overwrite)
  local s=$1 c=$1 n=1
  while [ -e "$RES/server-$c.txt" ] || [ -e "$RAW/boot-$c.txt" ] || [ -e "$RAW/boot-$c-vram.csv" ]; do
    n=$((n+1)); c="$s-boot$n"; done
  echo "$c"; }
fresh_file () { local p=$1 n=1 c=$1; while [ -e "$c" ]; do n=$((n+1)); c="${p%.*}-$n.${p##*.}"; done; echo "$c"; }
record_boot () {  # kind slug arm image served server_txt t0 t1 rc vram_before vram_csv rad cache_json engine_log boot_tail
  local kind=$1 slug=$2 arm=$3 image=$4 served=$5 server_txt=$6 t0=$7 t1=$8 rc=$9
  local vbefore=${10:-} vcsv=${11:-} rad=${12:-} cjson=${13:-} elog=${14:-} btail=${15:-} iid vready
  iid=$(image_id_of "$image"); vready=$(vram_used_mib)
  # shellcheck disable=SC2086  # ${...:+...} are intentional word splits (empty => arg omitted)
  python3 "$BOOT_DIAG" record --out "$RES/boots.jsonl" --name "$slug" --arm "$arm" --kind "$kind" \
    --served "$served" --image "$image" --image-id "${iid:-}" --server-txt "$server_txt" \
    --t0 "$t0" --t1 "$t1" --rc "$rc" --vram-before "${vbefore:-}" --vram-ready "${vready:-}" \
    ${vcsv:+--vram-csv "$vcsv"} ${rad:+--rad "$rad"} ${cjson:+--cache-json "$cjson"} \
    ${elog:+--log "$elog"} ${btail:+--boot-tail "$btail"} || echo "WARN: boots.jsonl record failed for $slug" >&2; }

# --- the current server (one at a time); stop_current is the EXIT/INT/TERM trap ---
CUR_ENGINE=""; CUR_PORT=""; CUR_SLUG=""; CUR_CONTAINER=""; CUR_VBEFORE=""; WARM_DONE=0
serve_of () { case "$1" in llamacpp) echo "$SERVE_LLAMA";; vllm) echo "$SERVE_VLLM";; radiance) echo "$SERVE_RAD";; esac; }
container_of () { case "$1" in vllm) echo "vllm-$2";; radiance) echo "radiance-$2";; *) echo "";; esac; }
stop_current () {  # stop by pidfile (llama.cpp) / container (vllm, radiance), then verify port free + VRAM idle
  [ -n "$CUR_ENGINE" ] || return 0
  local engine=$CUR_ENGINE port=$CUR_PORT slug=$CUR_SLUG container=$CUR_CONTAINER vb=$CUR_VBEFORE
  local serve i gone=n/a portfree=no idle=unknown now="" ps
  CUR_ENGINE=""; CUR_CONTAINER=""   # idempotent: the EXIT trap may call it again
  serve=$(serve_of "$engine")
  PORT=$port "$serve" stop > "$RAW/stop-$slug.txt" 2>&1 \
    || echo "WARN: $engine stop of $slug returned nonzero (see $RAW/stop-$slug.txt)" | tee -a "$RES/failures.txt"
  if [ -n "$container" ]; then gone=no
    for i in $(seq 0 "$STOP_WAIT"); do   # a failing docker is "unknown", never "gone"
      ps=$("$DOCKER" ps -q --filter "name=^${container}\$" 2>/dev/null) || { gone=unknown; break; }
      [ -n "$ps" ] || { gone=yes; break; }; [ "$i" -lt "$STOP_WAIT" ] && sleep 1; done; fi
  for i in $(seq 0 "$STOP_WAIT"); do gate_port_held "$port" || { portfree=yes; break; }; [ "$i" -lt "$STOP_WAIT" ] && sleep 1; done
  if [ -n "$vb" ]; then idle=no
    for i in $(seq 0 "$IDLE_WAIT"); do now=$(vram_used_mib)
      [ -n "$now" ] || { idle=unknown; break; }
      [ "$now" -le $((vb + VRAM_IDLE_SLACK_MIB)) ] && { idle=yes; break; }; [ "$i" -lt "$IDLE_WAIT" ] && sleep 1; done; fi
  { echo "container_gone=$gone port_free=$portfree vram_idle=$idle vram_used_mib=${now:-?} vram_before_mib=${vb:-?} slack_mib=$VRAM_IDLE_SLACK_MIB"; } >> "$RAW/stop-$slug.txt"
  case "$gone" in no) echo "WARN: container $container still present after stopping $slug" | tee -a "$RES/failures.txt";;
    unknown) echo "WARN: container $container state unknown after stopping $slug (docker ps failed)" | tee -a "$RES/failures.txt";; esac
  [ "$portfree" = yes ] || echo "WARN: port $port still held (or ss failed) after stopping $slug" | tee -a "$RES/failures.txt"
  case "$idle" in no) echo "WARN: VRAM not idle after stopping $slug (${now} MiB > pre-boot ${vb} + ${VRAM_IDLE_SLACK_MIB}); the next boot gate refuses below its floor" | tee -a "$RES/failures.txt";;
    unknown) echo "WARN: VRAM idle unknown after stopping $slug (no pre-boot or current VRAM reading)" | tee -a "$RES/failures.txt";; esac
  power_snapshot "$slug" after
  return 0; }
trap stop_current EXIT
trap 'exit 130' INT TERM

boot_server () {  # engine name arm port floor image served model_ref KEY=VAL... -> 0 up (CUR_* set), 1 refused/failed
  # (ported from the KLD run.sh start_llama / start_server / start_rad: one function, engine-specific bits by case)
  local engine=$1 name=$2 arm=$3 port=$4 floor=$5 image=$6 served=$7 mref=$8; shift 8
  local srv_env=("$@") serve slug container gx
  serve=$(serve_of "$engine"); container=$(container_of "$engine" "$port")
  slug=$(fresh_slug "$name")
  echo ">>> starting $engine server $slug (arm=$arm port=$port floor=${floor}MiB served=$served image=$image model=$mref)"
  power_snapshot "$slug" before
  # rule 14: make the GPU exclusive (llama-swap unload, hipfire shape) and assert the floor BEFORE any GPU second
  if ! gx=$("$GPU_EXCLUSIVE" "$floor" 2>&1); then
    printf '%s\n' "$gx" > "$RAW/gpu-exclusive-$slug.txt"
    boot_gate_refuse "$slug" "$port" "$floor" 0 "gpu_exclusive.sh refused (see $RAW/gpu-exclusive-$slug.txt)"; return 1; fi
  printf '%s\n' "$gx" > "$RAW/gpu-exclusive-$slug.txt"
  boot_gate "$slug" "$port" "$floor" || return 1
  local t0 t1 rc sampler_pid csv eng slog start_err cjson="" waited sig_before sig_after elog state_sec vbefore rad=""
  csv="$RAW/boot-$slug-vram.csv"; eng="$RAW/boot-$slug-engine.log"; slog="$RAW/serve-logs-$slug.txt"
  start_err="$RAW/start-err-$slug.txt"; [ "$engine" = radiance ] && rad=$mref
  vbefore=$(vram_used_mib)
  echo "vram_before_mib=${vbefore:-} gtt_before_mib=$(gtt_used_mib)" >> "$RES/power-$slug.txt"
  t0=$(date +%s.%N)
  # shellcheck disable=SC2086  # $BOOT_VRAM_SAMPLER is intentionally word-split (python3 + path)
  $BOOT_VRAM_SAMPLER --out "$csv" & sampler_pid=$!
  sig_before=$(state_log_sig "$port")
  if [ "$engine" = llamacpp ]; then   # provenance: the resolved gguf + size and the build; start's stdout is appended
    echo "gguf=$(readlink -f "$mref") bytes=$(stat -L -c %s "$mref" 2>/dev/null) llama_server=$(readlink -f "$image")" > "$RES/server-$slug.txt"
    if env "${srv_env[@]}" "$serve" start >> "$RES/server-$slug.txt" 2>"$start_err"; then rc=0; else rc=$?; fi
  else
    env "${srv_env[@]}" "$serve" print > "$RES/server-$slug.txt" 2>&1
    if env "${srv_env[@]}" "$serve" start > "$RAW/start-out-$slug.txt" 2>"$start_err"; then rc=0; else rc=$?; fi
  fi
  t1=$(date +%s.%N)
  kill "$sampler_pid" 2>/dev/null; wait "$sampler_pid" 2>/dev/null
  if [ "$engine" = vllm ]; then cjson="$RAW/boot-$slug-cache.json"
    python3 "$BOOT_DIAG" cache --dir "$(vllm_cache_dir "$image")" > "$cjson" 2>/dev/null || echo '{}' > "$cjson"; fi
  CUR_ENGINE=$engine; CUR_PORT=$port; CUR_SLUG=$slug; CUR_CONTAINER=$container; CUR_VBEFORE=$vbefore; WARM_DONE=0
  if [ "$rc" -eq 0 ]; then
    if [ -n "$container" ]; then "$DOCKER" logs "$container" > "$eng" 2>&1 || true
    else cp "$SERVER_STATE_DIR/$port.log" "$eng" 2>/dev/null || true; fi
    record_boot "$engine" "$slug" "$arm" "$image" "$served" "$RES/server-$slug.txt" "$t0" "$t1" "$rc" "$vbefore" "$csv" "$rad" "$cjson" "$eng" ""
    return 0
  fi
  [ -n "$container" ] && { PORT=$port "$serve" logs > "$slog" 2>&1 || true; }
  waited=$(awk -v a="$t0" -v b="$t1" 'BEGIN{printf "%d", b-a}')
  sig_after=$(state_log_sig "$port"); elog=""; state_sec=""
  if [ "$sig_before" != "$sig_after" ]; then   # the state-dir log counts only when THIS boot wrote it
    elog="$SERVER_STATE_DIR/$port.log"; state_sec="state-dir engine log=$elog"; fi
  # shellcheck disable=SC2086  # ${...:+...} are intentional word splits (empty => section omitted)
  python3 "$BOOT_DIAG" tail --out "$RAW/boot-$slug.txt" --meta "start_rc=$rc" --meta "waited_s=$waited" \
    --section "start stderr=$start_err" ${state_sec:+--section "$state_sec"} \
    ${container:+--section "serve logs=$slog"} || echo "WARN: boot tail assembly failed for $slug" >&2
  [ -n "$elog" ] || echo "state-dir engine log: not written by this boot (signature unchanged across the start)" >> "$RAW/boot-$slug.txt"
  record_boot "$engine" "$slug" "$arm" "$image" "$served" "$RES/server-$slug.txt" "$t0" "$t1" "$rc" "$vbefore" "$csv" "$rad" "$cjson" "$elog" "$RAW/boot-$slug.txt"
  echo "SERVER-FAILED: $engine $slug (image=$image model=$mref) start_rc=$rc waited_s=$waited boot tail: $RAW/boot-$slug.txt" \
    | tee -a "$RES/failures.txt"
  stop_current; return 1; }

identity_gate () {  # port served needle... -> 0 when /v1/models lists exactly [served] AND the state-dir cmdline
  # names every needle (pinned image/build + model); else IDENTITY-FAILED and the server's cells are skipped
  local port=$1 served=$2 slug=$CUR_SLUG why="" n cmd="$SERVER_STATE_DIR/$1.cmdline"; shift 2
  "$CURL" -sf -m 10 "http://localhost:$port/v1/models" > "$RES/models-$slug.json" 2>/dev/null || why="GET /v1/models failed"
  [ -n "$why" ] || why=$(python3 - "$RES/models-$slug.json" "$served" <<'PY'
@@IDENTITY_PY@@PY
)
  if [ -z "$why" ]; then
    if [ ! -f "$cmd" ]; then why="no state-dir cmdline $cmd"
    else for n in "$@"; do grep -qF -- "$n" "$cmd" || { why="cmdline $cmd lacks '$n'"; break; }; done; fi
  fi
  [ -z "$why" ] && { echo "  identity OK: $slug serves $served"; return 0; }
  echo "IDENTITY-FAILED $slug: $why -- its cells are skipped" | tee -a "$RES/failures.txt"; return 1; }

RESIDENCY=unknown
residency_check () {  # arm working_set_mib -> RESIDENCY=ok|low|unknown: stamped on every cell row of this boot as a
  # `residency` tag and in results/residency.jsonl; low/unknown also WARN in failures.txt (rule 15)
  local arm=$1 ws=$2 slug=$CUR_SLUG out used src=amd-smi now
  out=$(fresh_file "$RES/residency-$slug.txt")
  { echo "# residency (rule 15): expected working set ${ws} MiB; less = paging/contention -> do not trust this boot's rows (WARN only)"
    "$AMD_SMI" process -g 0 2>&1; } > "$out"
  used=$("$AMD_SMI" process -g 0 2>/dev/null | awk '/VRAM_MEM:/ {v=$2; u=$3; m=0
      if (u=="B") m=v/1048576; else if (u=="KB") m=v/1024; else if (u=="MB") m=v; else if (u=="GB") m=v*1024
      t+=m} END {printf "%d", t+0}')
  if [ -z "$used" ] || [ "$used" -eq 0 ]; then   # Vulkan llama-server: amd-smi lists no process (MEASURED, KLD runs)
    now=$(vram_used_mib)
    if [ -n "$now" ] && [ -n "$CUR_VBEFORE" ]; then used=$((now - CUR_VBEFORE)); src=vram_delta; else used=""; src=unreadable; fi
  fi
  echo "residency_mib=${used:-unknown} source=$src expected_mib=$ws" >> "$out"
  if [ -z "$used" ]; then RESIDENCY=unknown; echo "  WARN (rule 15): $slug residency unreadable -- see $out" | tee -a "$RES/failures.txt"
  elif [ "$used" -lt "$ws" ]; then RESIDENCY=low
    echo "  WARN (rule 15): $slug residency ${used} MiB ($src) < expected working set ${ws} MiB -- its rows carry residency=low; see $out" | tee -a "$RES/failures.txt"
  else RESIDENCY=ok; echo "  residency OK: $slug ${used} MiB ($src) >= ${ws} MiB"; fi
  printf '{"kind":"residency","boot":"%s","arm":"%s","residency_mib":%s,"source":"%s","expected_mib":%s,"status":"%s"}\n' \
    "$slug" "$arm" "${used:-null}" "$src" "$ws" "$RESIDENCY" >> "$RES/residency.jsonl"; }

FAULT_RE='Memory Fault|ErrorDeviceLost|DeviceLostError'
fault_seen () {  # since CELL_T0 / CELL_OFF: the whole log window of THIS cell (no fixed tail: m11)
  local n   # grep -c reads to EOF: grep -q would exit at the match, SIGPIPE the writer and fail under pipefail
  if [ -n "$CUR_CONTAINER" ]; then n=$("$DOCKER" logs --since "$CELL_T0" "$CUR_CONTAINER" 2>&1 | grep -cE "$FAULT_RE")
  else n=$(tail -c "+$((CELL_OFF + 1))" "$SERVER_STATE_DIR/$CUR_PORT.log" 2>/dev/null | grep -cE "$FAULT_RE"); fi
  [ "${n:-0}" -gt 0 ]; }
quarantine_rows () {  # slug -> move the slug's rows out of results.jsonl into quarantine.jsonl (rule 18)
  [ -f "$RES/results.jsonl" ] || return 0
  python3 - "$RES/results.jsonl" "$RES/quarantine.jsonl" "$1" <<'PY'
import json, os, sys
src, dst, slug = sys.argv[1:4]
keep, moved = [], []
for line in open(src, encoding="utf-8"):
    try:
        lab = json.loads(line).get("label")
    except ValueError:
        lab = None
    (moved if lab == slug else keep).append(line)
if moved:
    with open(dst, "a", encoding="utf-8") as fh:
        fh.writelines(moved)
    with open(src + ".tmp", "w", encoding="utf-8") as fh:
        fh.writelines(keep)
    os.replace(src + ".tmp", src)
print(f"  quarantined {len(moved)} row(s) of {slug} -> {dst}")
PY
}
fault_abort () {  # slug when -> the GPU faulted during a cell: no marker, rows quarantined, server stopped, run aborted
  echo "MEMORY-FAULT on $CUR_ENGINE server $CUR_SLUG $2 cell $1 -- cell rows quarantined, server stopped, run aborted (rule 15)" \
    | tee -a "$RES/failures.txt"
  quarantine_rows "$1"; stop_current; exit 1; }
watched () {  # slug cmd... -> run it under the Memory-Fault watcher (ported from the KLD run_probe_watched, rule 15):
  # polled every WATCH_S while it runs AND once after it exits (a fault in the last poll window still counts)
  local slug=$1 pid rc; shift
  CELL_T0=$(date +%s); CELL_OFF=$(stat -c %s "$SERVER_STATE_DIR/$CUR_PORT.log" 2>/dev/null || echo 0)
  "$@" & pid=$!
  while kill -0 "$pid" 2>/dev/null; do
    sleep "$WATCH_S"
    kill -0 "$pid" 2>/dev/null || break   # exited meanwhile: the check after `wait` covers it
    if fault_seen; then
      pkill -TERM -P "$pid" 2>/dev/null; kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null
      fault_abort "$slug" during
    fi
  done
  wait "$pid"; rc=$?
  fault_seen && fault_abort "$slug" "at the end of"
  return "$rc"; }

cell_args () {  # slug reps maxt min_gen -> sets C_REPS C_MAXT C_MG from the knobs; 1 when done/filtered/INCOMPLETE
  C_REPS=$2; C_MAXT=$3; C_MG=$4
  if [ -f "$RAW/done/$1" ]; then echo "  skip (done): $1"; return 1; fi
  want_cell "$1" || { echo "  skip (ONLY filter): $1"; return 1; }
  if [ -f "$RAW/done/$1.incomplete" ] && [ "$RETRY_INCOMPLETE" != 1 ]; then
    echo "  skip (INCOMPLETE earlier: $(cat "$RAW/done/$1.incomplete"); RETRY_INCOMPLETE=1 reruns it): $1"; return 1; fi
  [ -n "$REPS_OVERRIDE" ] && C_REPS=$REPS_OVERRIDE
  if [ -n "$MAXTOK_OVERRIDE" ]; then C_MAXT=$MAXTOK_OVERRIDE; C_MG=0; fi
  [ -n "$MINGEN_OVERRIDE" ] && C_MG=$MINGEN_OVERRIDE
  return 0; }
finish_cell () {  # slug rc -> done marker (0) | INCOMPLETE stop with n_short (3) | FAILED (other)
  local slug=$1 rc=$2 st="$RAW/status-$1.json" info
  if [ "$rc" -eq 0 ]; then   # engine-bench appended its rows to results.jsonl (complete probes only, rule 18)
    touch "$RAW/done/$slug"; rm -f "$RAW/done/$slug.incomplete"; return 0; fi
  if [ "$rc" -eq 3 ]; then   # min-gen short: no rows, no marker; not retried silently (seeds are deterministic)
    info=$(python3 -c 'import json, sys; d = json.load(open(sys.argv[1]))
print("n_short=%s of %s below min_gen %s" % (d["n_short"], d["n_total"], d["min_gen"]))' "$st" 2>/dev/null) \
      || info="n_short unknown (no engine-bench status in $st)"
    echo "$info" > "$RAW/done/$slug.incomplete"
    echo "INCOMPLETE $slug: $info -- cell stopped, NOT retried (the seeds repeat the same short replies on a rerun);" \
      "rerun it deliberately with RETRY_INCOMPLETE=1 ONLY='$slug' (optionally a lower MIN_GEN)" | tee -a "$RES/failures.txt"
    return 0; fi
  echo "  FAILED: $slug (engine-bench exit $rc)" | tee -a "$RES/failures.txt"; }
run_probe_cell () {  # slug conc reps maxt min_gen sampling tags spec_rows fixture -> engine-bench probe
  local slug=$1 conc=$2 smp=$6 tags=$7 srows=$8 pf=$9 wu=0 rc
  cell_args "$slug" "$3" "$4" "$5" || return 0
  [ "$WARM_DONE" = 0 ] && wu=$FIRST_WARMUP   # the first probe of a boot warms up (JIT/graph capture), later ones don't
  WARM_DONE=1
  watched "$slug" env CAMPAIGN_DIR="$PROBE_CAMPAIGN" PROMPT_FILE="$GEN/$pf" SLUG="$slug" MAX_TOKENS="$C_MAXT" \
       CONCURRENCY="$conc" REPS="$C_REPS" WARMUP="$wu" API="$API" PREFIX_MODE="$PREFIX_MODE" SAMPLING="$smp" \
       MIN_GEN="$C_MG" TAGS="$tags,tg=$C_MAXT,residency=$RESIDENCY" SPEC_ROWS="$srows" STATUS_OUT="$RAW/status-$slug.json" \
       SAMPLE_VRAM=1 "$EB/run.sh"; rc=$?
  finish_cell "$slug" "$rc"; }
run_conv_cell () {  # slug reps maxt min_gen start step max_depth sampling tags spec_rows prompt turn_prompt kwargs
  local slug=$1 start=$5 step=$6 depth=$7 smp=$8 tags=$9 srows=${10} pf=${11} tp=${12} kw=${13} tpa=() rc
  cell_args "$slug" "$2" "$3" "$4" || return 0
  WARM_DONE=1   # no warm-up on conversation cells (engine-bench takes none); a resumed run may start cold here
  [ -n "$tp" ] && tpa=("TURN_PROMPT=$ROOT/bench/workloads/tasks/$tp")
  watched "$slug" env CAMPAIGN_DIR="$PROBE_CAMPAIGN" MODE=conversation PROMPT_FILE="$GEN/$pf" SLUG="$slug" \
       MAX_TOKENS="$C_MAXT" REPS="$C_REPS" START_TOKENS="$start" STEP_TOKENS="$step" MAX_DEPTH="$depth" \
       CHAT_KWARGS="$kw" "${tpa[@]}" SAMPLING="$smp" MIN_GEN="$C_MG" STATUS_OUT="$RAW/status-$slug.json" \
       TAGS="$tags,tg=$C_MAXT,residency=$RESIDENCY" SPEC_ROWS="$srows" SAMPLE_VRAM=1 "$EB/run.sh"; rc=$?
  finish_cell "$slug" "$rc"; }
sentinel_check () {  # arm ladder_slug sentinel_slug spec(0|1) tol_pct -> DRIFT line(s) in failures.txt (plan §2.5)
  # runs after the server block (also on a resume that boots nothing); the .drift marker is written only when a
  # drift record was written, so a missing ladder/sentinel row leaves the check pending, never consumed
  [ -f "$RAW/done/$3" ] && [ ! -f "$RAW/done/$3.drift" ] && [ -f "$RES/results.jsonl" ] || return 0
  if python3 - "$RES/results.jsonl" "$RES/drift.jsonl" "$@" <<'PY' | tee -a "$RES/failures.txt"; then
@@SENTINEL_PY@@PY
    touch "$RAW/done/$3.drift"
  else echo "  drift check $3: ladder or sentinel row missing -- still pending" >&2; fi; }

# --- pins preflight (ported from the KLD preflight; rule 2): refuse before any GPU work ---
pin_sha () {  # path sha256 -> 0 when it matches (cached per path+size+mtime: a 30 GB GGUF hashes once)
  local p=$1 want=$2 st key cache got
  [ -f "$p" ] || { echo "PIN-FAIL: missing $p" >&2; return 1; }
  st=$(stat -L -c '%s:%Y' "$p"); key=$(printf '%s' "$p" | sha256sum | cut -c1-16); cache="$CAMPAIGN_DIR/tmp/pins/$key"
  if [ -f "$cache" ] && [ "$(sed -n 1p "$cache")" = "$st" ]; then got=$(sed -n 2p "$cache")
  else echo "  hashing $p (once per size+mtime) ..."; got=$(sha256sum "$p" | cut -d' ' -f1)
    mkdir -p "${cache%/*}"; printf '%s\n%s\n' "$st" "$got" > "$cache"; fi
  [ "$got" = "$want" ] || { echo "PIN-FAIL: sha256 drift $p: $got != pinned $want" >&2; return 1; }; }
pin_image () {  # ref [digest] -> present, and its image id / a repo digest contains the pinned digest
  local info
  info=$("$DOCKER" image inspect --format '{{.Id}} {{range .RepoDigests}}{{.}} {{end}}' "$1" 2>/dev/null) \
    || { echo "PIN-FAIL: image $1 not present" >&2; return 1; }
  [ -z "${2:-}" ] || [[ "$info" == *"$2"* ]] || { echo "PIN-FAIL: image $1 drift: have '$info', pinned '$2'" >&2; return 1; }; }
pin_single () {  # glob -> exactly one match (one revision dir per model, as in the KLD preflight)
  local n; n=$(compgen -G "$1" | wc -l)
  [ "$n" -eq 1 ] || { echo "PIN-FAIL: expected exactly 1 match of $1, got $n" >&2; return 1; }; }
preflight () {
  local fail=0 t v c caps
  for t in "$EB/run.sh" "$GPU_EXCLUSIVE" "$BOOT_DIAG"@@TOOLS@@; do
    [ -e "$t" ] || { echo "PIN-FAIL: tool missing: $t" >&2; fail=1; }; done
  caps=$("$EB/run.sh" --capabilities 2>/dev/null | sed -n 's/^engine-bench-capabilities: //p')
  for v in @@EBC@@; do   # the engine-bench passthrough these cells need (silently dropped tags/sampling = rule 2 breach)
    case " $caps " in *" $v "*) ;;
      *) echo "PIN-FAIL: $EB/run.sh --capabilities lacks $v (engine-bench passthrough for gen_campaign G1 not installed)" >&2; fail=1;; esac
  done
  if [ "${#UNPINNED[@]}" -gt 0 ]; then   # rule 2: a measured cell needs pinned weights/build/image; smoke may run unpinned
    for c in "${ALL_CELLS[@]}"; do
      case "$c" in *-smoke-*) continue;; esac
      cell_open "$c" || continue
      echo "PIN-FAIL: unpinned ${UNPINNED[*]} -- pin them (pins.files / pins.images / pins.binaries) or select only smoke cells (ONLY='*-smoke-*')" >&2
      fail=1; break
    done
  fi
@@PINS@@  [ "$fail" -eq 0 ] || { echo "PREFLIGHT FAILED -- fix the pins above; no GPU work started" >&2; exit 1; }
  echo "preflight OK"; }
'''


# python bodies of the run.sh heredocs: module constants so the tests can exercise them directly
IDENTITY_PY = r'''import json, sys
try:
    ids = [m.get("id") for m in json.load(open(sys.argv[1])).get("data", [])]
except Exception as e:
    print(f"unparseable /v1/models ({e})"); sys.exit()
if ids != [sys.argv[2]]:
    print(f"/v1/models lists {ids}, expected exactly [{sys.argv[2]!r}]")
'''

SENTINEL_PY = r'''import json, sys
rows_f, out_f, arm, lad, sen, spec, tol = sys.argv[1:8]
last = {}
for line in open(rows_f, encoding="utf-8"):
    try:
        r = json.loads(line)
    except ValueError:
        continue
    if r.get("kind") == "aggregate" and r.get("engine") == arm and r.get("label") in (lad, sen) and "error" not in r:
        last[r["label"]] = r
L, S = last.get(lad), last.get(sen)
if not (L and S):
    sys.exit(2)   # nothing to compare yet: the caller keeps the check pending
res = {"kind": "drift", "arm": arm, "ladder": lad, "sentinel": sen, "spec": spec == "1", "tol_pct": float(tol)}
for m in ("decode_tok_s_wall", "prefill_tok_s_wall"):
    l, s, lo, hi = L.get(m + "_p50"), S.get(m + "_p50"), L.get(m + "_min"), L.get(m + "_max")
    if l is None or s is None or l == 0:
        continue
    if spec == "1" and lo is not None and hi is not None:
        drift, rule = not (lo <= s <= hi), f"outside the ladder cell's min-max [{lo}, {hi}]"
    else:
        drift, rule = abs(s - l) / l * 100 > float(tol), f"|delta| > {tol}%"
    res[m] = {"ladder_p50": l, "sentinel_p50": s, "drift": drift}
    if drift:
        print(f"DRIFT {sen}: {m}_p50 ladder={l} sentinel={s} ({rule})")
with open(out_f, "a", encoding="utf-8") as fh:
    fh.write(json.dumps(res) + "\n")
'''


def _sq(*parts):
    return " ".join(sh_quote(p) for p in parts)


def multi_srv_env(spec, s):
    """The launcher env (KEY=VAL list) of one server, passed via env "${srv_env[@]}" (never word-expanded)."""
    m = multi_server(spec, s)
    eng, port, xa = s["engine"], m["port"], (s.get("extra_args") or "").split()
    if eng == "llamacpp":
        t = dict(MULTI_TUNING_DEFAULTS, **(spec.get("tuning") or {}))
        e = [f"MODEL={s['gguf']}", f"LLAMA_SERVER={s['bin']}", f"BACKEND={s.get('backend', 'vulkan')}",
             f"CTX={s['ctx']}", f"NP={s['np']}", f"KV={s['kv']}", f"MTP={s.get('mtp', 0)}", f"UB={t['ub']}",
             f"B={t['b']}", f"FA={t['fa']}", f"PORT={port}", "WAIT=900",
             "EXTRA_ARGS=" + " ".join(["--alias", s["served_model"]] + xa)]
    elif eng == "vllm":
        e = [f"PROFILE={s['profile']}", f"IMAGE={s['image']}", f"MAXLEN={s['ctx']}", f"MAXSEQS={s['np']}",
             f"KV_DTYPE={s['kv']}", f"FREE_MIB_FLOOR={m['floor']}", f"PORT={port}"]
        if xa:
            e.append("EXTRA_ARGS=" + " ".join(xa))
    else:
        e = [f"RAD_FILE={s['rad_file']}", f"IMAGE={s['image']}", f"PORT={port}", f"MAXLEN={s['ctx']}",
             f"MAXSEQS={s['np']}", f"KV_DTYPE={s['kv']}", "TP=1", f"SERVED_NAME={s['served_model']}", "WAIT=900",
             f"FREE_MIB_FLOOR={m['floor']}", f"CONTAINER_NAME=radiance-{port}",
             "EXTRA_ARGS=" + " ".join(xa + ["--num-speculative-tokens", str(s["spec_tokens"])])]
    return e + [f"{k}={v}" for k, v in (s.get("env") or {}).items()]


def multi_needles(s):
    """Strings the state-dir cmdline must contain after the boot (identity gate)."""
    if s["engine"] == "llamacpp":
        return [s["bin"], s["gguf"], f"--alias {s['served_model']}"]
    if s["engine"] == "vllm":
        return [s["image"], f"--served-model-name {s['served_model']}", f"# profile={s['profile']} "]
    rad = s["rad_file"]
    return [s["image"], os.path.dirname(rad) + ":/models:ro", "/models/" + os.path.basename(rad),
            f"--served-model-name {s['served_model']}"]


def _multi_pins_sh(spec):
    pins = spec.get("pins") or {}
    L = []
    for p, h in (pins.get("files") or {}).items():
        L.append(f"  pin_sha {_sq(p, h)} || fail=1")
    for g in pins.get("single") or []:
        L.append(f"  pin_single {sh_quote(g)} || fail=1")
    weights = []
    for s in spec["servers"]:
        for k in ("gguf", "rad_file"):
            if s.get(k) and s[k] not in weights:
                weights.append(s[k])
    for p in weights:
        L.append(f"  [ -f {sh_quote(p)} ] || {{ echo {sh_quote('PIN-FAIL: missing ' + p)} >&2; fail=1; }}")
    for s in spec["servers"]:
        if s.get("model"):
            L.append(f"  [ -e {sh_quote(s['model'])} ] || {{ echo {sh_quote('PIN-FAIL: missing ' + s['model'])} >&2; fail=1; }}")
    bins = list(dict.fromkeys([s["bin"] for s in spec["servers"] if s.get("bin")] + list(pins.get("binaries") or [])))
    for b in bins:
        L.append(f"  [ -x {sh_quote(b)} ] || {{ echo {sh_quote('PIN-FAIL: not executable: ' + b)} >&2; fail=1; }}")
    imgs = pins.get("images") or {}
    for ref in dict.fromkeys([s["image"] for s in spec["servers"] if s.get("image")] + list(imgs)):
        L.append(f"  pin_image {_sq(ref, imgs.get(ref, ''))} || fail=1")
    for port in sorted({multi_server(spec, s)["port"] for s in spec["servers"]}):
        L.append(f"  if gate_port_held {port}; then echo 'RUN REFUSED: port {port} is held (another server/run) -- "
                 f"free it first' >&2; fail=1; fi")
    return "".join(l + "\n" for l in L)


def emit_multi_runsh(spec):
    w = multi_workload(spec)
    srvs = spec["servers"]
    ms = [multi_server(spec, s) for s in srvs]
    notes = spec.get("notes")
    notes_sh = "".join(f"# NOTE: {n}\n" for n in ([notes] if isinstance(notes, str) else notes or []))
    meta_lines = []
    for s, m in zip(srvs, ms):
        ident = {"llamacpp": f"gguf={s.get('gguf')} bin={s.get('bin')} backend={s.get('backend', 'vulkan')} mtp={s.get('mtp', 0)}",
                 "vllm": f"profile={s.get('profile')} image={s.get('image')}",
                 "radiance": f"rad_file={s.get('rad_file')} image={s.get('image')} spec_tokens={s.get('spec_tokens')}"}[s["engine"]]
        meta_lines.append(f"server[{m['name']}]=engine={s['engine']} arm={m['arm']} pass={m['pass']} tier={m['tier']} "
                          f"served={s['served_model']} ctx={s['ctx']} np={s['np']} kv={s['kv']} port={m['port']} "
                          f"floor_mib={m['floor']} working_set_mib={m['ws']} {ident}"
                          + (f" extra_args={s['extra_args']}" if s.get("extra_args") else "")
                          + (f" env={env_assign(s['env'])}" if s.get("env") else ""))
        meta_lines.append(f"sampling[{m['name']}]={multi_sampling(spec, s)}")
    meta = "".join(f"    echo {sh_quote(l)}\n" for l in meta_lines)
    tools = sorted({{"llamacpp": ' "$SERVE_LLAMA"', "vllm": ' "$SERVE_VLLM"', "radiance": ' "$SERVE_RAD"'}[s["engine"]]
                    for s in srvs})
    head = (MULTI_RUNSH_HEAD
            .replace("@@SLUG@@", spec["slug"])
            .replace("@@NOTES@@", ("#\n" + notes_sh) if notes_sh else "")
            .replace("@@ROOTS@@", RUNSH_ROOTS)
            .replace("@@WARMUP@@", str(w["first_warmup"]))
            .replace("@@MINGEN@@", str(w["min_gen"]))
            .replace("@@CONV_MINGEN@@", str(conv_min_gen(w)) if w.get("conversation") else "none")
            .replace("@@ALL_CELLS@@", _sq(*[c["slug"] for s in srvs for c in multi_cells(spec, s)]))
            .replace("@@UNPINNED@@", _sq(*multi_unpinned(spec)) if multi_unpinned(spec) else "")
            .replace("@@API@@", w["api"])
            .replace("@@PREFIX@@", w["prefix_mode"])
            .replace("@@ORDER@@", " ".join(m["name"] for m in ms))
            .replace("@@META@@", meta)
            .replace("@@ENSURE@@", "\n".join(ENSURE_FIXTURES_SH))
            .replace("@@TOOLS@@", "".join(tools))
            .replace("@@EBC@@", " ".join(EB_CONTRACT))
            .replace("@@PINS@@", _multi_pins_sh(spec))
            .replace("@@IDENTITY_PY@@", IDENTITY_PY)
            .replace("@@SENTINEL_PY@@", SENTINEL_PY))
    L = [head.rstrip("\n"), ""]
    ad = L.append
    ad("# ================================ execution ================================")
    ad("preflight")
    fixtures = sorted({c["fixture"] for s in srvs for c in multi_cells(spec, s)})
    ad("ensure_fixtures " + " ".join(sh_quote(f) for f in fixtures))
    fs = (spec.get("pins") or {}).get("fixtures_sha256")
    if fs:
        ad(f'( cd "$GEN" && sha256sum -c --quiet "$CAMPAIGN_DIR/{fs}" ) '
           f'|| {{ echo "PIN-FAIL: fixtures drift vs {fs} -- no GPU work started" >&2; exit 1; }}')
    ad("")
    se = w.get("sentinel")
    for i, (s, m) in enumerate(zip(srvs, ms), 1):
        cells = multi_cells(spec, s)
        smp = multi_sampling(spec, s)
        srows = SPEC_ROWS_MODE[s["engine"]]   # spec_metrics `rows` on llama.cpp, snap/diff on vllm/radiance (G3)
        ad(f"# ===== server {i}/{len(srvs)}: {m['name']} ({s['engine']} · arm {m['arm']} · pass {m['pass']} · "
           f"tier {m['tier']} · served {s['served_model']} · ctx {s['ctx']} np {s['np']} kv {s['kv']} · "
           f"spec {'on' if m['spec'] else 'off'}) =====")
        ad(f"CELLS=({_sq(*[c['slug'] for c in cells])})")
        ad('if ! cells_pending "${CELLS[@]}"; then')
        ad(f'  echo "  skip: server {m["name"]} -- no selected cell pending (done or ONLY-filtered)"')
        ad("else")
        ad(f"  export ENGINES_LIST={sh_quote(m['arm'] + '|http://localhost:' + str(m['port']) + '/v1|' + s['served_model'])}"
           "   # set from the spec, never inherited")
        ad(f"  SMP={sh_quote(smp)}")
        mref = {"llamacpp": s.get("gguf"), "vllm": s.get("profile"), "radiance": s.get("rad_file")}[s["engine"]]
        image = s.get("bin") if s["engine"] == "llamacpp" else s["image"]
        ad(f"  if boot_server {_sq(s['engine'], m['name'], m['arm'], m['port'], m['floor'], image, s['served_model'], mref)} \\")
        env = multi_srv_env(spec, s)
        for j, e in enumerate(env):
            ad(f"       {sh_quote(e)}" + ("; then" if j == len(env) - 1 else " \\"))
        ad(f"    if identity_gate {m['port']} {_sq(s['served_model'], *multi_needles(s))}; then")
        ad(f"      residency_check {_sq(m['arm'], m['ws'])}")
        for c in cells:
            tags = ",".join(f"{k}={v}" for k, v in c["tags"].items())
            if c["mode"] == "probe":
                ad(f"      run_probe_cell {_sq(c['slug'], c['n'], c['reps'], c['max_tokens'], c['min_gen'])} \"$SMP\" "
                   f"{_sq(tags, srows, c['fixture'])}")
            else:
                ad(f"      run_conv_cell {_sq(c['slug'], c['reps'], c['max_tokens'], c['min_gen'], c['start'], c['step'], c['max_depth'])} "
                   f"\"$SMP\" {_sq(tags, srows, c['fixture'], c['turn_prompt'], c['kwargs'])}")
        ad("    fi")
        ad("    stop_current")
        ad("  fi")
        ad("fi")
        if se:   # outside the boot block: a resume that boots nothing still runs a pending drift check
            lad_slug = "%s-d%d-n1" % (m["name"], se["depth"])
            sen_slug = "%s-sentinel-d%d" % (m["name"], se["depth"])
            ad("sentinel_check " + _sq(m["arm"], lad_slug, sen_slug, 1 if m["spec"] else 0, se.get("tol_pct", 5)))
        ad("")
    ad("# ===== report (last step): theme-aware SVG charts + appendix.md =====")
    ad('if [ -f "$RES/results.jsonl" ]; then')
    ad('  python3 "$ROOT/bench/core/report.py" "${RUN_DIR:-$CAMPAIGN_DIR}" \\')
    ad('    && echo "charts: $RES/charts/  ·  appendix: $RES/appendix.md"')
    ad("fi")
    ad('echo "campaign done. results: $RES/results.jsonl  boots: $RES/boots.jsonl  (raw: $RAW/)"')
    ad('[ -f "$RES/failures.txt" ] && { echo "--- failures / warnings ---"; cat "$RES/failures.txt"; } || true')
    return "\n".join(L) + "\n"


def emit_multi_readme(spec):
    slug, date, cd = spec["slug"], campaign_date(spec), campaign_rel(spec)
    w = multi_workload(spec)
    title = spec.get("title", f"{slug} campaign")
    rows = []
    for s in spec["servers"]:
        m = multi_server(spec, s)
        what = {"llamacpp": f"`{os.path.basename(s.get('gguf', ''))}` · build `{s.get('bin')}`",
                "vllm": f"profile `{s.get('profile')}` · `{s.get('image')}`",
                "radiance": f"`{os.path.basename(s.get('rad_file', ''))}` · `{s.get('image')}` · k={s.get('spec_tokens')}"}
        cells = multi_cells(spec, s)
        rows.append(f"| {m['name']} | {s['engine']} | {m['arm']} | {m['pass']} | {what[s['engine']]} | "
                    f"`{s['served_model']}` | {s['ctx']}/{s['np']}/{s['kv']} | {'on' if m['spec'] else 'off'} | "
                    f"{m['floor']}/{m['ws']} | {len(cells)} |")
    rad = [s["name"] for s in spec["servers"] if s["engine"] == "radiance" and s.get("rep_penalty_key") is None]
    rad_note = (f"\n> ⚠️ **Radiance ({', '.join(rad)}): {RADIANCE_REP_WARN}.** Its rows carry `rep_key=UNVERIFIED`; "
                "do not compare a repetition-sensitive number against the other engines until the smoke settles it.\n"
                if rad else "")
    conv_gate = ("there is no conversation cell." if not w.get("conversation") else
                 f"every conversation turn must generate >= {conv_min_gen(w)} tokens (gated by engine-bench)."
                 if conv_min_gen(w) else "conversation turns are not gated (`conversation.min_gen` unset = 0).")
    cells = "\n".join(f"- `{c['slug']}` ({c['cell']}, n={c['n']}, reps {c['reps']}, "
                      + (f"{c['fixture']})" if c["mode"] == "probe" else f"conversation to {c['max_depth']})")
                      for c in multi_cells(spec, spec["servers"][0]))
    return f"""# {title} (R9700, {date})

Scaffolded by `bench/core/gen_campaign.py` (multi-engine throughput, G1). The executable driver is
**`run.sh`** in this folder: resumable (per-cell markers in `tmp/done/`), one engine at a time, in the
server order below. Fill in the prose (goal, decisions, out of scope).

## Servers (run order)
| server | engine | arm | pass | weights · runtime | served | ctx/np/kv | spec | floor/ws MiB | cells |
|---|---|---|---|---|---|---|---|---|---|
{chr(10).join(rows)}

Sampling (every request, explicit): `{json.dumps(spec['sampling'], separators=(',', ':'))}` plus
`repetition_penalty {w.get('repetition_penalty')}` under each server's own key (llama.cpp `repeat_penalty`,
vLLM `repetition_penalty`, radiance: only if the server sets `rep_penalty_key`). API `{w['api']}`,
max_tokens {w['max_tokens']}, prefix `{w['prefix_mode']}`, first-probe warm-up {w['first_warmup']}.
Every row carries `--tag arm,depth,n,tg,workload,pass,tier,cell,rep_key,residency` (conversation rows: no depth).
{rad_note}
**Min-gen gate:** a probe cell needs every request to generate >= {w['min_gen']} tokens; {conv_gate}
A short cell writes no rows and no done marker: run.sh stops it as **INCOMPLETE** with its `n_short` in
`results/failures.txt` and does not retry it (the seeds are deterministic, a rerun repeats the same short replies);
`RETRY_INCOMPLETE=1 ONLY='<slug>'` reruns it deliberately.

## Cells (first server shown; every server gets the same shape, depth/np permitting)
{cells}

## Run
```bash
bash {cd}/run.sh                                     # resume: same command
RUN_TAG=smoke-1 ONLY='*-smoke-*' bash {cd}/run.sh    # smoke (opt-in cells), isolated in tmp/runs/smoke-1/
ONLY='q4kxl-*' REPS=1 bash {cd}/run.sh               # one server, quick pass
```
**Requires** `bench/perf/engine-bench/run.sh --capabilities` to list `{'`, `'.join(EB_CONTRACT)}` (preflight refuses otherwise).
Fixtures pin (`pins.fixtures_sha256`, optional): {FIXTURES_SHA_FORMAT}.

## Per server, run.sh does
power snapshot → `gpu_exclusive.sh <floor>` → boot gate (port free AND free VRAM ≥ floor) → VRAM sampler
across the boot → `serve_<engine>.sh` print + start → `boot_diag.py record` (`results/boots.jsonl`) →
identity gate (`/v1/models` = served name; state-dir cmdline names the pinned image/build + model) →
residency vs the expected working set (stamped on every row as `residency=ok|low|unknown`) → cells under a
Memory-Fault watcher (a fault aborts the run and moves the cell's rows to `results/quarantine.jsonl`) → stop by
pidfile/container + port-free + VRAM-idle verify → power snapshot; then the drift check (sentinel vs ladder).
Cell order per boot: smoke (opt-in) → ladder ascending (n=N right after its depth) → sentinel → conversation.

## Layout
- `results/` (committed): `results.jsonl`, `boots.jsonl`, `drift.jsonl`, `residency.jsonl`, `quarantine.jsonl`, `meta.txt`, `failures.txt`,
  `server-<slug>.txt`, `models-<slug>.json`, `residency-<slug>.txt`, `power-<slug>.txt`, `charts/`, `appendix.md`.
- `tmp/` (git-ignored raw): `done/` markers, per-probe `<stamp>-engine-<cell>/` dirs, boot logs/CSVs, stop records.

## Write-up
**benchmark-results** skill → `docs/findings/<topic>/{date}-{slug}.md` with `campaign: {cd}` in its meta block.
"""


EXAMPLE_MULTI = {
    "slug": "example-multi", "port": 8000, "tuning": {"ub": 2048, "b": 8192, "fa": "on"},
    "notes": ["arm order interleaves engine families (plan §2.5)",
              "PLACEHOLDER pins: every all-zero sha256 / digest below is a stand-in -- replace it with the real value "
              "(sha256sum <file>; docker image inspect --format '{{.Id}}' <image>) before the first non-smoke run",
              "the bin/gguf/rad paths are this box's; adjust them for another machine"],
    "sampling": {"temperature": 1.0, "top_p": 0.95, "top_k": 20, "min_p": 0, "presence_penalty": 0,
                 "frequency_penalty": 0, "seed": 1234},
    "workload": {
        "tier": "minimal", "pass": "A", "api": "chat", "max_tokens": 1024, "min_gen": 900, "prefix_mode": "unique",
        "fixture": "codereview-{depth}.txt", "first_warmup": 2, "repetition_penalty": 1.0,
        "ladder": {"depths": [8000, 32000, 100000, 200000], "reps": 3, "spec_reps": 5,
                   "spec_depths": [32000, 100000, 200000]},
        "concurrency": {"n": 2, "depths": [32000], "reps": 3},
        "conversation": {"prompt": "codereview-270000.txt", "start_tokens": 10000, "step_tokens": 20000,
                         "max_depth": 205000, "max_tokens": 512, "reps": 1, "turn_prompt": "codereview-large.task.md"},
        "sentinel": {"depth": 32000, "reps": 1, "tol_pct": 5},
        "smoke": {"depth": 8000}},
    "pins": {
        "files": {"/home/dev/models/gguf/unsloth/Qwen3.8-27B-UD-Q4_K_XL.gguf": "0" * 64,
                  "/home/dev/work/dp-craft/amd/stack/llamacpp/var/builds/b11448-vulkan-1.4.363.0/bin/llama-server": "0" * 64,
                  "/mnt/Lin1/work/radiance/models/StillDeadcode__qwen3.8-27b-mxfp4@60bd4139/qwen3.8-27b-mxfp4.rad": "0" * 64},
        "images": {"stilldeadcode/radiance:1.17.0": "sha256:" + "0" * 12,
                   "ghcr.io/slybase/vllm-sly-radiance:1.11.0-rocm10.1": "22baa741ab04"},
        "single": ["/mnt/Lin1/work/radiance/models/StillDeadcode__qwen3.8-27b-mxfp4@*/qwen3.8-27b-mxfp4.rad"]},
    "servers": [
        {"name": "q4kxl", "engine": "llamacpp", "served_model": "qwen38-27b-ud-q4kxl",
         "gguf": "/home/dev/models/gguf/unsloth/Qwen3.8-27B-UD-Q4_K_XL.gguf",
         "bin": "/home/dev/work/dp-craft/amd/stack/llamacpp/var/builds/b11448-vulkan-1.4.363.0/bin/llama-server",
         "backend": "vulkan", "mtp": 0, "ctx": 260000, "np": 2, "kv": "q8_0", "extra_args": "--kv-unified",
         "working_set_mib": 20000, "free_mib_floor": 26000},
        {"name": "b", "engine": "radiance", "served_model": "qwen38-27b-mxfp4",
         "rad_file": "/mnt/Lin1/work/radiance/models/StillDeadcode__qwen3.8-27b-mxfp4@60bd4139/qwen3.8-27b-mxfp4.rad",
         "image": "stilldeadcode/radiance:1.17.0", "spec_tokens": 7, "ctx": 260000, "np": 2, "kv": "fp8",
         "extra_args": "--gpu-headroom-mib 596", "working_set_mib": 16794, "free_mib_floor": 30000},
        {"name": "d", "engine": "vllm", "served_model": "qwen38-27b-redhat-mxfp4-dflash",
         "profile": "sly-redhat/redhat-mxfp4-dflash", "image": "ghcr.io/slybase/vllm-sly-radiance:1.11.0-rocm10.1",
         "spec": True, "ctx": 260000, "np": 2, "kv": "fp8", "working_set_mib": 16794, "free_mib_floor": 30000,
         "env": {"WATCHDOG_MIB": "32", "GPU_UTIL": "0.93", "CACTUS_DELTA": "0",
                 "CHAT_TEMPLATE": "/home/dev/work/dp-craft/amd/stack/serve/vllm/templates/dp-sharp-chat_template.jinja"}},
    ]}


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
                  "(configs launch regardless of budget). Add vram.kv_kib_per_tok to enable it.", file=sys.stderr)
        return "plan.md"
    if is_multi(spec):
        validate_multi(spec)
        return "README.md"
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
        prof = os.path.join(VLLM_PROFILES, spec["profile"] + ".env")
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
        print("⚠️  WARNING: no VRAM prediction for server(s): " + ", ".join(unpredictable), file=sys.stderr)
        print("    → the pre-flight guard is DISABLED for them; they WILL launch regardless of the", file=sys.stderr)
        print("      VRAM budget (risk of GTT spill / GPU freeze at high context).", file=sys.stderr)
        print("    Add a `vram` block to the spec: weights_gib + kv_kib_per_tok (per KV type used).", file=sys.stderr)
    return "README.md"


def cmd_emit(args):
    with open(args.spec, encoding="utf-8") as fh:
        spec = json.load(fh)
    validate_layout(spec)
    if not spec.get("date"):   # resolve once: the stamp of the campaign dir the spec sits in, else now
        m = re.fullmatch(r"(\d{4}-\d{2}-\d{2}-\d{4})-" + re.escape(str(spec.get("slug", ""))),
                         os.path.basename(os.path.dirname(os.path.abspath(args.spec))))
        spec["date"] = m.group(1) if m else campaign_date(spec)
    doc_name = validate_spec(spec)
    cdir = os.path.join(REPO, campaign_rel(spec))   # campaigns/<type>/<date>-<slug>/
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
    "install": [{"src": "campaigns/agentic/2026-10-30-0947-dpf-brief-ab/results/sly191-w208/RUNBOOK.optimized.md",
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
    x.add_argument("--multi-engine", action="store_true",
                   help="print a multi-engine throughput spec (servers[].engine = llamacpp | vllm | radiance)")
    x.set_defaults(func=lambda a: print(json.dumps(
        EXAMPLE_MULTI if a.multi_engine else EXAMPLE_AGENTIC if a.agentic else EXAMPLE_QUALITY if a.quality
        else EXAMPLE, indent=2)))
    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()

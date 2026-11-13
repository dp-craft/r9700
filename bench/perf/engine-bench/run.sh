#!/usr/bin/env bash
# engine-bench — cross-engine comparator. Sends the SAME real workload to each engine's
# OpenAI-compatible /v1 endpoint and records prefill/decode/TTFT (+ thinking + concurrency metrics).
#
# Two measurement backends:
#   1. capture_engine.py probe (bench/core/) — zero install: real prompt files, thinking-mode ttfa,
#      --concurrency waves, prefix modes (agentic). Default.
#   2. llama-benchy    — standardized synthetic pp/tg/depth curves with concurrency
#      (install: see README). Set USE_BENCHY=1. Complements, does not replace, the probe.
#
# You start the engine servers yourself (docs/guides/GUIDE.md, or stack/serve/llamacpp/serve_llamacpp.sh);
# this script only drives them. Engine list: edit ENGINES below or set ENGINES_LIST
# (semicolon-separated "name|base-url-with-/v1|model" entries).
#
# Two roots (layout contract): RAW = $CAMPAIGN_DIR/tmp/<stamp>-engine-<slug>/ (per-run meta.txt,
# prompt copies, /props dumps, gpu_samples.csv, and this run's rows in results.jsonl, which
# phase_power.py reads); at the end the run's rows are APPENDED to $CAMPAIGN_DIR/results/results.jsonl
# once, only if every probe succeeded (a caller never appends them a second time).
#
# Env: CAMPAIGN_DIR (REQUIRED: campaigns/<type>/<stamp>-<slug>; raw -> tmp/, rows -> results/)
#      PROMPT_FILE (required for probe; space-separated list = per-stream variants)
#      SLUG MAX_TOKENS CONCURRENCY REPS WARMUP PREFIX_MODE (none|unique|shared)
#      MODE=conversation (+ START_TOKENS STEP_TOKENS MAX_DEPTH CHAT_KWARGS [TURN_PROMPT]): growing multi-turn chat
#      USE_BENCHY BENCHY_ARGS
#      SAMPLE_VRAM=1  → log GPU VRAM+GTT+power across the probe (gpu_samples.csv) and fold a
#                      `gpu` row into results.jsonl. NOTE: the sampler spans the whole engine
#                      loop, so the memory row is only cleanly attributable when ENGINES_LIST
#                      has ONE engine (the campaign case). Multi-engine comparisons share it.
#      Optional passthrough (gen_campaign G1 multi-engine cells; UNSET = the behaviour before it, exactly):
#      SAMPLING='{json}'  -> capture_engine --sampling (probe + conversation)
#      TAGS='k=v,k=v'     -> one capture_engine --tag per item (probe + conversation)
#      MIN_GEN=N          -> probe: capture_engine --min-gen N (its exit 3 = short/incomplete); conversation:
#                           engine-bench gates the turn rows itself (every turn's gen_tokens >= N). A short
#                           probe or conversation fails the run with exit 3 (rows NOT added, rule 18).
#      SPEC_ROWS=rows|diff|off -> spec acceptance rows: rows = spec_metrics `rows` over this run's own rows
#                           (llama.cpp), diff = snap/diff of the server counters (vLLM, radiance), off = none.
#                           Unset = the legacy snap/diff after every probe (stderr discarded).
#      STATUS_OUT=FILE    -> one JSON status line at the end: ok, short, n_short, n_total, min_gen, failed.
#      `run.sh --capabilities` prints these variable names (a caller's preflight checks the line).
set -euo pipefail
if [ "${1:-}" = "--capabilities" ]; then
  echo "engine-bench-capabilities: SAMPLING MIN_GEN TAGS SPEC_ROWS STATUS_OUT"; exit 0
fi
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(git -C "$HERE" rev-parse --show-toplevel)"
USAGE="usage: CAMPAIGN_DIR=campaigns/<type>/<stamp>-<slug> PROMPT_FILE=/path/to/workload.txt SLUG=… $0"
[ -n "${CAMPAIGN_DIR:-}" ] || { echo "CAMPAIGN_DIR is not set — $USAGE" >&2; exit 2; }
CAMPAIGN_DIR="$(realpath -m "$CAMPAIGN_DIR")"

: "${SLUG:=enginecmp}"
: "${MAX_TOKENS:=512}"
: "${CONCURRENCY:=1}"
: "${REPS:=1}"
: "${WARMUP:=1}"
: "${PREFIX_MODE:=none}"
: "${API:=completions}"   # chat = apply chat template (use for instruction/thinking prompts)
: "${USE_BENCHY:=0}"

if [ "$USE_BENCHY" != "1" ]; then
  : "${PROMPT_FILE:?set PROMPT_FILE=/path/to/workload.txt (see bench/workloads/; space-separated list allowed)}"
fi

# Engines to compare: "label|base_url_with_/v1|model". Comment out what you're not running,
# or override the whole list via ENGINES_LIST="a|url|m;b|url|m".
ENGINES=(
  "llamacpp-rocm|http://localhost:8080/v1|local"
  "llamacpp-vulkan|http://localhost:8081/v1|local"
  "ollama|http://localhost:11434/v1|q35:local"
  # "vllm|http://localhost:8000/v1|Qwen3.6-35B-A3B-AWQ-4bit"
)
if [ -n "${ENGINES_LIST:-}" ]; then
  IFS=';' read -r -a ENGINES <<<"$ENGINES_LIST"
fi
# --- optional passthrough (empty arrays when unset: the capture_engine argv is then unchanged) ---
PASS_ARGS=()
[ -n "${SAMPLING:-}" ] && PASS_ARGS+=(--sampling "$SAMPLING")
if [ -n "${TAGS:-}" ]; then
  IFS=',' read -r -a _tags <<<"$TAGS"
  for _t in "${_tags[@]}"; do [ -n "$_t" ] && PASS_ARGS+=(--tag "$_t"); done
fi
MINGEN_ARGS=()
if [ -n "${MIN_GEN:-}" ]; then
  case "$MIN_GEN" in *[!0-9]*) echo "MIN_GEN must be an integer >= 0, got '$MIN_GEN'" >&2; exit 2;; esac
  [ "$MIN_GEN" -gt 0 ] && MINGEN_ARGS=(--min-gen "$MIN_GEN")
fi
case "${SPEC_ROWS-legacy}" in
  legacy|rows|diff|off) ;;
  *) echo "SPEC_ROWS must be rows|diff|off (or unset), got '${SPEC_ROWS}'" >&2; exit 2;;
esac

STAMP="$(date '+%Y-%m-%d-%H%M')"
OUT="$CAMPAIGN_DIR/tmp/${STAMP}-engine-${SLUG}"   # raw run dir (meta.txt, prompt copies, props, GPU CSVs)
RUN_ROWS="$OUT/results.jsonl"                      # this run's rows (raw; phase_power.py reads them here)
ROWS="$CAMPAIGN_DIR/results/results.jsonl"         # campaign results: RUN_ROWS appended once at the end, on success
mkdir -p "$OUT" "$(dirname "$ROWS")"
{
  echo "date=$(date -Iseconds)"
  echo "workload=${PROMPT_FILE:-benchy-synthetic}"
  echo "max_tokens=$MAX_TOKENS concurrency=$CONCURRENCY reps=$REPS warmup=$WARMUP prefix_mode=$PREFIX_MODE"
  [ "${MODE:-probe}" = conversation ] && echo "mode=conversation start_tokens=${START_TOKENS:-10000} step_tokens=${STEP_TOKENS:-15000} max_depth=${MAX_DEPTH:-} chat_kwargs=${CHAT_KWARGS:-}${TURN_PROMPT:+ turn_prompt=$TURN_PROMPT}"
} > "$OUT/meta.txt"
if [ "$USE_BENCHY" != "1" ]; then
  for f in $PROMPT_FILE; do cp "$f" "$OUT/"; done
fi

# --- VRAM/GTT sampling (SAMPLE_VRAM=1): logs GPU memory across the probe so the report can show
#     memory-at-load, peak VRAM, and peak GTT (host-RAM spill = freeze risk). Best-effort. ---
SAMPLER_PID=""
if [ "${SAMPLE_VRAM:-0}" = "1" ] && { command -v rocm-smi >/dev/null 2>&1 || command -v nvidia-smi >/dev/null 2>&1; }; then
  python3 "$REPO/stack/gpu/vram_sampler.py" --out "$OUT/gpu_samples.csv" --interval 1 &
  SAMPLER_PID=$!
  # wait (≤2s) for the sampler to initialize (handler installed + first sample written) so a fast
  # probe can't kill it mid-startup and lose the memory row
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    [ -s "$OUT/gpu_samples.csv" ] && [ "$(wc -l <"$OUT/gpu_samples.csv")" -ge 2 ] && break
    kill -0 "$SAMPLER_PID" 2>/dev/null || break   # sampler died (e.g. smi missing) — stop waiting
    sleep 0.2
  done
fi
stop_sampler () { [ -n "$SAMPLER_PID" ] && kill "$SAMPLER_PID" 2>/dev/null && wait "$SAMPLER_PID" 2>/dev/null || true; SAMPLER_PID=""; }
trap stop_sampler EXIT

PROBE_FAILED=0   # nonzero exit at the end, so a caller never marks an all-failed probe as done
PROBE_SHORT=0    # a min-gen short happened (exit 3 when it is the only kind of failure)
PROBE_ERR=0      # a real failure happened (exit 1)
FAILED_ENGINES=()
conv_gate () {  # name -> 0 when every turn row of this run (label+engine) generated >= MIN_GEN tokens
  python3 - "$RUN_ROWS" "$SLUG" "$1" "$MIN_GEN" <<'PY'
import json, sys
rows_f, label, eng, mg = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
turns = []
for line in open(rows_f, encoding="utf-8"):
    try:
        d = json.loads(line)
    except ValueError:
        continue
    if d.get("kind") == "turn" and d.get("label") == label and d.get("engine") == eng and "error" not in d:
        turns.append(d.get("gen_tokens") or 0)
short = sum(1 for g in turns if g < mg)
print(json.dumps({"kind": "min_gen_gate", "label": label, "engine": eng, "min_gen": mg,
                  "n_turns": len(turns), "n_short": short}))
sys.exit(3 if short or not turns else 0)
PY
}
for e in "${ENGINES[@]}"; do
  IFS='|' read -r name url model <<<"$e"
  echo "== $name ($url) =="
  if ! curl -sf -m 3 "${url%/v1}/health" >/dev/null 2>&1 && ! curl -sf -m 3 "$url/models" >/dev/null 2>&1; then
    echo "  (skipped: $url not reachable)"; continue
  fi
  # record what the server says about itself (llama.cpp /props has build + full settings)
  curl -sf -m 5 "${url%/v1}/props" -o "$OUT/props_${name}.json" 2>/dev/null || true
  curl -sf -m 5 "$url/models" -o "$OUT/models_${name}.json" 2>/dev/null || true

  if [ "$USE_BENCHY" = "1" ]; then
    BENCHY="${BENCHY_BIN:-$REPO/stack/serve/var/venvs/benchy-venv/bin/llama-benchy}"
    "$BENCHY" --base-url "$url" --model "$model" ${BENCHY_ARGS:-} \
      > "$OUT/benchy_${name}.txt" 2>&1 || echo "  benchy failed for $name (see $OUT/benchy_${name}.txt)"
  else
    PF_ARGS=(); for f in $PROMPT_FILE; do PF_ARGS+=(--prompt-file "$f"); done
    # speculative-decoding acceptance for THIS probe: legacy/diff = vLLM/radiance counters snap/diff (no-op
    # for engines without them); rows = llama.cpp per-request draft_n over this run's own rows; off = none
    SPEC_MODE="${SPEC_ROWS-legacy}"
    if [ "$SPEC_MODE" = legacy ] || [ "$SPEC_MODE" = diff ]; then
      python3 "$REPO/stack/gpu/spec_metrics.py" snap "$url" > "$OUT/.spec_before_${name}.json" 2>/dev/null || echo '{}' > "$OUT/.spec_before_${name}.json"
    fi
    spec_row () {
      case "$SPEC_MODE" in
        legacy) python3 "$REPO/stack/gpu/spec_metrics.py" diff "$OUT/.spec_before_${name}.json" "$url" "$SLUG" "$name" \
                  >> "$RUN_ROWS" 2>/dev/null || true; rm -f "$OUT/.spec_before_${name}.json" ;;
        diff) if python3 "$REPO/stack/gpu/spec_metrics.py" diff "$OUT/.spec_before_${name}.json" "$url" "$SLUG" "$name" \
                   > "$OUT/.spec_${name}.jsonl" 2>>"$OUT/spec_metrics.err"; then cat "$OUT/.spec_${name}.jsonl" >> "$RUN_ROWS"
              else echo "  WARN: spec_metrics diff failed for $name (see $OUT/spec_metrics.err)" >&2; fi
              rm -f "$OUT/.spec_before_${name}.json" "$OUT/.spec_${name}.jsonl" ;;
        rows) if python3 "$REPO/stack/gpu/spec_metrics.py" rows "$RUN_ROWS" "$SLUG" "$name" "$OUT/props_${name}.json" \
                   > "$OUT/.spec_${name}.jsonl" 2>>"$OUT/spec_metrics.err"; then cat "$OUT/.spec_${name}.jsonl" >> "$RUN_ROWS"
              else echo "  WARN: spec_metrics rows failed for $name (see $OUT/spec_metrics.err)" >&2; fi
              rm -f "$OUT/.spec_${name}.jsonl" ;;
      esac; }
    if [ "${MODE:-probe}" = conversation ]; then
      if python3 "$REPO/bench/core/capture_engine.py" conversation --url "$url" --model "$model" "${PF_ARGS[@]}" \
        --start-tokens "${START_TOKENS:-10000}" --step-tokens "${STEP_TOKENS:-15000}" \
        --max-depth "${MAX_DEPTH:?MODE=conversation needs MAX_DEPTH}" --max-tokens "$MAX_TOKENS" \
        --reps "$REPS" --chat-template-kwargs "${CHAT_KWARGS:-}" ${TURN_PROMPT:+--turn-prompt "$TURN_PROMPT"} \
        "${PASS_ARGS[@]}" --engine "$name" --label "$SLUG" >> "$RUN_ROWS"; then
        if [ "${#MINGEN_ARGS[@]}" -gt 0 ] && ! conv_gate "$name" >> "$RUN_ROWS"; then
          echo "  SHORT: conversation for $name has turn(s) under MIN_GEN=$MIN_GEN tokens (see the min_gen_gate row in $RUN_ROWS)" >&2
          PROBE_FAILED=1; PROBE_SHORT=1; FAILED_ENGINES+=("$name")
        fi
      else echo "  conversation failed for $name"; PROBE_FAILED=1; PROBE_ERR=1; FAILED_ENGINES+=("$name"); fi
      spec_row
      continue
    fi
    rc=0
    python3 "$REPO/bench/core/capture_engine.py" probe --url "$url" --model "$model" "${PF_ARGS[@]}" \
      --max-tokens "$MAX_TOKENS" --concurrency "$CONCURRENCY" --reps "$REPS" \
      --warmup "$WARMUP" --prefix-mode "$PREFIX_MODE" --api "$API" "${MINGEN_ARGS[@]}" "${PASS_ARGS[@]}" \
      --engine "$name" --label "$SLUG" >> "$RUN_ROWS" || rc=$?
    if [ "$rc" -eq 3 ] && [ "${#MINGEN_ARGS[@]}" -gt 0 ]; then
      echo "  SHORT: probe for $name is incomplete (requests under MIN_GEN=$MIN_GEN tokens; n_short in its aggregate row)" >&2
      PROBE_FAILED=1; PROBE_SHORT=1; FAILED_ENGINES+=("$name")
    elif [ "$rc" -ne 0 ]; then echo "  probe failed for $name"; PROBE_FAILED=1; PROBE_ERR=1; FAILED_ENGINES+=("$name"); fi
    spec_row
  fi
done

stop_sampler
# fold the GPU memory summary into the campaign results as a `gpu` row (report + write-up read it)
if [ -f "$OUT/gpu_samples.csv" ] && [ -f "$RUN_ROWS" ]; then
  python3 - "$OUT/gpu_samples.csv" "$SLUG" >> "$RUN_ROWS" <<'PY' || true
import sys, re
csv, slug = sys.argv[1], sys.argv[2]
last = ""
for line in open(csv):
    if line.startswith("#"): last = line
if last:
    g = dict(re.findall(r"(\w+)=([\d.]+)", last))
    import json
    print(json.dumps({"kind": "gpu", "label": slug,
        "vram_used_mib_at_load": int(float(g["load_vram_used_mib"])) if "load_vram_used_mib" in g else None,
        "peak_vram_mib": int(float(g["peak_vram_used_mib"])) if "peak_vram_used_mib" in g else None,
        "peak_gtt_mib": int(float(g["peak_gtt_used_mib"])) if "peak_gtt_used_mib" in g else None,
        "avg_power_w": float(g["avg_power_w"]) if "avg_power_w" in g else None}))
PY
  # per-phase power (prefill vs decode) from the requests' wall-clock phase boundaries
  python3 "$REPO/stack/gpu/phase_power.py" "$OUT" > "$OUT/.power.jsonl" 2>/dev/null \
    && cat "$OUT/.power.jsonl" >> "$RUN_ROWS"; rm -f "$OUT/.power.jsonl"
  python3 -c "import json
for l in open('$RUN_ROWS'):
    d=json.loads(l)
    if d.get('kind')=='power': print(f\"power {d['label']}: prefill avg {d['prefill_w_avg']} W (n={d['prefill_n']}) decode avg {d['decode_w_avg']} W (n={d['decode_n']}) {d.get('flag') or ''}\")" || true
fi

[ -f "$RUN_ROWS" ] && { echo "--- summary (aggregate rows) ---"; \
  python3 -c "import json
for l in open('$RUN_ROWS'):
    d=json.loads(l)
    if d.get('kind')!='aggregate': continue
    print(f\"{d.get('engine'):16} c={d.get('concurrency')} ttft_p50={d.get('ttft_s_p50')}s \"
          f\"prefill_p50={d.get('prefill_tok_s_p50')} dec/stream_p50={d.get('decode_tok_s_per_stream_p50')} \"
          f\"AGG={d.get('aggregate_tok_s')} tok/s err={d.get('n_err')}\")"; }
if [ -n "${STATUS_OUT:-}" ]; then   # one status line for the caller (n_short per cell)
  python3 - "$RUN_ROWS" "$SLUG" "$PROBE_FAILED" "$PROBE_SHORT" "$PROBE_ERR" "${MIN_GEN:-0}" "${FAILED_ENGINES[*]:-}" > "$STATUS_OUT" <<'PY' || true
import json, os, sys
rows_f, slug, failed, short, err, mg, engines = sys.argv[1:8]
n_short = n_total = 0
if os.path.exists(rows_f):
    for line in open(rows_f, encoding="utf-8"):
        try:
            d = json.loads(line)
        except ValueError:
            continue
        if d.get("label") != slug:
            continue
        if d.get("kind") == "aggregate":
            n_short += d.get("n_short") or 0
            n_total += (d.get("n_ok") or 0) + (d.get("n_err") or 0) + (d.get("n_short") or 0)
        elif d.get("kind") == "min_gen_gate":
            n_short += d["n_short"]
            n_total += d["n_turns"]
print(json.dumps({"slug": slug, "ok": failed == "0", "short": short == "1" and err == "0", "n_short": n_short,
                  "n_total": n_total, "min_gen": int(mg or 0), "failed": engines.split()}))
PY
fi
# this run's rows reach the campaign results once, and only when every probe succeeded: a failed probe's
# partial rows stay in the raw run dir, and the rerun of that probe adds its full set (iron rule 18)
if [ "$PROBE_FAILED" = 0 ]; then
  [ -f "$RUN_ROWS" ] && cat "$RUN_ROWS" >> "$ROWS"
  echo "→ rows: $ROWS   (raw run dir: $OUT)"
else
  echo "→ at least one probe FAILED: rows NOT added to $ROWS (kept in $RUN_ROWS)" >&2
  [ "$PROBE_SHORT" = 1 ] && [ "$PROBE_ERR" = 0 ] && exit 3   # only min-gen shorts: incomplete, not broken
  exit 1
fi

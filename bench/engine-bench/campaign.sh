#!/usr/bin/env bash
# campaign.sh — server-level COMBINATION matrix on one model (the "logical combos" campaign).
#
#   backend (rocm, vulkan) × MTP (off, on) × KV (f16, q8_0)
#     Part A: single-stream context-depth curve (8K/32K/64K) + thinking-mode latency
#     Part B: agentic concurrency waves (1/2/4 parallel streams, NP slots, per-stream variants)
#
# The base tuning (UB/B/FA) should come from a model-bench sweep.py result — this campaign
# validates it at the real serving operating point (llama-bench optima don't automatically
# transfer to -np>1 + MTP serving).
#
# Resumable: each matrix point drops a marker in $CAMPAIGN_DIR/done/; rerun with
# CAMPAIGN_DIR=bench/runs/<stamp>-campaign-<slug> to continue after an interruption.
# A failing point (e.g. OOM combo) is recorded and skipped, never fatal.
#
# Env: MODEL SLUG BACKENDS("rocm vulkan") MTPS("0 1") KVS("f16 q8_0")
#      UB(2048) B(8192) FA(on) CTX(65536) NGL(99) PORT(8090)
#      DEPTHS("8000 32000 64000") MAX_TOKENS(256) THINK_MAX_TOKENS(1024)
#      CONC_LIST("1 2 4") CONC_NP(4) REPS(2) CAMPAIGN_DIR(resume)
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
WL="$REPO/bench/workloads/generated"

: "${MODEL:=/home/dev/models/gguf/Qwen3.6-35B-A3B-UD-Q4_K_M.gguf}"
: "${SLUG:=combo35b}"
: "${BACKENDS:=rocm vulkan}"
: "${MTPS:=0 1}"
: "${KVS:=f16 q8_0}"
: "${UB:=2048}"; : "${B:=8192}"; : "${FA:=on}"; : "${CTX:=65536}"; : "${NGL:=99}"
: "${PORT:=8090}"
: "${DEPTHS:=8000 32000 64000}"
: "${MAX_TOKENS:=256}"
: "${THINK_MAX_TOKENS:=1024}"
: "${CONC_LIST:=1 2 4}"
: "${CONC_NP:=4}"
: "${REPS:=2}"

# --- workload fixtures must exist (see docs/RUNBOOK.md §2) ---
MISSING=0
for T in $DEPTHS; do [ -f "$WL/codereview-$T.txt" ] || { echo "missing $WL/codereview-$T.txt"; MISSING=1; }; done
[ -f "$WL/thinking-hard.txt" ] || { echo "missing $WL/thinking-hard.txt"; MISSING=1; }
CONC_FILES=""
for v in 1 2 3 4; do
  [ -f "$WL/agentic-8000-v$v.txt" ] || { echo "missing $WL/agentic-8000-v$v.txt"; MISSING=1; }
  CONC_FILES="$CONC_FILES $WL/agentic-8000-v$v.txt"
done
[ "$MISSING" = 1 ] && { echo "build workloads first (docs/RUNBOOK.md §2)" >&2; exit 1; }

if [ -z "${CAMPAIGN_DIR:-}" ]; then
  STAMP="$(date '+%Y-%m-%d-%H%M')"
  CAMPAIGN_DIR="$REPO/bench/runs/${STAMP}-campaign-${SLUG}"
fi
mkdir -p "$CAMPAIGN_DIR/done" "$CAMPAIGN_DIR/servers"
RESULTS="$CAMPAIGN_DIR/results.jsonl"
{
  echo "date=$(date -Iseconds)"
  echo "model=$MODEL"
  echo "matrix: BACKENDS=$BACKENDS MTPS=$MTPS KVS=$KVS"
  echo "base: UB=$UB B=$B FA=$FA CTX=$CTX NGL=$NGL"
  echo "partA: DEPTHS=$DEPTHS MAX_TOKENS=$MAX_TOKENS THINK_MAX_TOKENS=$THINK_MAX_TOKENS"
  echo "partB: CONC_LIST=$CONC_LIST CONC_NP=$CONC_NP REPS=$REPS"
  bash -c "source '$REPO/bench/lib/gpu_env.sh'; gpu_meta"
} > "$CAMPAIGN_DIR/meta.txt"
echo "campaign → $CAMPAIGN_DIR"

probe() {  # probe <engine-label> <label> <max_tokens> <concurrency> <reps> <prefix_mode> <api> <files...>
  local engine="$1" label="$2" mt="$3" conc="$4" reps="$5" pm="$6" api="$7"; shift 7
  local pf=(); local f; for f in "$@"; do pf+=(--prompt-file "$f"); done
  python3 "$HERE/openai_probe.py" --url "http://localhost:$PORT/v1" --model local \
    "${pf[@]}" --max-tokens "$mt" --concurrency "$conc" --reps "$reps" \
    --prefix-mode "$pm" --api "$api" --engine "$engine" --label "$label" >> "$RESULTS" \
    || echo "  probe FAILED: $engine/$label" | tee -a "$CAMPAIGN_DIR/failures.txt"
}

start_server() {  # start_server <cfg-name> <np>
  local cfg="$1" np="$2"
  BACKEND="$backend" MODEL="$MODEL" CTX="$CTX" NP="$np" UB="$UB" B="$B" FA="$FA" \
    KV="$kv" MTP="$mtp" NGL="$NGL" PORT="$PORT" "$HERE/serve_llamacpp.sh" start \
    > "$CAMPAIGN_DIR/servers/$cfg.start.log" 2>&1
  local rc=$?
  cp "$REPO/bench/.servers/$PORT.cmdline" "$CAMPAIGN_DIR/servers/$cfg.cmdline" 2>/dev/null
  curl -sf -m 5 "http://localhost:$PORT/props" -o "$CAMPAIGN_DIR/servers/$cfg.props.json" 2>/dev/null
  return $rc
}
stop_server() { PORT="$PORT" "$HERE/serve_llamacpp.sh" stop >/dev/null 2>&1; }

for backend in $BACKENDS; do
  for mtp in $MTPS; do
    for kv in $KVS; do
      cfg="${backend}-mtp${mtp}-kv${kv}"

      # ---- Part A: single-stream depth curve + thinking (NP=1) ----
      if [ -f "$CAMPAIGN_DIR/done/A-$cfg" ]; then
        echo "== A-$cfg: already done, skipping =="
      else
        echo "== A-$cfg: starting server (NP=1) =="
        if start_server "A-$cfg" 1; then
          for T in $DEPTHS; do
            echo "   depth $T"
            # unique prefix per request: reps stay COLD-cache (identical prompts would hit the
            # server's prefix cache from rep 2 on and fake the prefill numbers)
            probe "$cfg" "cr$T" "$MAX_TOKENS" 1 "$REPS" unique completions "$WL/codereview-$T.txt"
          done
          echo "   thinking"
          # chat api: bare instruction prompts NEED the chat template (raw completions can EOS
          # immediately) and it gives a MEASURED ttfa_s via delta.reasoning_content
          probe "$cfg" thinking "$THINK_MAX_TOKENS" 1 "$REPS" unique chat "$WL/thinking-hard.txt"
          touch "$CAMPAIGN_DIR/done/A-$cfg"
        else
          echo "A-$cfg: server failed to start (see servers/A-$cfg.start.log)" \
            | tee -a "$CAMPAIGN_DIR/failures.txt"
        fi
        stop_server
      fi

      # ---- Part B: agentic concurrency waves (NP=$CONC_NP, ctx/slot = CTX/NP) ----
      if [ -f "$CAMPAIGN_DIR/done/B-$cfg" ]; then
        echo "== B-$cfg: already done, skipping =="
      else
        echo "== B-$cfg: starting server (NP=$CONC_NP) =="
        if start_server "B-$cfg" "$CONC_NP"; then
          for c in $CONC_LIST; do
            echo "   concurrency $c"
            # per-stream variant files + unique per-request prefix → every wave is cold-cache
            # shellcheck disable=SC2086
            probe "$cfg" "agentic-c$c" "$MAX_TOKENS" "$c" "$REPS" unique completions $CONC_FILES
          done
          touch "$CAMPAIGN_DIR/done/B-$cfg"
        else
          echo "B-$cfg: server failed to start (see servers/B-$cfg.start.log)" \
            | tee -a "$CAMPAIGN_DIR/failures.txt"
        fi
        stop_server
      fi
    done
  done
done

echo; echo "== campaign summary (aggregate rows) =="
[ -f "$RESULTS" ] && python3 -c "
import json
rows=[json.loads(l) for l in open('$RESULTS') if l.strip()]
for d in rows:
    if d.get('kind')!='aggregate': continue
    print(f\"{d.get('engine'):24} {d.get('label'):12} c={d.get('concurrency')} \"
          f\"ttft_p50={d.get('ttft_s_p50')} prefill_p50={d.get('prefill_tok_s_p50')} \"
          f\"dec/stream={d.get('decode_tok_s_per_stream_p50')} AGG={d.get('aggregate_tok_s')} \"
          f\"err={d.get('n_err')}\")"
[ -f "$CAMPAIGN_DIR/failures.txt" ] && { echo '-- failures --'; cat "$CAMPAIGN_DIR/failures.txt"; }
echo "→ $CAMPAIGN_DIR (write it up with /benchmark)"

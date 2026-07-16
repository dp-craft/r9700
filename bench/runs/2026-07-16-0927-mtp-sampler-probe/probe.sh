#!/usr/bin/env bash
# probe.sh — MTP × sampler-tax scouting probe (regenerates results.jsonl + per-cell GPU CSVs).
#
# QUESTION: the 27b-vs-35b campaign measured presence_penalty>0 costing ~35% decode on the 35B and
# published the mechanism "pp re-weights logits after the draft, so drafts get rejected". This probe
# tests that mechanism DIRECTLY, using three instruments the campaign never read:
#   1. llama.cpp `timings.draft_n` / `draft_n_accepted`  -> speculation acceptance rate
#   2. sha1 of the assistant message                     -> did the tokens actually change?
#   3. server CPU-seconds per wall-second + GPU busy%    -> is the host starving the GPU?
#
# THE DECISIVE CELL is pp=0.01: too small to change any token. If it emits a sha1-IDENTICAL reply
# with IDENTICAL draft counts and still loses ~30% decode, the cost cannot be draft rejection —
# it is a fixed per-step cost of the penalties sampler branch being switched on at all.
#
# ⚠ SCOUTING PROBE, NOT A CAMPAIGN. Shallow (ctx 4096, ~24-token prompt), n=1-2 per cell.
#   Decisive on MECHANISM; NOT transferable on MAGNITUDE to the campaign's ~132.9k depth, where
#   MTP's own benefit is known to grow with depth (docs/analysis/2026-07-11-2200-deep-context-35b).
#
#   ./probe.sh            # full matrix -> results.jsonl
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
SERVE="$REPO/bench/engine-bench/serve_llamacpp.sh"
SAMPLER="$REPO/bench/lib/vram_sampler.py"
OUT="$HERE/results.jsonl"
PORT="${PORT:-8099}"
: > "$OUT"

M27=/home/dev/models/gguf/Qwen3.6-27B-MTP-Q4_K_M.gguf
M35=/home/dev/models/gguf/Qwen3.6-35B-A3B-UD-Q4_K_M.gguf
PROMPT="Write a TypeScript function that debounces an async call. Explain briefly."

boot () { # boot(model, mtp, extra_args)
  PORT="$PORT" bash "$SERVE" stop >/dev/null 2>&1 || true
  MODEL="$1" BACKEND=vulkan PORT="$PORT" CTX=4096 KV=f16 MTP="$2" UB=2048 B=4096 FA=on WAIT=420 \
    EXTRA_ARGS="${3:-}" bash "$SERVE" start >/dev/null
}

# ask(label, arch, mtp, n_max, max_tokens, sampler_json_fragment)
# Samples GPU for the duration and charges the server's CPU-time delta to this request.
ask () {
  local label="$1" arch="$2" mtp="$3" nmax="$4" maxtok="$5" frag="$6"
  local pid csv resp cpu0 cpu1 t0 t1
  pid=$(cat "$REPO/bench/.servers/$PORT.pid")
  csv="$HERE/gpu_${label}.csv"
  python3 "$SAMPLER" --out "$csv" --interval 0.5 & local spid=$!
  sleep 1
  # server CPU-seconds (utime+stime, fields 14+15 of /proc/PID/stat) bracketing the request:
  # identical output at a higher CPU/wall ratio == host-side work, not GPU work.
  cpu0=$(awk '{print $14+$15}' "/proc/$pid/stat"); t0=$(date +%s.%N)
  resp=$(curl -sf "http://localhost:$PORT/v1/chat/completions" -H 'Content-Type: application/json' \
    -d "{\"messages\":[{\"role\":\"user\",\"content\":\"$PROMPT\"}],\"max_tokens\":$maxtok,\
\"temperature\":0.6,\"top_p\":0.95,\"top_k\":20,\"seed\":42,\"stream\":false,$frag}")
  cpu1=$(awk '{print $14+$15}' "/proc/$pid/stat"); t1=$(date +%s.%N)
  kill -TERM "$spid" 2>/dev/null || true; wait "$spid" 2>/dev/null || true
  printf '%s' "$resp" | python3 "$HERE/row.py" "$label" "$arch" "$mtp" "$nmax" "$frag" "$csv" \
      "$cpu0" "$cpu1" "$t0" "$t1" >> "$OUT"
}

# --- A. 27B dense, MTP on: pp ladder (control arch — is the tax MoE-specific?) ---
boot "$M27" 1
for pp in 0.0 1.5; do ask "27b-mtp1-pp$pp" 27b-dense 1 3 300 "\"presence_penalty\":$pp"; done

# --- B. 35B MoE, MTP on: pp ladder (the arch where the campaign saw the anomaly) ---
boot "$M35" 1
for pp in 0.0 0.5 1.0 1.5 2.0; do ask "35b-mtp1-pp$pp" 35b-moe 1 3 600 "\"presence_penalty\":$pp"; done

# --- C. THE DECISIVE CELLS: penalty MAGNITUDE, or the penalties-sampler BRANCH? ---
#     pp=0.01 cannot change a token. min_p is the control: a NON-penalty sampler, also inert here.
ask "35b-mtp1-nopenalty-repA" 35b-moe 1 3 600 '"presence_penalty":0.0'
ask "35b-mtp1-pp0.01-repA"    35b-moe 1 3 600 '"presence_penalty":0.01'
ask "35b-mtp1-nopenalty-repB" 35b-moe 1 3 600 '"presence_penalty":0.0'
ask "35b-mtp1-pp0.01-repB"    35b-moe 1 3 600 '"presence_penalty":0.01'
ask "35b-mtp1-fp0.01"         35b-moe 1 3 600 '"frequency_penalty":0.01'
ask "35b-mtp1-rp1.01"         35b-moe 1 3 600 '"repeat_penalty":1.01'
ask "35b-mtp1-minp0.05"       35b-moe 1 3 600 '"min_p":0.05'

# --- D. non-penalty sampler width: is top_k/top_p the unsloth-reason culprit? ---
ask "35b-mtp1-tk40"       35b-moe 1 3 600 '"presence_penalty":0.0,"top_k":40'
ask "35b-mtp1-tp1.0"      35b-moe 1 3 600 '"presence_penalty":0.0,"top_p":1.0'
ask "35b-mtp1-tk40-tp1.0" 35b-moe 1 3 600 '"presence_penalty":0.0,"top_k":40,"top_p":1.0'

# --- E. MTP OFF control: does the penalty tax survive without speculation? ---
boot "$M35" 0
for pp in 0.0 0.01 1.5; do ask "35b-mtp0-pp$pp" 35b-moe 0 0 600 "\"presence_penalty\":$pp"; done

# --- F. --spec-draft-n-max sweep (the headline MTP knob; never measured on this box) ---
for nmax in 1 2 3 4 6 8; do
  boot "$M35" 1 "--spec-draft-n-max $nmax"
  ask "35b-mtp1-nmax$nmax" 35b-moe 1 "$nmax" 600 '"presence_penalty":0.0'
done

PORT="$PORT" bash "$SERVE" stop >/dev/null 2>&1 || true
echo "wrote $OUT ($(wc -l < "$OUT") rows)"

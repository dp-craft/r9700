#!/usr/bin/env bash
# probe2.sh — EXTENSION: p_min IS live on MTP (probe.sh refuted "inert"). Now the real question:
# does p_min narrow the OUTPUT DISTRIBUTION (= reduce fluctuation), or only reshuffle which output a
# seed lands on (RNG realignment, distribution preserved → fluctuation unchanged)?
#
# TEST: multi-seed diversity. For each config, run the SAME prompt at seeds {42..47} and count how many
# DISTINCT replies result. Fluctuation is the spread of the output distribution; if p_min narrows it,
# high-p_min cells produce FEWER distinct replies / collapse toward a mode. If speculative acceptance is
# distribution-exact, draft depth cannot change the distribution → distinct-count ~equal across p_min.
#
# NOTE the direction: higher p_min => LESS drafting (k/pass 2.98->0.46 measured) => MORE reliance on pure
# target sampling, not more greedy. So the naive "high p_min = more deterministic" intuition is suspect.
#
#   35B MoE, MTP: BASE(p_min 0) / PMIN0.9 / PMIN0.99   x seeds 42..47
#   27B dense, MTP: BASE / PMIN0.9                      x seeds 42..47   (user: do 27B since p_min IS significant)
#   MINP0.1 (35B, per-request) x seeds 42..47           = positive control: a real distribution knob
#
# ⚠ Shallow (ctx 4096, ~24-tok prompt). Diversity here is a DISTRIBUTION proxy, not the campaign's
#   quality rep-sd at 133k. A null here bounds the mechanism; a hit would justify a scored depth run.
#   ./probe2.sh -> results2.jsonl
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
SERVE="$REPO/bench/engine-bench/serve_llamacpp.sh"
SAMPLER="$REPO/bench/lib/vram_sampler.py"
ROW="$REPO/bench/runs/2026-07-16-0927-mtp-sampler-probe/row.py"
OUT="$HERE/results2.jsonl"
PORT="${PORT:-8099}"
: > "$OUT"

M35=/home/dev/models/gguf/Qwen3.6-35B-A3B-UD-Q4_K_M.gguf
M27=/home/dev/models/gguf/Qwen3.6-27B-MTP-Q4_K_M.gguf
PROMPT="Write a TypeScript function that debounces an async call. Explain briefly."
SEEDS="42 43 44 45 46 47"

boot () { # boot(model, mtp, extra_args)
  PORT="$PORT" bash "$SERVE" stop >/dev/null 2>&1 || true
  MODEL="$1" BACKEND=vulkan PORT="$PORT" CTX=4096 KV=f16 MTP="$2" UB=2048 B=4096 FA=on WAIT=420 \
    EXTRA_ARGS="${3:-}" bash "$SERVE" start >/dev/null
}

# ask_seed(label, arch, mtp, n_max, max_tokens, seed, sampler_json_fragment)
ask_seed () {
  local label="$1" arch="$2" mtp="$3" nmax="$4" maxtok="$5" seed="$6" frag="$7"
  local pid csv resp cpu0 cpu1 t0 t1
  pid=$(cat "$REPO/bench/.servers/$PORT.pid")
  csv="$HERE/gpu_${label}.csv"
  python3 "$SAMPLER" --out "$csv" --interval 0.5 & local spid=$!
  sleep 1
  cpu0=$(awk '{print $14+$15}' "/proc/$pid/stat"); t0=$(date +%s.%N)
  resp=$(curl -sf "http://localhost:$PORT/v1/chat/completions" -H 'Content-Type: application/json' \
    -d "{\"messages\":[{\"role\":\"user\",\"content\":\"$PROMPT\"}],\"max_tokens\":$maxtok,\
\"temperature\":0.6,\"top_p\":0.95,\"top_k\":20,\"seed\":$seed,\"stream\":false,$frag}")
  cpu1=$(awk '{print $14+$15}' "/proc/$pid/stat"); t1=$(date +%s.%N)
  kill -TERM "$spid" 2>/dev/null || true; wait "$spid" 2>/dev/null || true
  printf '%s' "$resp" | python3 "$ROW" "$label" "$arch" "$mtp" "$nmax" "$frag" "$csv" \
      "$cpu0" "$cpu1" "$t0" "$t1" >> "$OUT"
}

run_block () { # run_block(model, arch, extra_args, label_prefix, frag)
  boot "$1" 1 "$3"
  for s in $SEEDS; do ask_seed "$4-s$s" "$2" 1 3 600 "$s" "$5"; done
}

# 35B MoE
run_block "$M35" 35b-moe ""                        "35b-base"    '"presence_penalty":0.0'
run_block "$M35" 35b-moe "--spec-draft-p-min 0.9"  "35b-pmin0.9" '"presence_penalty":0.0'
run_block "$M35" 35b-moe "--spec-draft-p-min 0.99" "35b-pmin0.99" '"presence_penalty":0.0'
run_block "$M35" 35b-moe ""                        "35b-minp0.1" '"presence_penalty":0.0,"min_p":0.1'

# 27B dense (user: extend to 27B because p_min IS a significant difference)
run_block "$M27" 27b-dense ""                       "27b-base"    '"presence_penalty":0.0'
run_block "$M27" 27b-dense "--spec-draft-p-min 0.9" "27b-pmin0.9" '"presence_penalty":0.0'

PORT="$PORT" bash "$SERVE" stop >/dev/null 2>&1 || true
echo "wrote $OUT ($(wc -l < "$OUT") rows)"

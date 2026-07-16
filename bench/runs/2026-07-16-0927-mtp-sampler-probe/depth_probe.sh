#!/usr/bin/env bash
# depth_probe.sh — the ~132.9k-token confirm of the sampler-tax mechanism (Tier A+B).
#
# Answers the ONE number the shallow probe left open: at the campaign's real depth, is the
# presence_penalty tax ~2 ms/tok (shallow probe) or ~4.16 ms/tok (campaign's t10-vs-qwen-gen
# implication)? And does the pp=0.01 byte-identity hold at 133k? Plus Tier B: does MTP's optimal
# --spec-draft-n-max shift at depth, where MTP's benefit is known to grow?
#
# WHY THIS IS CHEAP (~40 min for a 133k run): the tax is a DECODE-SPEED effect, so it needs no
# grader, no judge, no task grid — one prompt. And llama.cpp's prefix cache is keyed on prompt
# tokens, not sampler params (campaign: 181/210 requests hit cache at ~2s), so each server load
# pays the ~7-min cold prefill ONCE, then the whole pp sweep rides on top as ~seconds-each cached
# requests. Only MTP on/off and --spec-draft-n-max (launch params) force a reload.
#
# Matches the campaign operating point: 35B-A3B, ctx 163840, KV f16, --reasoning-budget 16384,
# temp 1.0 (so pp0-vs-pp1.5 reproduces the campaign's t10-vs-qwen-gen contrast). seed 42+rep, and
# pp0 vs pp0.01 are compared AT THE SAME rep/seed so the byte-identity check is exact.
#
#   ./depth_probe.sh          # -> results_depth.jsonl  (+ gpu_depth_*.csv)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
SERVE="$REPO/bench/engine-bench/serve_llamacpp.sh"
SAMPLER="$REPO/bench/lib/vram_sampler.py"
CAMP="$REPO/campaigns/2026-07-14-hardest-tasks-27b-vs-35b"
OUT="$HERE/results_depth.jsonl"
PORT="${PORT:-8099}"
: > "$OUT"

M35=/home/dev/models/gguf/Qwen3.6-35B-A3B-UD-Q4_K_M.gguf
CTX=163840
BUDGET=16384
TEMP=1.0
MEAS_TOK=800          # decode length per measured request — enough for a stable decode t/s at depth
PROMPT_JSON="$HERE/.depth_payload_base.json"   # {prompt:...} extracted once, reused per request

# Extract the campaign's 133k 'lru-cache' prompt once (522k chars — too big for an inline -d).
python3 - "$CAMP/out/tasks-120k.jsonl" "$PROMPT_JSON" <<'PY'
import json, sys
src, dst = sys.argv[1], sys.argv[2]
row = next(r for r in (json.loads(l) for l in open(src)) if r.get("id") == "lru-cache")
json.dump({"prompt": row["prompt"]}, open(dst, "w"))
print(f"prompt: {len(row['prompt'])} chars (~{len(row['prompt'])//4}k tok)")
PY

boot () { # boot(mtp, nmax_or_empty)
  PORT="$PORT" bash "$SERVE" stop >/dev/null 2>&1 || true
  local extra="--reasoning-budget $BUDGET"
  [ -n "${2:-}" ] && extra="$extra --spec-draft-n-max $2"
  MODEL="$M35" BACKEND=vulkan PORT="$PORT" CTX="$CTX" KV=f16 MTP="$1" UB=2048 B=4096 FA=on WAIT=600 \
    EXTRA_ARGS="$extra" bash "$SERVE" start >/dev/null
}

# ask(label, mtp, nmax, pp, seed, max_tokens) — one measured request, sampled + CPU-bracketed.
ask () {
  local label="$1" mtp="$2" nmax="$3" pp="$4" seed="$5" maxtok="$6"
  local pid csv resp cpu0 cpu1 t0 t1 payload
  pid=$(cat "$REPO/bench/.servers/$PORT.pid")
  csv="$HERE/gpu_depth_${label}.csv"
  payload="$HERE/.depth_req.json"
  # build the full request payload (prompt + this cell's sampler) from the extracted base
  python3 - "$PROMPT_JSON" "$payload" "$TEMP" "$pp" "$seed" "$maxtok" <<'PY'
import json, sys
base, dst, temp, pp, seed, maxtok = sys.argv[1:7]
p = json.load(open(base))["prompt"]
req = {"messages": [{"role": "user", "content": p}], "max_tokens": int(maxtok),
       "temperature": float(temp), "top_p": 0.95, "top_k": 20, "seed": int(seed),
       "presence_penalty": float(pp), "stream": False}
json.dump(req, open(dst, "w"))
PY
  python3 "$SAMPLER" --out "$csv" --interval 0.5 & local spid=$!
  sleep 1
  cpu0=$(awk '{print $14+$15}' "/proc/$pid/stat"); t0=$(date +%s.%N)
  resp=$(curl -sf --max-time 900 "http://localhost:$PORT/v1/chat/completions" \
    -H 'Content-Type: application/json' -d @"$payload")
  cpu1=$(awk '{print $14+$15}' "/proc/$pid/stat"); t1=$(date +%s.%N)
  kill -TERM "$spid" 2>/dev/null || true; wait "$spid" 2>/dev/null || true
  # row.py's `sampler` arg is a JSON fragment; record temp+pp so the depth rows are self-describing.
  printf '%s' "$resp" | python3 "$HERE/row.py" "$label" 35b-moe "$mtp" "$nmax" \
      "\"presence_penalty\":$pp,\"temperature\":$TEMP" "$csv" "$cpu0" "$cpu1" "$t0" "$t1" >> "$OUT"
}

# config(mtp, nmax) — one server load: prime the 133k cache once, then sweep pp x reps for free.
config () {
  local mtp="$1" nmax="${2:-}" tag="mtp${1}${2:+-nmax$2}"
  echo "=== $tag : loading (pays the ~7-min cold 133k prefill once) ==="
  boot "$mtp" "$nmax"
  echo "=== $tag : priming prefix cache ==="
  ask "${tag}-prime" "$mtp" "${nmax:-0}" 0.0 42 32   # cold prefill happens here; result discarded in analysis
  for rep in 1 2; do
    for pp in 0.0 0.01 1.5; do
      echo "=== $tag : pp=$pp rep=$rep (cached prefill) ==="
      ask "${tag}-pp${pp}-r${rep}" "$mtp" "${nmax:-0}" "$pp" "$((42+rep))" "$MEAS_TOK"
    done
  done
}

# Tier A+B: MTP-off, and MTP-on at n-max {2,3,4}.
config 0            # MTP off (n-max N/A)
config 1 2          # MTP on, draft width 2
config 1 3          # MTP on, draft width 3 (llama.cpp default)
config 1 4          # MTP on, draft width 4

PORT="$PORT" bash "$SERVE" stop >/dev/null 2>&1 || true
rm -f "$HERE/.depth_req.json" "$PROMPT_JSON"
echo "wrote $OUT ($(wc -l < "$OUT") rows)"

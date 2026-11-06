#!/usr/bin/env bash
# probe.sh — does --spec-draft-p-min do ANYTHING on the MTP path? (user hypothesis: it lowers 35B fluctuation)
#
# CHALLENGE UNDER TEST: research (docs/research/2026-07-16-1016-spec-draft-p-min-mtp.md) says p_min is
# NOT consulted on --spec-type draft-mtp (PR #22673 TODO; MTP drafts greedy top_k=1, stops on n_max).
# And speculative decoding is distribution-EXACT (sampling.cpp accepts a draft token only if it equals
# the token the target sampler would emit), so a draft-length knob cannot change the OUTPUT distribution
# — hence cannot change fluctuation (the variance of that distribution) even if it were wired.
#
# THE ELEGANT PROOF: 35B MTP at seed 42 is deterministic across launches (verified in the 0927 probe:
# nopenalty repA/repB were sha1-identical). So if p_min at a FIXED seed yields a byte-IDENTICAL reply
# (same sha1) as baseline, it yields identical output at EVERY seed → the whole distribution is
# unchanged → rep sd is provably identical. One seed settles a fluctuation question. No multi-seed needed.
#
# THE KILLER CELL is p_min 0.99: if p_min were LIVE, 0.99 would kill almost all drafting
# (draft_k_per_pass -> ~0, decode collapses toward the MTP-off ~70 t/s). If 0.99 leaves draft counts and
# decode IDENTICAL to baseline, it is conclusively ignored.
#
# ⚠ SCOUTING PROBE. Shallow (ctx 4096, ~24-tok prompt), n=1/cell. Decisive on APPLICABILITY (sha1
# identity cannot be manufactured by noise); not a magnitude claim. The applicability result is
# depth-independent (the MTP code ignores p_min at any ctx), so ctx 4096 suffices.
#
#   ./probe.sh            # -> results.jsonl
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
SERVE="$REPO/bench/engine-bench/serve_llamacpp.sh"
SAMPLER="$REPO/bench/lib/vram_sampler.py"
ROW="$REPO/bench/runs/2026-07-16-0927-mtp-sampler-probe/row.py"   # reuse the 0927 row emitter verbatim
OUT="$HERE/results.jsonl"
PORT="${PORT:-8099}"
: > "$OUT"

M35=/home/dev/models/gguf/Qwen3.6-35B-A3B-UD-Q4_K_M.gguf
PROMPT="Write a TypeScript function that debounces an async call. Explain briefly."

boot () { # boot(model, mtp, extra_args)
  PORT="$PORT" bash "$SERVE" stop >/dev/null 2>&1 || true
  MODEL="$1" BACKEND=vulkan PORT="$PORT" CTX=4096 KV=f16 MTP="$2" UB=2048 B=4096 FA=on WAIT=420 \
    EXTRA_ARGS="${3:-}" bash "$SERVE" start >/dev/null
}

# ask(label, arch, mtp, n_max, max_tokens, sampler_json_fragment)  — identical contract to the 0927 probe
ask () {
  local label="$1" arch="$2" mtp="$3" nmax="$4" maxtok="$5" frag="$6"
  local pid csv resp cpu0 cpu1 t0 t1
  pid=$(cat "$REPO/bench/.servers/$PORT.pid")
  csv="$HERE/gpu_${label}.csv"
  python3 "$SAMPLER" --out "$csv" --interval 0.5 & local spid=$!
  sleep 1
  cpu0=$(awk '{print $14+$15}' "/proc/$pid/stat"); t0=$(date +%s.%N)
  resp=$(curl -sf "http://localhost:$PORT/v1/chat/completions" -H 'Content-Type: application/json' \
    -d "{\"messages\":[{\"role\":\"user\",\"content\":\"$PROMPT\"}],\"max_tokens\":$maxtok,\
\"temperature\":0.6,\"top_p\":0.95,\"top_k\":20,\"seed\":42,\"stream\":false,$frag}")
  cpu1=$(awk '{print $14+$15}' "/proc/$pid/stat"); t1=$(date +%s.%N)
  kill -TERM "$spid" 2>/dev/null || true; wait "$spid" 2>/dev/null || true
  printf '%s' "$resp" | python3 "$ROW" "$label" "$arch" "$mtp" "$nmax" "$frag" "$csv" \
      "$cpu0" "$cpu1" "$t0" "$t1" >> "$OUT"
}

# 35B MoE, MTP on, n_max=3 (default), seed 42. Sweep the SERVER-LAUNCH flag --spec-draft-p-min.
# baseline twice = launch-determinism check (must be sha1-identical to trust sha1 as the instrument).
boot "$M35" 1 ""                        ; ask "pmin-baseline-repA" 35b-moe 1 3 600 '"presence_penalty":0.0'
boot "$M35" 1 ""                        ; ask "pmin-baseline-repB" 35b-moe 1 3 600 '"presence_penalty":0.0'
boot "$M35" 1 "--spec-draft-p-min 0.5"  ; ask "pmin-0.5"  35b-moe 1 3 600 '"presence_penalty":0.0'
boot "$M35" 1 "--spec-draft-p-min 0.75" ; ask "pmin-0.75" 35b-moe 1 3 600 '"presence_penalty":0.0'
boot "$M35" 1 "--spec-draft-p-min 0.9"  ; ask "pmin-0.9"  35b-moe 1 3 600 '"presence_penalty":0.0'
boot "$M35" 1 "--spec-draft-p-min 0.99" ; ask "pmin-0.99" 35b-moe 1 3 600 '"presence_penalty":0.0'

PORT="$PORT" bash "$SERVE" stop >/dev/null 2>&1 || true
echo "wrote $OUT ($(wc -l < "$OUT") rows)"

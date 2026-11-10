#!/usr/bin/env bash
# Short validation run for campaigns/perf/2026-11-09-1825-27b-arms-kld (2026-11-10, user split
# of round 1: NO 3-4 h unattended pass first — validate that every measurement path works and
# get the first redhat-vs-iq4 look, then decide on the full grid after analysis).
#
#   arms:  D = RedHat-MXFP4 @ sly 1.11.0   (WS7 cold+warm prologue included — first 1.11.0
#                                          boot IS the WS7 cold measurement)
#          C = IQ4R-L-V4  @ radiance 1.17.0  (the redhat-vs-iq4 comparison pair)
#   cells: 10k/100k x tg512 x n1 — 2 per arm, REPS=2 (n=2; if spread/suspicion -> re-run,
#          the new unique dir doubles the data instead of overwriting)
#   KLD:   selftest + fetch with KLD_N=16 prompts (short; the full 128 stays for the
#          canonical run — decide after analysis) + score
#
# Unique output dir per invocation (user rule 2026-11-10): tmp/runs/<RUN_TAG>/
#   default RUN_TAG = short-<YYYYmmdd-HHMMSS>; every re-run gets a NEW dir (results + raw +
#   done markers), so runs never overwrite each other. Pin RUN_TAG=<same> to RESUME an
#   interrupted short run instead.
#
# All in project gitignored tmp/ — never machine /tmp (repo rule: reboot wipes /tmp).
#
# Knobs (env, all optional): RUN_TAG  REPS (default 2)  KLD_N (default 16)
#   + every run.sh pin/knob (IMAGE, IMG_RAD_BC, RAD_IQRV4, VRAM_BUDGET_MIB, ONLY, ...)
# Requires: plain terminal, port 8000 free (no local-model session), GPU idle.
# Time estimate INFERRED ~1 h: 4 boots (sly cold ~8 min [WS7 1.9.1 analog 475 s], sly warm
#   ~5 min, radiance ~2 min, KLD ref warm-first ~5 min) + 8 probes + 3 KLD fetches x 16 x 512.
set -uo pipefail
HERE="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
RUN_TAG="${RUN_TAG:-short-$(date +%Y%m%d-%H%M%S)}"
export RUN_TAG
export ONLY="${ONLY:-c-10k-tg512-n1,c-100k-tg512-n1,d-10k-tg512-n1,d-100k-tg512-n1}"
export REPS="${REPS:-2}"
export KLD_N="${KLD_N:-16}"
WS_NO_MAIN=1
# shellcheck source=run.sh
source "$HERE/run.sh"   # definitions + preflight (RUN_TAG-aware dirs are set there)

ensure_fixtures 'codereview-10000.txt' 'codereview-100000.txt'
echo "=== short run: arms c+d, cells [10k,100k]x tg512 x n1, REPS=$REPS, KLD_N=$KLD_N"
echo "    unique dir: $RUN_DIR  (results: $RES/results.jsonl)"
ws7_prologue
arm_d
ws7_warm
arm_rad c "$IMG_RAD_BC" "$RAD_IQRV4" qwen38-27b-iq4r-l-v4
kld_ref_ensure || true
kld_score_all
print_summary
make_report
echo "short run done. results: $RES/results.jsonl  (dir: $RUN_DIR  raw: $RAW/)"
echo "re-run for more reps (unique new dir, doubles data): $0   |   resume this one: RUN_TAG=$RUN_TAG $0"
[ -f "$RES/skipped.txt" ] && { echo "--- guard-skipped (over budget) ---"; cat "$RES/skipped.txt"; } || true

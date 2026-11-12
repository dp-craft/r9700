#!/usr/bin/env bash
# Standalone single-arm runner for campaigns/perf/2026-11-09-1825-27b-arms-kld.
#
# Runs ONE arm with run.sh's full machinery (preflight, resume markers, VRAM guard,
# Memory-Fault watcher, KLD selftest/fetch/score) — so you can manually exercise any
# model / vLLM version without running the whole campaign:
#
#   ./run-arm.sh a                              # arm A as pinned (radiance 1.11.0 + MXFP4)
#   ./run-arm.sh b                              # arm B (radiance 1.17.0 + MXFP4)
#   ./run-arm.sh c                              # arm C (radiance 1.17.0 + IQ4R-L-V4)
#   ./run-arm.sh c0                             # arm C spec-OFF (same boot, --num-speculative-tokens 0)
#   ./run-arm.sh d                              # arm D (sly 1.11.0) — WS7 prologue included
#   ./run-arm.sh e                              # arm E: heretic KLD only (sly 1.8.1)
#
# Any model/version combo, via env overrides (pins in run.sh item 2):
#   ROUND=2 ./run-arm.sh b                                            # round-2 cells
#   IMAGE=ghcr.io/slybase/vllm-sly-radiance:1.10.0-rocm10.1 ./run-arm.sh d
#   IMG_RAD_BC=stilldeadcode/radiance:1.16.0 ./run-arm.sh b
#   RAD_IQRV4=/mnt/Lin1/work/radiance/models/<other-model@rev>/<f>.rad ./run-arm.sh c
#   (rad arm: the SERVED name follows the .rad's model; for a renamed serve also pass the
#    profile's SERVED_NAME via the serve stack — see stack/serve/radiance/serve_radiance.sh)
#   KLD_REF_IMAGE=ghcr.io/slybase/vllm-sly-radiance:1.10.0-rocm10.1 ./run-arm.sh d
#
# Other run.sh knobs also apply: ONLY='d-100k-*' REPS=2 MAX_TOKENS=256 VRAM_BUDGET_MIB=...
#
# Recoverable: same tmp/done markers as run.sh — kill it mid-arm and re-run to resume
# at the first unfinished cell (a fault-killed probe leaves no marker and is redone).
# Requires: plain terminal, port 8000 free (no local-model session), GPU idle.
set -uo pipefail
HERE="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
WS_NO_MAIN=1
# shellcheck source=run.sh
source "$HERE/run.sh"

[ $# -eq 1 ] || { echo "usage: run-arm.sh <a|b|c|c0|d|e>   (knobs as env: ROUND=2 IMAGE=... ONLY=...)" >&2; exit 1; }
ARM=$1
case "$ARM" in
  a|b|c|c0)
    ensure_fixtures 'codereview-10000.txt' 'codereview-100000.txt'
    [ "$ROUND" -ge 2 ] && ensure_fixtures 'codereview-50000.txt'
    case "$ARM" in
      a) arm_rad a "$IMG_RAD_A"  "$RAD_MXFP4" qwen38-27b-mxfp4 ;;
      b) arm_rad b "$IMG_RAD_BC" "$RAD_MXFP4" qwen38-27b-mxfp4 ;;
      c) arm_rad c "$IMG_RAD_BC" "$RAD_IQRV4" qwen38-27b-iq4r-l-v4 ;;
      c0) arm_rad c0 "$IMG_RAD_BC" "$RAD_IQRV4" qwen38-27b-iq4r-l-v4 0 ;;   # spec-off (item A, 2026-11-11)
    esac
    kld_ref_ensure || true
    kld_score_all
    ;;
  d)
    ensure_fixtures 'codereview-10000.txt' 'codereview-100000.txt'
    [ "$ROUND" -ge 2 ] && ensure_fixtures 'codereview-50000.txt'
    ws7_prologue
    arm_d
    ws7_warm
    kld_ref_ensure || true
    kld_score_all
    ;;
  e)
    echo "=== run-arm.sh e: KLD-only pass for arm E (grid skipped) ==="
    kld_ref_ensure || true
    if start_server e-heretic-sly181 8192 fp8 0 1; then
      kld_selftest sly swift-1.5
      if [ -f "$RAW/done/kld-selftest-sly" ]; then
        kld_fetch swift-1.5 "$RES/kld-e.jsonl" "$IMG_SLY_E"
      else
        echo "  KLD fetch skipped for arm E (selftest failed)"
      fi
      stop_server
    fi
    kld_score_all e
    ;;
  *) echo "unknown arm: $ARM (only: a b c c0 d e)" >&2; exit 1 ;;
esac
print_summary
make_report
echo "standalone arm $ARM done. consolidated results: $RES/results.jsonl  (raw: $RAW/)"
[ -f "$RES/skipped.txt" ] && { echo "--- guard-skipped (over budget) ---"; cat "$RES/skipped.txt"; } || true

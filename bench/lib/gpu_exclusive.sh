#!/usr/bin/env bash
# gpu_exclusive.sh — make the GPU exclusive, then PROVE it, before any engine boots.
#
# Why this exists (CLAUDE.md rules 14 & 15): an engine left resident by someone else
# does not announce itself. llama.cpp turns contention into a load failure you cannot
# miss, but hipfire's VMM kv_backend has no allocation to fail — it pages, and reports
# slowdown only. On 2026-09-10 a hipfire daemon ran holding 4.4 GB against a ~19.4 GB
# working set while llama-swap still had ~27 GB resident; nothing appeared in serve.log
# or dmesg and the entire concurrency sweep had to be discarded.
#
# Usage:  bench/lib/gpu_exclusive.sh [required_free_mib]
# Exits non-zero (and names the holder) when the card cannot be freed.
set -u
REQUIRED_FREE_MIB="${1:-26000}"
SWAP_PORT="${SWAP_PORT:-9292}"

free_mib() { amd-smi metric -g 0 -m 2>/dev/null | grep -oP 'FREE_VRAM:\s*\K[0-9]+' | head -1; }
used_mib() { amd-smi metric -g 0 -m 2>/dev/null | grep -oP 'USED_VRAM:\s*\K[0-9]+' | head -1; }

# 1. llama-swap owns its llama-server child: there is no pidfile of ours to kill, and the
#    idle timeout may be long or 0. /unload is GET — POST returns 405, and `curl -sf`
#    swallows it silently, which is exactly how a "cleanup" can succeed and free nothing.
if curl -s -o /dev/null -m 5 "http://127.0.0.1:${SWAP_PORT}/health" 2>/dev/null; then
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 30 "http://127.0.0.1:${SWAP_PORT}/unload" 2>/dev/null)
  echo "llama-swap /unload -> HTTP ${CODE}$([ "$CODE" = 200 ] || echo '  <-- NOT 200, model may still be resident')"
fi

# 2. hipfire is a SPLIT PROCESS SHAPE. Killing only bin/daemon leaves `hipfire serve`
#    holding the port and answering /health with a stale model, so every request 500s.
#    Patterns are split so pkill -f cannot match this script's own command line.
pkill -f 'hipfire be''nch'                2>/dev/null
pkill -9 -f 'hipfire/bin/dae''mon'        2>/dev/null
pkill -9 -f 'hipfire/bin/hipfire se''rve' 2>/dev/null
rm -f "$HOME/.hipfire/serve.pid"

# 3. Settle, then assert the POSITIVE precondition. A post-kill check only catches what
#    you started; the free-VRAM floor also catches what someone else left behind.
W=0
while [ "$W" -lt 60 ]; do
  [ "$(free_mib)" -ge "$REQUIRED_FREE_MIB" ] 2>/dev/null && break
  sleep 3; W=$((W + 3))
done

F=$(free_mib)
if [ "${F:-0}" -lt "$REQUIRED_FREE_MIB" ]; then
  echo "ABORT: need >=${REQUIRED_FREE_MIB} MiB free, have ${F} MiB (used $(used_mib) MiB)."
  echo "Holder(s):"
  amd-smi process -g 0 2>/dev/null | grep -E 'NAME|PID|MEM_USAGE' | head -20
  exit 1
fi
echo "GPU exclusive: ${F} MiB free (used $(used_mib) MiB), floor ${REQUIRED_FREE_MIB} MiB."

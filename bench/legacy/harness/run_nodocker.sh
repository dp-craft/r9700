#!/usr/bin/env bash
set -u
HARNESS="$(cd "$(dirname "$0")" && pwd)"
source "$HARNESS/config.sh"; source "$HARNESS/lib.sh"
export RESULTS="$HARNESS/results_${STAMP}.jsonl"
# env meta
aspm=$(cat /sys/module/pcie_aspm/parameters/policy 2>/dev/null | tr -d '\n')
ver=$("$LC/llama-server" --version 2>&1 | head -1 | tr -d '\n')
python3 -c "import json;open('$RESULTS','a').write(json.dumps({'_meta':True,'pcie_aspm':'$aspm','llamacpp':'$ver','ctx':$CTX,'n_decode':$N_DECODE,'gpu':'R9700 gfx1201','note':'post disk-rebuild; llama.cpp b1295; ASPM=performance'})+chr(10))"
bash "$HARNESS/run_llamacpp.sh"
bash "$HARNESS/run_ollama.sh"
echo "=== NODOCKER PHASES DONE: $RESULTS ==="

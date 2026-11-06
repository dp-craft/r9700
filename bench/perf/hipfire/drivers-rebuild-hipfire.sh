#!/usr/bin/env bash
# Rebuild hipfire at the SAME commit against ROCm 10.0, so the only changed variable is ROCm.
# PATH order matters: /home/dev/scripts/cc is a claude launcher that shadows the C compiler.
set -uo pipefail
export PATH="/usr/bin:$HOME/.cargo/bin:$HOME/.hipfire/bin:$PATH"
export CC=/usr/bin/cc CXX=/usr/bin/c++
echo "cc resolves to: $(command -v cc) -> $(readlink -f "$(command -v cc)")"
echo "rocm-root: /opt/rocm/core-10.0"
echo "commit:    800ddf7403d85e3745d0ac6492e4cb84c74cb7b1 (unchanged from the 7.13 build)"
echo "=== starting $(date -Is) ==="
bash "$HOME/.hipfire/src/scripts/install.sh" \
  --commit 800ddf7403d85e3745d0ac6492e4cb84c74cb7b1 \
  --rocm-root /opt/rocm/core-10.0 \
  --gpu-arch gfx1201 \
  --strict-rocm \
  --yes
echo "=== install.sh exit=$? (DO NOT TRUST IT - gate on hipfire --version) $(date -Is) ==="
"$HOME/.hipfire/bin/hipfire" --version 2>&1 | head -3
echo "=== install.json ==="; cat "$HOME/.hipfire/install.json" 2>/dev/null
echo "REBUILD SCRIPT DONE"

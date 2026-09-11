#!/usr/bin/env bash
# ROCm 7.13 -> 10.0 on the Radeon (rocmradeon) line. Run with sudo.
#   sudo bash docs/test/rocm-upgrade/install-rocm-10.sh
# Does NOT purge 7.13 -- that is a separate, gated script. Read the log doc first.
set -euo pipefail
LIST=/etc/apt/sources.list.d/rocm.list
STAMP=$(date +%Y%m%d-%H%M%S)

[ "$(id -u)" -eq 0 ] || { echo "must run as root"; exit 1; }

if grep -q 'rocmradeon/apt/26\.14' "$LIST"; then
  echo "== 1-2. repo already on 26.14, skipping (resumable re-run)"
else
  echo "== 1. backing up $LIST -> $LIST.bak-$STAMP"
  cp -a "$LIST" "$LIST.bak-$STAMP"
  echo "== 2. repointing 26.12 -> 26.14"
  sed -i 's|rocmradeon/apt/26\.12|rocmradeon/apt/26.14|' "$LIST"
fi
grep -H rocmradeon "$LIST" || true

echo "== 3. apt update"
apt-get update -qq

echo "== 4. candidate check (must show 10.0.0~pre4)"
# NOTE: no pipes here on purpose. Under `set -o pipefail`, `apt-cache ... | head`/`| grep -q`
# makes apt-cache die of SIGPIPE (141), pipefail propagates it and `set -e` aborts the script.
# That silently killed two earlier attempts. Capture once into a variable, then match.
POLICY=$(apt-cache policy amdrocm-core-sdk10.0-gfx1201)
printf '%s\n' "$POLICY" | sed -n '1,4p'
case "$POLICY" in
  *'10.0.0~pre4'*) echo "   candidate ok" ;;
  *) echo "!! 10.0.0~pre4 not offered -- aborting (repo line left as-is)"
     printf '%s\n' "$POLICY"; exit 1 ;;
esac

echo "== 5. installing ROCm 10.0 for gfx1201 (~1.0 GB download, 8.2 GB installed)"
echo "   7.13 stays installed; 0 packages are removed by this step"
apt-get install -y \
  amdrocm-core-sdk10.0-gfx1201 \
  amdrocm-core-dev10.0-gfx1201 \
  amdrocm-llvm-dev10.0

echo "== 6. verify"
ls -d /opt/rocm/core-* 2>/dev/null | head || true
for p in /opt/rocm/core-10.0/bin/hipcc /opt/rocm/core-10.0/bin/rocminfo; do
  printf '%s: ' "$p"; test -x "$p" && echo present || echo MISSING
done
/opt/rocm/core-10.0/bin/hipcc --version 2>&1 | head -3 || true
/opt/rocm/core-10.0/bin/rocminfo 2>/dev/null | grep -m2 -E 'gfx1201|Marketing Name' || true

echo
echo "== DONE. 7.13 is still installed. Next:"
echo "   1) verify Vulkan llama.cpp at :9292 still answers"
echo "   2) rebuild hipfire against /opt/rocm/core-10.0"
echo "   3) only then: sudo bash docs/test/rocm-upgrade/purge-rocm-7.13.sh"

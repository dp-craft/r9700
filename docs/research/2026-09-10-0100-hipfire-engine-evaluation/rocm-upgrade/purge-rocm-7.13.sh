#!/usr/bin/env bash
# Remove the OLD ROCm 7.13 package family, leaving 10.0 as the only installed ROCm.
# Run ONLY after ROCm 10.0 is verified AND hipfire has been rebuilt against core-10.0.
#   sudo bash docs/test/rocm-upgrade/purge-rocm-7.13.sh
# Dry run by default; pass --apply to actually purge.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "must run as root"; exit 1; }
APPLY=0; [ "${1:-}" = "--apply" ] && APPLY=1

mapfile -t OLD < <(dpkg -l | awk '/^ii +amdrocm[^ ]*7\.13/{print $2}')
mapfile -t ORPHAN < <(dpkg -l | awk '/^ii +amdrocm[^ ]*gfx120x/{print $2}')
PKGS=$(printf '%s\n' "${OLD[@]}" "${ORPHAN[@]}" | sort -u | grep -v '^$' || true)

if [ -z "$PKGS" ]; then echo "nothing matching ROCm 7.13 is installed"; exit 0; fi
echo "== packages that WILL be purged ($(echo "$PKGS" | wc -l)):"
echo "$PKGS" | sed 's/^/   /'

echo
echo "== safety gate: ROCm 10.0 must be installed first"
# NO PIPE HERE. Under `set -o pipefail`, `dpkg -l | grep -q ...` makes dpkg die of SIGPIPE
# (141) the instant grep matches, pipefail propagates it, and the gate fails BECAUSE the
# package is present. That exact inversion refused a valid purge on 2026-09-10.
DPKG_L=$(dpkg -l)
case "$DPKG_L" in
  *amdrocm-core10.0-gfx1201*) : ;;
  *) echo "!! ROCm 10.0 NOT installed -- refusing"; exit 1 ;;
esac
echo "   ok, amdrocm-core10.0-gfx1201 present"

if [ "$APPLY" -eq 0 ]; then
  echo; echo "DRY RUN. Re-run with --apply to purge."
  apt-get -s purge $PKGS 2>&1 | tail -5 || true
  exit 0
fi

apt-get purge -y $PKGS
apt-get autoremove -y
echo "== remaining ROCm trees:"; ls -d /opt/rocm/core-* 2>/dev/null | head || true
echo "== remaining amdrocm packages:"; dpkg -l | awk '/^ii +amdrocm/{print $2, $3}' | head -50 || true

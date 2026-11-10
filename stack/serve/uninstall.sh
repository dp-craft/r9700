#!/usr/bin/env bash
# stack/serve/uninstall.sh — remove the dp_-prefixed links created by install.sh (2026-11-09, D7).
#
# Removes EXACTLY the managed dp_* symlinks — the name list is re-derived from install.sh (`list`), and
# each link is verified to be a symlink resolving into this repo before removal. Never deletes regular
# files, never deletes foreign symlinks, never touches anything outside the managed set (llama-swap
# links included). Idempotent: a second run finds nothing to remove.
#
# Usage: uninstall.sh [target-dir...]    (no args = the standard targets that exist)
# Test: bash stack/serve/tests/test_install_uninstall.sh   (tmp targets only, no GPU)
set -euo pipefail
HERE="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
MANAGED=()
while IFS= read -r rel; do MANAGED+=("$rel"); done < <(bash "$HERE/install.sh" list)

in_repo() { case "$(readlink -f "$1" 2>/dev/null)" in "$REPO"/*) return 0;; *) return 1;; esac; }

if [ "$#" -eq 0 ]; then
  TARGETS=()
  for t in "$REPO" "$REPO/../amd-private" /home/dev/work/dippe/dp-forge "$HOME/.local/bin"; do
    [ -d "$t" ] && TARGETS+=("$(readlink -f "$t")")
  done
  [ "${#TARGETS[@]}" -gt 0 ] || { echo "no standard target dir exists (repo root missing?)" >&2; exit 1; }
else
  TARGETS=("$@")
fi

for TARGET in "${TARGETS[@]}"; do
  [ -d "$TARGET" ] || { echo "note: no target $TARGET — skipped" >&2; continue; }
  for rel in "${MANAGED[@]}"; do
    name=${rel##*/}; link="$TARGET/dp_$name"
    if [ -L "$link" ]; then
      if in_repo "$link"; then rm "$link"; echo "removed $link"
      else echo "note: $link points outside this repo — left as-is" >&2; fi
    elif [ -e "$link" ]; then
      echo "note: $link is not a symlink — left as-is" >&2
    fi
  done
done
echo "uninstall: done"

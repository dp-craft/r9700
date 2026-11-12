#!/usr/bin/env bash
# stack/serve/install.sh — install the 27B serving scripts into one or more target dirs as dp_-prefixed
# symlinks (2026-11-09, D7: one code home = this repo; dp_ prefix marks the dp-craft launcher set).
#
# Managed set = the 12 scripts whose code home is this repo (4 starters + 8 claude launchers).
#   - creates dp_<basename> -> <this repo>/<path> (absolute), updates a drifted managed link
#   - idempotent: re-running updates the links, never fails on existing managed links
#   - migrates the known prefix-less root symlinks OF THOSE 12 (the legacy repo-root style) to the dp_
#     names, target preserved
#   - NEVER touches: regular files, symlinks resolving outside this repo (incl. foreign dp_* links,
#     managed name or not), and anything outside the managed set — in particular the llama-swap links
#     (start_llama_swap.sh / restart_llama_swap.sh — code lives in the llama-swap dir, not here) and the
#     plain regular file start_llama.sh
#
# Usage: install.sh <target-dir> [more...]      |      install.sh list   (prints the managed paths)
# Standard targets (this machine): the amd repo root, ../amd-private, /home/dev/work/dippe/dp-forge,
#   ~/.local/bin  — the session-1 invocation: install.sh <amd-root> <amd-private-root> <dp-forge-root> ~/.local/bin
# Test: bash stack/serve/tests/test_install_uninstall.sh   (tmp targets only, no GPU)
set -euo pipefail
REPO="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/../.." && pwd)"

MANAGED=(
  stack/serve/radiance/start_ornith_35b_vllm_rad.sh
  stack/serve/radiance/start_qwen38_27b_iq4r-l-v4_rad.sh
  stack/serve/vllm/start_heretic_27b.sh
  stack/serve/vllm/start_redhat_27b.sh
  clients/claude/claude-rad-mxfp4.sh
  clients/claude/claude-rad-iq4rlv4.sh
  clients/claude/claude-rad-iq4rlv4-dflash.sh
  clients/claude/claude-rad-iq4rlv4-nospec.sh
  clients/claude/claude-rad-heretic.sh
  clients/claude/claude-sly-redhat.sh
  clients/claude/claude-sly-heretic.sh
  clients/claude/claude-sly-amd.sh
)

in_repo() { case "$(readlink -f "$1" 2>/dev/null)" in "$REPO"/*) return 0;; *) return 1;; esac; }

if [ "${1:-}" = list ]; then printf '%s\n' "${MANAGED[@]}"; exit 0; fi
[ "${1:-}" ] || { echo "usage: install.sh <target-dir> [more...]  (or: install.sh list)" >&2
  echo "  standard targets: $REPO, $REPO/../amd-private, /home/dev/work/dippe/dp-forge, ~/.local/bin" >&2
  exit 2; }

for TARGET in "$@"; do
  [ -d "$TARGET" ] || { mkdir -p "$TARGET"; echo "created target $TARGET"; }
  TARGET=$(readlink -f "$TARGET")
  for rel in "${MANAGED[@]}"; do
    name=${rel##*/}; src="$REPO/$rel"; link="$TARGET/dp_$name"
    [ -f "$src" ] || { echo "FATAL: managed script missing: $src" >&2; exit 1; }
    # 1) migrate the legacy prefix-less symlink of this exact script (target preserved; a legacy that
    #    points elsewhere is a foreign link — left alone)
    legacy="$TARGET/$name"
    if [ -L "$legacy" ] && [ "$(readlink -f "$legacy")" = "$src" ]; then
      if [ -L "$link" ] || [ -e "$link" ]; then rm "$legacy"
      else mv -T "$legacy" "$link"; fi
      echo "migrated $legacy -> dp_$name"
    elif [ -L "$legacy" ]; then
      echo "note: $legacy points outside this repo — left as-is" >&2
    fi
    # 2) install / update the dp_ link (never steal a foreign link, never touch regular files)
    if [ -L "$link" ]; then
      if [ "$(readlink -f "$link")" = "$src" ]; then :
      elif in_repo "$link"; then ln -sfn "$src" "$link"; echo "updated $link"
      else echo "note: $link points outside this repo — left as-is" >&2; fi
    elif [ -e "$link" ]; then
      echo "FATAL: $link exists and is not a symlink — refusing to touch it" >&2; exit 1
    else
      ln -s "$src" "$link"; echo "created $link"
    fi
  done
done
echo "install: done"

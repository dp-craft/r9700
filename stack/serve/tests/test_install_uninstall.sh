#!/usr/bin/env bash
# test_install_uninstall.sh — TDD suite (NO GPU, NO docker) for stack/serve/install.sh + uninstall.sh
# (the dp_-prefixed link installer, 2026-11-09 WS1.1 / D7). Every case runs against mktemp targets only
# — the real install targets (repo root, amd-private, dp-forge, ~/.local/bin) are never touched here.
#
# Managed set = the 12 scripts whose code home is this repo (4 starters + 8 claude launchers).
# Contract under test:
#   install:   dp_<basename> symlinks created in each target, resolving to the repo files, executable
#              through the link (starters: GPU-free `print` mode runs via the link; launchers: parse + exec bit)
#              idempotent (re-run updates, never fails on existing managed links)
#              migrates the known prefix-less root symlinks OF THOSE 12 to the dp_ names (target preserved)
#              NEVER touches: regular files, symlinks resolving outside the repo (incl. planted foreign
#              dp_* links, managed name or not), and anything outside the managed set — in particular the
#              llama-swap links (start_llama_swap.sh / restart_llama_swap.sh) and the plain start_llama.sh
#   uninstall: removes exactly the managed dp_* links, each verified to be a symlink resolving into this
#              repo before removal; idempotent; nothing else touched
#
# Run: bash stack/serve/tests/test_install_uninstall.sh   (~5 s)
set -u
SELF=$(readlink -f "${BASH_SOURCE[0]}")
ROOT=$(cd "$(dirname "$SELF")/../../.." && pwd)
INSTALL="$ROOT/stack/serve/install.sh"
UNINSTALL="$ROOT/stack/serve/uninstall.sh"
CONF="$ROOT/stack/serve/27b.conf"

STARTERS=(start_ornith_35b_vllm_rad.sh start_qwen38_27b_iq4r-l-v4_rad.sh start_heretic_27b.sh start_redhat_27b.sh)
LAUNCHERS=(claude-rad-mxfp4.sh claude-rad-iq4rlv4.sh claude-rad-iq4rlv4-dflash.sh claude-rad-iq4rlv4-nospec.sh \
           claude-rad-heretic.sh claude-sly-redhat.sh claude-sly-heretic.sh claude-sly-amd.sh)
STARTER_DIR() { case "$1" in start_ornith*|start_qwen38*) echo stack/serve/radiance;; *) echo stack/serve/vllm;; esac; }
LAUNCHER_DIR=clients/claude

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "PASS: $*"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL: $*" >&2; }

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
T1="$TMP/t1-install"; T2="$TMP/t2-migrate"; T3="$TMP/t3-survivors"; T4="$TMP/t4-uninstall"; T5="$TMP/t5-uninstall-safety"
for d in "$T1" "$T2" "$T3" "$T4" "$T5"; do mkdir -p "$d"; done

echo "== 0. the scripts exist (red until implemented) =="
check "install.sh exists" test -f "$INSTALL"
check "uninstall.sh exists" test -f "$UNINSTALL"
if [ ! -f "$INSTALL" ] || [ ! -f "$UNINSTALL" ]; then
  echo "test_install_uninstall: $PASS passed, $FAIL failed"
  exit 1
fi
check "install.sh list emits the 12 managed scripts" bash -c '[ "$(bash "$1" list | wc -l)" = 12 ]' -- "$INSTALL"

# expect_link LINK REPO_REL — symlink exists, resolves to the repo file, same content
expect_link() {   # $1 = link path, $2 = repo-relative managed path
  local link=$1 rel=$2 src="$ROOT/$2"
  [ -L "$link" ] || { bad "$link is not a symlink"; return; }
  [ -e "$link" ] || { bad "$link is a broken symlink"; return; }
  [ "$(readlink -f "$link")" = "$src" ] || { bad "$link -> $(readlink -f "$link") (want $src)"; return; }
  [ "$(sha256sum "$link" | cut -d' ' -f1)" = "$(sha256sum "$src" | cut -d' ' -f1)" ] && ok "$link" || bad "$link content differs"
}

echo "== 1. install into a fresh target: 12 links resolve and execute through the link =="
if bash "$INSTALL" "$T1" >"$TMP/i1.log" 2>&1; then ok "install rc=0"; else bad "install rc!=0: $(tail -3 "$TMP/i1.log")"; fi
for s in "${STARTERS[@]}"; do expect_link "$T1/dp_$s" "$(STARTER_DIR "$s")/$s"; done
for l in "${LAUNCHERS[@]}"; do expect_link "$T1/dp_$l" "$LAUNCHER_DIR/$l"; done
# execute through the link: starters run their GPU-free print mode; launchers parse + carry the exec bit
for s in "${STARTERS[@]}"; do
  if bash "$T1/dp_$s" print >"$TMP/print.log" 2>&1; then ok "dp_$s executes (print rc=0)"; else bad "dp_$s print failed: $(tail -1 "$TMP/print.log")"; fi
done
for l in "${LAUNCHERS[@]}"; do
  bash -n "$T1/dp_$l" && [ -x "$T1/dp_$l" ] && ok "dp_$l parses + exec bit" || bad "dp_$l parse/exec"
done

echo "== 2. re-run is idempotent (same targets, no failure) =="
bash "$INSTALL" "$T1" >"$TMP/i2.log" 2>&1 && ok "re-run rc=0" || bad "re-run rc!=0: $(tail -3 "$TMP/i2.log")"
for s in "${STARTERS[@]}"; do expect_link "$T1/dp_$s" "$(STARTER_DIR "$s")/$s"; done

echo "== 3. migration: legacy prefix-less links of the managed set -> dp_ names, target preserved =="
for n in start_redhat_27b.sh start_qwen38_27b_iq4r-l-v4_rad.sh claude-sly-redhat.sh; do
  rel=$([ "$n" = claude-sly-redhat.sh ] && echo "$LAUNCHER_DIR/$n" || echo "$(STARTER_DIR "$n")/$n")
  ln -s "$ROOT/$rel" "$T2/$n"
done
bash "$INSTALL" "$T2" >"$TMP/i3.log" 2>&1 && ok "install (migration) rc=0" || bad "install (migration) rc!=0: $(tail -3 "$TMP/i3.log")"
for n in start_redhat_27b.sh start_qwen38_27b_iq4r-l-v4_rad.sh claude-sly-redhat.sh; do
  [ ! -e "$T2/$n" ] && ok "legacy $n gone" || bad "legacy $n still present"
  rel=$([ "$n" = claude-sly-redhat.sh ] && echo "$LAUNCHER_DIR/$n" || echo "$(STARTER_DIR "$n")/$n")
  expect_link "$T2/dp_$n" "$rel"
done

echo "== 4. survivors: planted regular file, foreign dp_* link, llama-swap links all survive =="
printf '#!/bin/sh\nexit 0\n' > "$T3/start_llama.sh"; chmod +x "$T3/start_llama.sh"          # regular file, never touched
ln -s /bin/true "$T3/dp_foreign.sh"                                                          # foreign dp_*, unmanaged name
ln -s /bin/true "$T3/dp_start_redhat_27b.sh"                                                 # foreign dp_*, MANAGED name — not stolen
ln -s "$ROOT/stack/llama-swap/start_llama_swap.sh" "$T3/start_llama_swap.sh"                  # llama-swap link — out of scope
ln -s "$ROOT/stack/llama-swap/start_llama_swap.sh" "$T3/restart_llama_swap.sh"                # same
bash "$INSTALL" "$T3" >"$TMP/i4.log" 2>&1 && ok "install (survivors) rc=0" || bad "install (survivors) rc!=0: $(tail -3 "$TMP/i4.log")"
[ -f "$T3/start_llama.sh" ] && [ ! -L "$T3/start_llama.sh" ] && ok "regular start_llama.sh survived" || bad "start_llama.sh was touched"
[ "$(readlink -f "$T3/dp_foreign.sh" 2>/dev/null)" = "$(readlink -f /bin/true)" ] && ok "foreign dp_foreign.sh survived" || bad "dp_foreign.sh was touched"
[ "$(readlink -f "$T3/dp_start_redhat_27b.sh" 2>/dev/null)" = "$(readlink -f /bin/true)" ] && ok "foreign managed-name dp_ link not stolen" || bad "foreign managed-name dp_ link was stolen"
[ "$(readlink -f "$T3/start_llama_swap.sh")" = "$(readlink -f "$ROOT/stack/llama-swap/start_llama_swap.sh")" ] && ok "llama-swap links survived" || bad "llama-swap links were touched"
expect_link "$T3/dp_claude-sly-redhat.sh" "$LAUNCHER_DIR/claude-sly-redhat.sh"   # managed set still installed around the survivors

echo "== 5. uninstall: managed dp_* gone, survivors untouched, idempotent =="
bash "$INSTALL" "$T4" >"$TMP/i5.log" 2>&1
printf '#!/bin/sh\nexit 0\n' > "$T4/start_llama.sh"; chmod +x "$T4/start_llama.sh"
ln -s /bin/true "$T4/dp_foreign.sh"
ln -s "$ROOT/stack/llama-swap/start_llama_swap.sh" "$T4/start_llama_swap.sh"
if bash "$UNINSTALL" "$T4" >"$TMP/u1.log" 2>&1; then ok "uninstall rc=0"; else bad "uninstall rc!=0: $(tail -3 "$TMP/u1.log")"; fi
LEFT=0
for s in "${STARTERS[@]}"; do [ -e "$T4/dp_$s" ] && LEFT=1; done
for l in "${LAUNCHERS[@]}"; do [ -e "$T4/dp_$l" ] && LEFT=1; done
[ "$LEFT" -eq 0 ] && ok "all 12 managed dp_* removed" || bad "managed dp_* still present"
[ -f "$T4/start_llama.sh" ] && [ ! -L "$T4/start_llama.sh" ] && ok "regular file untouched" || bad "regular file touched"
[ "$(readlink -f "$T4/dp_foreign.sh")" = "$(readlink -f /bin/true)" ] && ok "foreign dp_* untouched" || bad "foreign dp_* touched"
[ "$(readlink -f "$T4/start_llama_swap.sh")" = "$(readlink -f "$ROOT/stack/llama-swap/start_llama_swap.sh")" ] && ok "llama-swap link untouched" || bad "llama-swap link touched"
bash "$UNINSTALL" "$T4" >"$TMP/u2.log" 2>&1 && ok "uninstall idempotent (rc=0)" || bad "uninstall not idempotent"
[ -f "$T4/start_llama.sh" ] && [ -L "$T4/dp_foreign.sh" ] && ok "second uninstall touched nothing" || bad "second uninstall had side effects"

echo "== 6. uninstall safety: foreign dp_ (managed name) and regular file with managed name survive =="
ln -s /bin/true "$T5/dp_start_heretic_27b.sh"
printf '#!/bin/sh\nexit 0\n' > "$T5/dp_start_redhat_27b.sh"; chmod +x "$T5/dp_start_redhat_27b.sh"
bash "$UNINSTALL" "$T5" >"$TMP/u3.log" 2>&1 && ok "uninstall (safety) rc=0" || bad "uninstall (safety) rc!=0"
[ "$(readlink -f "$T5/dp_start_heretic_27b.sh")" = "$(readlink -f /bin/true)" ] && ok "foreign managed-name link survived uninstall" || bad "foreign managed-name link deleted"
[ -f "$T5/dp_start_redhat_27b.sh" ] && [ ! -L "$T5/dp_start_redhat_27b.sh" ] && ok "regular file with managed name survived uninstall" || bad "regular file deleted"

echo
echo "test_install_uninstall: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]

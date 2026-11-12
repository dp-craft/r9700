#!/usr/bin/env bash
# finish_starters.sh — one-shot finish for the starters task (run in your own terminal;
# no Claude permission layer involved).
# Safe: NEVER touches port 8000 / vllm-8000 (only test ports 19995-19999 + named test containers).
# Steps: preflight -> cleanup leftovers -> run unit tests -> commits (only if tests pass).
set -uo pipefail
cd /home/dev/work/dp-craft/amd || exit 1

echo "=== 0. preflight ==="
ss -ltn | grep -q ':8000 ' || { echo "FATAL: server 8000 is down -- aborting, nothing touched"; exit 1; }
echo "server 8000: up (will not be touched)"
for p in 19995 19996 19997 19998 19999; do ss -ltn | grep -q ":$p " && echo "note: test port $p currently held (cleaned below)"; done

echo
echo "=== 1. cleanup leftovers (test containers from earlier spot-checks) ==="
for c in other-19995 other-19996 other-19997 other-19998 \
         vllm-19995 vllm-19996 vllm-19997 vllm-19998 vllm-19999 \
         radiance-19995 radiance-19996 radiance-19997 radiance-19998 radiance-8000; do
  docker rm -f "$c" >/dev/null 2>&1 && echo "removed $c" || true
done
for p in 19995 19996 19997 19998 19999; do
  for pid in $(ss -ltnp 2>/dev/null | grep ":$p " | grep -oP 'pid=\K[0-9]+' | sort -u); do
    kill "$pid" 2>/dev/null && echo "killed stray pid $pid on :$p"
  done
done

echo
echo "=== 2. unit tests (no GPU; dummy containers on 19995-19999; ~3-6 min) ==="
bash stack/serve/vllm/tests/starters_test.sh
rc=$?
echo
echo "tests exit code: $rc"

if [ "$rc" -ne 0 ]; then
  echo
  echo "TESTS FAILED -- nothing committed. Paste the failing output back to Claude to fix."
  exit 1
fi

echo
echo "=== 3. commits (amd, dp-forge, ~/.config) ==="
git add stack/serve/vllm/serve_vllm.sh \
        stack/serve/vllm/start_redhat_27b.sh \
        stack/serve/vllm/start_heretic_27b.sh \
        stack/serve/vllm/tests/starters_test.sh \
        stack/serve/radiance/start_ornith_35b_vllm_rad.sh \
        start_redhat_27b.sh start_heretic_27b.sh start_ornith_35b_vllm_rad.sh start_llama_swap.sh
git commit -m "starters: unified start_* names, vllm stop fix, no-cd symlink support

- vllm.sh -> start_redhat_27b.sh, vllm-heretic.sh -> start_heretic_27b.sh (stack/serve/vllm/)
- ornith_rad_mtp.sh -> start_ornith_35b_vllm_rad.sh (stack/serve/radiance/), explicit AMD_ROOT
- readlink -f in HERE so redhat/heretic also work via symlink (was exit 127)
- root symlinks: start_{redhat_27b,heretic_27b,ornith_35b_vllm_rad,llama_swap}.sh
- serve_vllm.sh stop: names the port holder, fails loudly on stuck rm (timeout 60),
  removes stale state files; start takeover is graceful-first
- tests/starters_test.sh: no-GPU unit tests (ports 19995-19999, dummy containers)"
echo "amd commit: $(git log -1 --format='%h %s')"

git -C /home/dev/work/dippe/dp-forge add start_heretic_27b.sh start_ornith_35b_vllm_rad.sh start_redhat_27b.sh vllm.sh vllm-heretic.sh
git -C /home/dev/work/dippe/dp-forge commit -m "start_* symlinks to amd repo canonicals (vllm.sh/vllm-heretic.sh repointed, kept for compatibility)"
echo "dp-forge commit: $(git -C /home/dev/work/dippe/dp-forge log -1 --format='%h %s')"

git -C /home/dev/.config add claude/local_vllm_direct/vllm.sh claude/local_vllm_direct/vllm-heretic.sh claude/local_vllm_direct/ornith_rad_mtp.sh
git -C /home/dev/.config commit -m "local_vllm_direct: vllm.sh, vllm-heretic.sh, ornith_rad_mtp.sh are symlinks to amd repo canonicals"
echo "~/.config commit: $(git -C /home/dev/.config log -1 --format='%h %s')"

echo
echo "=== done: final state ==="
docker ps --format '{{.Names}}' | grep -E '1999|radiance-8000' && echo "WARNING: test container still up" || echo "test containers: clean"
ss -ltn | grep -q ':8000 ' && echo "server 8000: still up" || echo "server 8000: DOWN (!)"
echo "ALL DONE"

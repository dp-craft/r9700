#!/usr/bin/env bash
# Tool gap (stated): build_llamacpp.sh clones upstream TAGS only. A local patch or a PR head needs a
# hand-made build/<ver>-src git checkout; configure/compile/verify still go through the tool.
set -euo pipefail
REPO=/home/dev/work/dp-craft/amd; B=$REPO/build

# 1. b10909 + rm_kq=1 (Vulkan K-quant mul_mat_vec rows/shader; forum tweak, llama.cpp discussion #21043)
R=$B/b10909-rmkq1-src
if [ ! -d "$R/.git" ]; then
  rm -rf "$R.partial"; cp -a "$B/b10909-src" "$R.partial"
  f=$R.partial/ggml/src/ggml-vulkan/ggml-vulkan.cpp
  grep -q '^    uint32_t rm_kq = 2;$' "$f"
  sed -i 's/^    uint32_t rm_kq = 2;$/    uint32_t rm_kq = 1;/' "$f"
  grep -q '^    uint32_t rm_kq = 1;$' "$f"
  git -C "$R.partial" -c user.name=local -c user.email=local@localhost commit -qam "vulkan: rm_kq=1 (local experiment)"
  mv "$R.partial" "$R"
fi
git -C "$R" log --oneline -2

# 2. PR #27210 head (adaptive MTP, stew675:adaptive-mtp), shallow
P=$B/pr27210.partial
if ! ls -d "$B"/pr27210-*-src >/dev/null 2>&1; then
  rm -rf "$P"; git init -q "$P"
  git -C "$P" fetch -q --depth 1 https://github.com/ggml-org/llama.cpp pull/27210/head
  git -C "$P" -c advice.detachedHead=false checkout -q FETCH_HEAD
  sha=$(git -C "$P" rev-parse --short=7 HEAD)
  mv "$P" "$B/pr27210-$sha-src"
fi
PR_SRC=$(ls -d "$B"/pr27210-*-src | head -1); PR_VER=$(basename "$PR_SRC" -src)
git -C "$PR_SRC" log --oneline -1
echo "PR_VER=$PR_VER"

cd "$REPO"
bench/build_llamacpp.sh build --tag b10909-rmkq1 --backend vulkan
bench/build_llamacpp.sh build --tag "$PR_VER" --backend vulkan

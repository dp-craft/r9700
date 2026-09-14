#!/usr/bin/env bash
# build_llamacpp.sh — fetch, build and promote llama.cpp (skill: llamacpp-build).
#
#   builds/<ver>-src          shallow checkout of upstream tag <ver> (bNNNNN)
#   builds/<ver>-<backend>    CMake binary dir, backend = vulkan|rocm: bin/ + BUILD_INFO
#   builds/latest-<backend>   symlink → the promoted <ver>-<backend>; llama-swap serves
#                             builds/latest-<backend>/bin/llama-server (generate.py VULKAN_BIN/ROCM_BIN)
#   (setup_vulkan.sh manages the self-contained Vulkan SDK under llamacpp/vulkansdk/)
#
# Usage:
#   build_llamacpp.sh status                        latest-* targets, newest upstream tag, builds, disk, SDK
#   build_llamacpp.sh latest-tag                    newest upstream bNNNNN
#   build_llamacpp.sh build [--tag VER] [--backend vulkan|rocm|both] [--jobs N]
#                                                   default: newest tag, both backends. VER may also name
#                                                   an existing non-tag builds/<VER>-src (b10655-4-g6fdd0ac).
#                                                   Re-run resumes: src reused, CMake incremental, an
#                                                   already verified build is skipped.
#   build_llamacpp.sh promote VER [--backend ...]   latest-<backend> → <VER>-<backend> (also = rollback)
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD="$REPO/llamacpp/builds"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SDK_SETUP="$SCRIPT_DIR/setup_vulkan.sh"
UPSTREAM="https://github.com/ggml-org/llama.cpp.git"
GPU_TARGET=gfx1201      # R9700 — CLAUDE.md fixpoint
MIN_FREE_GB=5           # src ~0.1 GB + a build tree ~1-2 GB; the root fs runs ~90% full
# Compilers pinned: PATH here has ~/scripts/cc (a Claude launcher) ahead of /usr/bin, and CMake probes
# `cc` first — an unpinned configure executes it (2026-09-11).
CC_BIN=${CC_BIN:-/usr/bin/gcc}
CXX_BIN=${CXX_BIN:-/usr/bin/g++}
# ExternalProjects (ggml-vulkan's vulkan-shaders-gen) re-detect their compiler from the environment,
# not from our -D flags — export too.
export CC="$CC_BIN" CXX="$CXX_BIN"
# Peak RSS per compile job, INFERRED (hipcc template TUs are the heavy ones). No swap on this box, so
# -j is capped by MemAvailable: an OOM-killed compiler is a confusing, silent failure.
declare -A MB_PER_JOB=([vulkan]=1500 [rocm]=3000)

die() { echo "build_llamacpp: $*" >&2; exit 1; }
ok()  { echo "build_llamacpp: $*"; }

latest_tag() {
  git ls-remote --tags --refs "$UPSTREAM" | awk -F/ '{print $3}' | grep -E '^b[0-9]+$' | sort -V | tail -1
}

parse_backend() {
  case "$1" in both) echo "vulkan rocm" ;; vulkan|rocm) echo "$1" ;;
    *) die "bad --backend '$1' (vulkan|rocm|both)" ;; esac
}

auto_jobs() {  # BACKEND
  local avail j
  avail=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
  j=$(( avail / ${MB_PER_JOB[$1]} ))
  (( j < 1 )) && j=1
  (( j > $(nproc) )) && j=$(nproc)
  echo "$j"
}

version_line() { "$1/bin/llama-server" --version 2>&1 | grep -m1 -E '^version:' || true; }

verify() {  # DIR SHA NUM BACKEND — binaries, libs resolve, GPU device visible, pinned commit in --version
  local dir=$1 sha=$2 num=$3 dev t v
  dev=$([ "$4" = rocm ] && echo ROCm || echo Vulkan)
  for t in llama-server llama-bench; do
    [ -x "$dir/bin/$t" ] || { echo "missing $dir/bin/$t" >&2; return 1; }
  done
  # no `grep -q`: its early exit SIGPIPEs ldd, and pipefail would read that as "nothing missing"
  if ldd "$dir/bin/llama-server" | grep 'not found' >&2; then return 1; fi
  # a GPU backend that fails to init leaves a working CPU-only binary — silent, so check the device
  "$dir/bin/llama-server" --list-devices 2>&1 | grep -E "^\s*${dev}[0-9]+:" >/dev/null \
    || { echo "no $dev device visible from $dir/bin/llama-server" >&2; return 1; }
  v=$(version_line "$dir")
  [[ $v == *"$sha"* ]] || { echo "version '$v' lacks commit $sha" >&2; return 1; }
  [[ $v == *"$num"* ]] || echo "WARN: version '$v' lacks build number $num" >&2
}

fetch_src() {  # VER → ensures build/VER-src
  local ver=$1 src="$BUILD/$1-src"
  [ -d "$src/.git" ] && return 0
  [ -e "$src" ] && die "$src exists but is not a git checkout"
  echo "fetch $ver → $src"
  rm -rf "$src.partial"
  git -c advice.detachedHead=false clone --quiet --depth 1 --branch "$ver" --single-branch "$UPSTREAM" "$src.partial" \
    || { rm -rf "$src.partial"; die "clone of '$ver' failed — not an upstream tag, or offline"; }
  mv "$src.partial" "$src"   # atomic: a half-finished clone never looks like a source tree
}

build_one() {  # VER BACKEND JOBS
  local ver=$1 be=$2 jobs=$3 sdk_ver="${SDK_VER:-}" src="$BUILD/$1-src" sha num t0
  # Append SDK version to Vulkan build dir for traceability (rule 2)
  local be_label=$2
  if [ "$be" = "vulkan" ] && [ -n "$sdk_ver" ]; then
    be_label="${2}-${sdk_ver}"
  fi
  local out="$BUILD/$1-${be_label}"
  local -a flags cenv=()
  sha=$(git -C "$src" rev-parse --short=7 HEAD)
  if [[ $ver =~ ^b([0-9]+) ]]; then num=${BASH_REMATCH[1]}; else num=0; fi
  if verify "$out" "$sha" "$num" "$be" 2>/dev/null; then
    echo "[$be] $ver already built and verified: $out (SDK: $sdk_ver)"; return 0
  fi
  case $be in
    vulkan)
            command -v glslc >/dev/null || die "[vulkan] glslc missing (run: $SDK_SETUP update)"
            flags=(-DGGML_VULKAN=ON)
            if [ -n "${VULKAN_SDK:-}" ]; then
                flags+=(-DVULKAN_SDK="$VULKAN_SDK" -DCMAKE_PREFIX_PATH="$VULKAN_SDK")
            fi
            ;;
    rocm)   command -v hipconfig >/dev/null || die "[rocm] hipconfig missing (ROCm)"
            # BUILD_RPATH on every target: RUNPATH is not transitive, so libggml-hip.so needs the ROCm
            # lib dir itself — ROCm is not in ld.so.cache and llama-swap sets no LD_LIBRARY_PATH (2026-09-11)
            flags=(-DGGML_HIP=ON -DGPU_TARGETS="$GPU_TARGET" -DCMAKE_BUILD_RPATH="$(hipconfig -R)/lib")
            cenv=(HIPCXX="$(hipconfig -l)/clang" HIP_PATH="$(hipconfig -R)") ;;
  esac
  # BUILD_NUMBER/COMMIT pinned: a shallow clone otherwise reports "build 1" (iron rule 2).
  flags+=(-DCMAKE_C_COMPILER="$CC_BIN" -DCMAKE_CXX_COMPILER="$CXX_BIN"
          -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=ON -DGGML_NATIVE=ON
          -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF
          -DLLAMA_BUILD_NUMBER="$num" -DLLAMA_BUILD_COMMIT="$sha")
  mkdir -p "$out"
  echo "[$be] configure $ver ($sha) → $out"
  env "${cenv[@]}" cmake -S "$src" -B "$out" "${flags[@]}" >"$out/build.log" 2>&1 \
    || { tail -25 "$out/build.log" >&2; die "[$be] configure failed — log: $out/build.log"; }
  echo "[$be] compile -j$jobs (MemAvailable-capped) — log: $out/build.log"
  t0=$SECONDS
  cmake --build "$out" --config Release -j "$jobs" >>"$out/build.log" 2>&1 \
    || { tail -25 "$out/build.log" >&2; die "[$be] compile failed — log: $out/build.log (re-run resumes)"; }
  verify "$out" "$sha" "$num" "$be" || die "[$be] built but failed verification"
  { echo "date=$(date -Iseconds)"; echo "ver=$ver"; echo "commit=$sha"; echo "backend=$be"
    echo "build_secs=$((SECONDS - t0))"; echo "jobs=$jobs"
    echo "cmake_flags=${flags[*]}"; echo "cxx=$("$CXX_BIN" --version | head -1)"
    case $be in
        vulkan)
            echo "glslc=$(glslc --version | head -1)"
            echo "vulkan_sdk=${SDK_VER:-system}"
            [ "${SDK_VER:-system}" != "system" ] && echo "vulkan_sdk_path=$REPO/llamacpp/vulkansdk/$SDK_VER"
            ;;
        rocm) echo "hip=$(hipconfig --version)" ;;
    esac
    echo "version=$(version_line "$out")"
  } >"$out/BUILD_INFO"
  echo "[$be] OK in $(( (SECONDS - t0) / 60 )) min: $(version_line "$out")"
}

cmd_build() {
  local tag="" be=both jobs="" list free b
  while [ $# -gt 0 ]; do case $1 in
    --tag) tag=$2; shift 2 ;; --backend) be=$2; shift 2 ;; --jobs) jobs=$2; shift 2 ;;
    *) die "unknown build arg: $1" ;; esac; done
  list=$(parse_backend "$be")

  # Init Vulkan SDK if building Vulkan backend
  if echo "$list" | grep -q "vulkan"; then
    # Ensure glslc is available: local SDK first, then system fallback
    if [ -L "$REPO/llamacpp/vulkansdk/latest" ]; then
      local sdk="$(readlink -f "$REPO/llamacpp/vulkansdk/latest")"
      local glslc_path
      glslc_path=$(find "$sdk" -name glslc -type f -executable 2>/dev/null | head -1)
      if [ -n "$glslc_path" ]; then
        export VULKAN_SDK="$sdk"
        export PATH="$(dirname "$glslc_path"):$PATH"
        SDK_VER=$(basename "$sdk")
        ok "Vulkan SDK: $SDK_VER ($sdk)"
      else
        ok "SDK directory exists but glslc not found in $sdk"
      fi
    fi

    # System fallback
    if [ -z "${VULKAN_SDK:-}" ]; then
      if command -v glslc >/dev/null 2>&1; then
        SDK_VER="system"
        ok "Vulkan SDK: system (glslc: $(glslc --version 2>&1 | head -1))"
      else
        die "glslc not found. Install with: $SDK_SETUP update"
      fi
    fi
  fi

  [ -x "$CC_BIN" ] && [ -x "$CXX_BIN" ] || die "compiler missing: $CC_BIN / $CXX_BIN (override CC_BIN/CXX_BIN)"
  [ -n "$tag" ] || tag=$(latest_tag) || die "could not resolve the newest upstream tag (offline?)"
  mkdir -p "$BUILD"
  free=$(df -BG --output=avail "$BUILD" | tail -1 | tr -dc 0-9)
  (( free >= MIN_FREE_GB )) || die "only ${free} GB free on $BUILD (need ${MIN_FREE_GB})"
  fetch_src "$tag"
  for b in $list; do build_one "$tag" "$b" "${jobs:-$(auto_jobs "$b")}"; done
  echo "DONE $tag [$list] — next: bench/model-bench/compare_builds.py run --new $tag"
}

cmd_promote() {
  local ver=${1:-} be=both list b prev target_dir
  [ -n "$ver" ] || die "usage: promote VER [--backend vulkan|rocm|both]"; shift
  while [ $# -gt 0 ]; do case $1 in --backend) be=$2; shift 2 ;; *) die "unknown promote arg: $1" ;; esac; done
  list=$(parse_backend "$be")
  for b in $list; do   # validate every target before flipping any link
    # For Vulkan, find SDK-versioned dir; for ROCm, use standard name
    if [ "$b" = "vulkan" ]; then
      # Find the Vulkan build dir (may have SDK version suffix)
      local candidates
      candidates=$(ls -1d "$BUILD"/$ver-vulkan* 2>/dev/null | head -1)
      [ -n "$candidates" ] && [ -x "$candidates/bin/llama-server" ] || die "not built: no $ver-vulkan* in builds/"
      target_dir=$(basename "$candidates")
    else
      target_dir="$ver-$b"
      [ -x "$BUILD/$target_dir/bin/llama-server" ] || die "not built: build/$ver-$b"
    fi
    [ -e "$BUILD/latest-$b" ] && [ ! -L "$BUILD/latest-$b" ] && die "build/latest-$b is not a symlink"
  done
  for b in $list; do
    # Re-resolve target_dir
    if [ "$b" = "vulkan" ]; then
      local candidates
      candidates=$(ls -1d "$BUILD"/$ver-vulkan* 2>/dev/null | head -1)
      target_dir=$(basename "$candidates")
    else
      target_dir="$ver-$b"
    fi
    prev=$(readlink "$BUILD/latest-$b" 2>/dev/null || echo "<none>")
    ln -sfn "$target_dir" "$BUILD/latest-$b"
    echo "[$b] latest-$b: $prev → $target_dir  ($(version_line "$BUILD/latest-$b"))"
  done
  echo "llama-swap serves it from the next model load; a running model keeps the old binary until unloaded (curl -s http://127.0.0.1:9292/unload)."
}

cmd_status() {
  local b link
  echo "newest upstream tag: $(latest_tag 2>/dev/null || echo '? (offline)')"
  for b in vulkan rocm; do
    link="$BUILD/latest-$b"
    if [ -L "$link" ]; then echo "latest-$b → $(readlink "$link")  [$(version_line "$link")]"
    else echo "latest-$b: <unset>"; fi
  done
  echo "builds in $BUILD:"; ls -1 "$BUILD" 2>/dev/null | grep -v '^latest-' | sed 's/^/  /' || true
  echo "disk free: $(df -h --output=avail "$BUILD" | tail -1 | tr -d ' ')"
  echo "Vulkan SDK: $($SDK_SETUP check 2>&1 || echo 'missing')"
}

case "${1:-}" in
  status)     cmd_status ;;
  latest-tag) latest_tag ;;
  build)      shift; cmd_build "$@" ;;
  promote)    shift; cmd_promote "$@" ;;
  *)          sed -n '2,17p' "$0"; exit 1 ;;
esac

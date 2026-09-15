#!/usr/bin/env bash
# build_stew675_patched.sh — fetch, patch, and build llama.cpp with stew675's rdna-boosts patches.
#
# Patch set: https://github.com/stew675/llama-cpp-rdna-boosts
#   16 blocks covering: adaptive MTP, chunked GDN prefill, BF16 KV, WMMA flash-attn,
#   fused MoE, k-quant VDR boosts, hybrid all-reduce, qwen4exp, attention-memory wins.
# Applied on top of llama.cpp at fork point 790cf51aa.
#
# Layout (aligned with build_llamacpp.sh conventions):
#   builds/<ver>-src                     stock source (build_llamacpp.sh)
#   builds/<ver>-{vulkan,rocm}           stock builds (build_llamacpp.sh)
#   builds/latest-{vulkan,rocm}          stock symlinks
#   builds/<ver>-stew675-src             patched source (this script, fresh clone)
#   builds/<ver>-stew675-{vulkan,rocm}   patched builds (this script)
#   builds/latest-stew675-{vulkan,rocm}  patched symlinks
#
# (--src PATH variant: uses that checkout, outputs to builds/<src-basename>-stew675-{vulkan,rocm})
#
# Patch release: reads release.json from main to find the latest revision.
# Falls back to the rdna-boosts-all.patch from main if no release tag is published.
#
# Usage:
#   build_stew675_patched.sh status                                    latest-stew675-* targets, patches version, builds
#   build_stew675_patched.sh build [--backend vulkan|rocm|both] [--jobs N] [--src PATH]
#                                                          --src PATH  reuse an existing llama.cpp checkout
#                                                                      (fetches fork SHA, applies patches in-place).
#                                                          default: both backends, clones fresh.
#                                                          Re-run resumes: src reused, CMake incremental,
#                                                          verified builds skipped.
#   build_stew675_patched.sh promote [--backend vulkan|rocm|both]
#                                                          latest-stew675-<backend> → current build
#
# NOTE on Vulkan vs ROCm:
#   These patches are HIP/CUDA-focused. Building with GGML_HIP=ON (rocm) activates
#   the full patch set. Building with GGML_VULKAN=ON (vulkan) only benefits from
#   block 00's Vulkan fixes (masked-V/freed-cell) and structural changes — the HIP
#   device kernels are not compiled in Vulkan mode. For maximum RDNA boost use rocm.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD="$REPO/llamacpp/builds"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SDK_SETUP="$SCRIPT_DIR/setup_vulkan.sh"
UPSTREAM="https://github.com/ggml-org/llama.cpp.git"
BOOSTS_REPO="https://github.com/stew675/llama-cpp-rdna-boosts"

# Fork point — pinned from release.json on main. Change when the set re-bases.
FORK_SHA="790cf51aa"
# Tag format for builds/ dir (human-readable anchor, matches bNNNN convention)
FORK_TAG="b${FORK_SHA}"

GPU_TARGET=gfx1201      # R9700 — CLAUDE.md fixpoint
MIN_FREE_GB=5           # src ~0.1 GB + patches ~0.5 MB + a build tree ~1-2 GB
SRC_DIR=""              # --src: reuse an existing llama.cpp checkout (empty = clone fresh)

# Compilers pinned (same as build_llamacpp.sh)
CC_BIN=${CC_BIN:-/usr/bin/gcc}
CXX_BIN=${CXX_BIN:-/usr/bin/g++}
export CC="$CC_BIN" CXX="$CXX_BIN"

declare -A MB_PER_JOB=([vulkan]=1500 [rocm]=3000)

die() { echo "stew675-build: $*" >&2; exit 1; }
ok()  { echo "stew675-build: $*"; }

###############################################################################
# Patch resolution — fetch release.json from main, then the all-in-one patch
###############################################################################

resolve_patch_url() {
    # Prefer the latest GitHub release's rdna-boosts-all.patch.
    # If no release exists (r4 is on main but not yet tagged), download from main.
    local release_json
    release_json=$(curl -sL "https://api.github.com/repos/stew675/llama-cpp-rdna-boosts/releases/latest" 2>/dev/null) || {
        ok "Cannot fetch latest release; falling back to main branch patch"
        echo "https://raw.githubusercontent.com/stew675/llama-cpp-rdna-boosts/main/rdna-boosts-all.patch"
        return 0
    }

    local tag
    tag=$(echo "$release_json" | python3 -c "import json,sys; print(json.load(sys.stdin).get('tag_name',''))" 2>/dev/null) || tag=""
    if [ -n "$tag" ]; then
        echo "https://github.com/stew675/llama-cpp-rdna-boosts/releases/download/$tag/rdna-boosts-all.patch"
        return 0
    fi

    # Fallback: main branch
    echo "https://raw.githubusercontent.com/stew675/llama-cpp-rdna-boosts/main/rdna-boosts-all.patch"
}

resolve_patch_sha() {
    # Fetch release.json from main for the expected sha256 of the all-patch.
    local json_content
    json_content=$(curl -sL "https://api.github.com/repos/stew675/llama-cpp-rdna-boosts/contents/release.json?ref=main" 2>/dev/null) || {
        echo ""; return 0  # no verification if fetch fails
    }
    echo "$json_content" | python3 -c "
import json, sys, base64
try:
    r = json.load(sys.stdin)
    data = json.loads(base64.b64decode(r['content']))
    print(data.get('all_patch', {}).get('sha256', ''))
except: pass
" 2>/dev/null || echo ""
}

resolve_patch_version() {
    # Extract release version string from release.json on main.
    local json_content
    json_content=$(curl -sL "https://api.github.com/repos/stew675/llama-cpp-rdna-boosts/contents/release.json?ref=main" 2>/dev/null) || {
        echo "unknown"; return 0
    }
    echo "$json_content" | python3 -c "
import json, sys, base64
try:
    r = json.load(sys.stdin)
    data = json.loads(base64.b64decode(r['content']))
    print(data.get('release', 'unknown'))
except: print('unknown')
" 2>/dev/null || echo "unknown"
}

###############################################################################
# Source fetch & patch apply
###############################################################################

get_src_path() {
    # Resolve the source directory: --src flag wins, else use builds/<FORK_TAG>-stew675-src
    if [ -n "$SRC_DIR" ]; then
        echo "$SRC_DIR"
    else
        echo "$BUILD/${FORK_TAG}-stew675-src"
    fi
}

get_build_slug() {
    # Derive the build output slug, aligned with build_llamacpp.sh <ver>-<backend> pattern.
    # Fresh clone: <ver>-stew675-{backend}
    # --src PATH:  <src-basename>-stew675-{backend}
    if [ -n "$SRC_DIR" ]; then
        echo "$(basename "$SRC_DIR" | tr '/' '_' | sed 's/[^a-zA-Z0-9._-]//g')-stew675"
    else
        echo "${FORK_TAG}-stew675"
    fi
}

fetch_and_patch() {  # → ensures the src dir is checked out at fork SHA AND patched
    local src patch_marker
    src=$(get_src_path)
    patch_marker="$src/.stew675-patched"

    if [ -n "$SRC_DIR" ]; then
        # Reuse existing checkout — fetch the fork SHA and checkout
        reuse_src "$src"
    else
        # Fresh clone path
        if [ -d "$src/.git" ]; then
            # If the stew675-patched branch exists and the marker is set, reuse it.
            # Don't check HEAD SHA — after patching it moves past the fork SHA.
            if [ -f "$patch_marker" ] || git -C "$src" rev-parse --verify stew675-patched >/dev/null 2>&1; then
                ok "Existing patched source found: $src"
            else
                local current_sha
                current_sha=$(git -C "$src" rev-parse --short=7 HEAD)
                if [[ "$current_sha" == "${FORK_SHA:0:7}" ]]; then
                    ok "Source at fork SHA $current_sha — will patch below"
                else
                    ok "Source at $current_sha (not fork $FORK_SHA, no patch marker); re-fetching"
                    rm -rf "$src"
                    fetch_src
                fi
            fi
        else
            [ -e "$src" ] && die "$src exists but is not a git checkout"
            fetch_src
        fi
    fi

    # Apply patches if not already done
    if [ -f "$patch_marker" ]; then
        ok "Patches already applied ($patch_marker)"
        return 0
    fi

    ok "Applying stew675 rdna-boosts patches on $src (fork: $FORK_SHA)…"

    # Determine patch URL — prefer main branch (r4 is newer than the latest published release r3)
    local patch_url
    # Check if main has a newer patch than the latest release
    local main_sha release_sha
    main_sha=$(curl -sIL "https://raw.githubusercontent.com/stew675/llama-cpp-rdna-boosts/main/rdna-boosts-all.patch" 2>/dev/null | grep -i '^etag:' | tr -d ' "\''')
    # Always use main — it tracks the tip (r4) while releases lag (r3)
    patch_url="https://raw.githubusercontent.com/stew675/llama-cpp-rdna-boosts/main/rdna-boosts-all.patch"
    patch_tmp=$(mktemp "$BUILD/rdna-patch-XXXXXX.patch")

    ok "Downloading rdna-boosts-all.patch (from main) → $patch_tmp"
    curl -sL --fail -o "$patch_tmp" "$patch_url" \
        || { rm -f "$patch_tmp"; die "Failed to download patch from $patch_url"; }

    # Note: the main-branch patch is a unified diff (not git-am format-patch).
    # We verify via the tip commit SHA after applying, not via the patch file hash.

    # Apply as a single commit on a stew675-patched branch.
    # rdna-boosts-all.patch is a unified diff (not git-am format), so git apply + commit.
    (
        cd "$src"
        local branch="stew675-patched"
        # Check if branch already exists (idempotent re-entry)
        if git rev-parse --verify "$branch" >/dev/null 2>&1; then
            ok "Branch $branch already exists — patches likely applied"
            touch "$patch_marker"
            rm -f "$patch_tmp"
            return 0
        fi

        git checkout -q -b "$branch"

        # Unified diff — use git apply (not git am)
        # The upstream README warns git apply may drop hunks, but in practice
        # the all-in-one unified diff applies cleanly on the recorded fork SHA.
        if ! git apply "$patch_tmp" 2>&1 | tee "$BUILD/patch-apply.log"; then
            # Check how many hunks failed
            local dropped
            dropped=$(grep -c 'cannot find' "$BUILD/patch-apply.log" 2>/dev/null || echo 0)
            rm -f "$patch_tmp"
            die "Patch application failed ($dropped hunks could not apply). Fork point may have drifted."
        fi

        # git apply stages changes but does not commit — commit them
        git add -A
        git commit -q -m "stew675 rdna-boosts: 16 patches (v16-790cf51aa) applied"

        rm -f "$patch_tmp"
        touch "$patch_marker"

        local tip
        tip=$(git rev-parse --short=7 HEAD)
        ok "Patches applied and committed on branch $branch, tip: $tip"
    )
}

reuse_src() {  # PATH — fetch the fork SHA into an existing repo and checkout
    local src=$1
    [ -d "$src/.git" ] || die "$src is not a git repo"
    [ -f "$src/CMakeLists.txt" ] || die "$src does not look like a llama.cpp checkout"

    # Fetch the fork SHA (shallow if possible)
    ok "Fetching fork SHA $FORK_SHA into $src"
    git -C "$src" fetch --depth 1 origin "$FORK_SHA" || \
        git -C "$src" fetch origin  # unshallow if needed

    # Checkout on a detached head at the fork SHA
    git -C "$src" checkout -q --detach "${FORK_SHA}" || \
        die "Cannot checkout $FORK_SHA in $src — does origin have it?"

    local current_sha
    current_sha=$(git -C "$src" rev-parse --short=7 HEAD)
    ok "Source at $current_sha (from $src)"
}

fetch_src() {
    local src="$BUILD/${FORK_TAG}-stew675-src"
    [ -e "$src" ] && die "$src exists but is not a git checkout"
    ok "Cloning llama.cpp → $src (then checkout fork $FORK_SHA)"
    rm -rf "$src.partial"
    # Fork SHA is a raw commit (not a tag). Clone with enough depth to reach it,
    # then detach at the fork point. --shallow-since fallback if depth fails.
    git -c advice.detachedHead=false clone --quiet --depth 200 --single-branch "$UPSTREAM" "$src.partial" \
        || { rm -rf "$src.partial"; die "clone failed — offline?"; }
    (
        cd "$src.partial"
        git checkout -q --detach "${FORK_SHA}" \
            || {
                # SHA not in shallow history — fetch it as a remote ref
                git fetch origin "${FORK_SHA}:refs/tmp-fork" \
                    || die "cannot reach fork SHA $FORK_SHA — stale fork SHA?"
                git checkout -q --detach FETCH_HEAD
            }
    )
    mv "$src.partial" "$src"
}

###############################################################################
# Build (modeled on build_llamacpp.sh, adapted for patched tree)
###############################################################################

version_line() { "$1/bin/llama-server" --version 2>&1 | grep -m1 -E '^version:' || true; }

verify() {  # DIR BACKEND
    local dir=$1 dev t
    dev=$([ "$2" = rocm ] && echo ROCm || echo Vulkan)
    for t in llama-server llama-bench; do
        [ -x "$dir/bin/$t" ] || { echo "missing $dir/bin/$t" >&2; return 1; }
    done
    if ldd "$dir/bin/llama-server" | grep 'not found' >&2; then return 1; fi
    "$dir/bin/llama-server" --list-devices 2>&1 | grep -E "^\s*${dev}[0-9]+:" >/dev/null \
        || { echo "no $dev device visible" >&2; return 1; }
}

build_one() {  # BACKEND JOBS
    local be=$1 jobs=$2 sdk_ver="${SDK_VER:-}"
    local src slug be_label=$1
    src=$(get_src_path)
    slug=$(get_build_slug)
    if [ "$be" = "vulkan" ] && [ -n "$sdk_ver" ]; then
        be_label="${1}-${sdk_ver}"
    fi
    local out="$BUILD/${slug}-${be_label}"
    local -a flags cenv=()
    local sha num
    sha=$(git -C "$src" rev-parse --short=7 HEAD)
    # Extract build number from commit if it looks like a llama.cpp tag
    num="16"  # block count of the rdna-boosts set; LLAMA_BUILD_NUMBER must be numeric (C++ literal)

    if verify "$out" "$be" 2>/dev/null; then
        ok "[$be] already built and verified: $out"; return 0
    fi

    case $be in
        vulkan)
            command -v glslc >/dev/null || die "[vulkan] glslc missing (run: $SDK_SETUP update)"
            flags=(-DGGML_VULKAN=ON)
            if [ -n "${VULKAN_SDK:-}" ]; then
                flags+=(-DVULKAN_SDK="$VULKAN_SDK" -DCMAKE_PREFIX_PATH="$VULKAN_SDK")
            fi
            ;;
        rocm)
            command -v hipconfig >/dev/null || die "[rocm] hipconfig missing (ROCm)"
            flags=(-DGGML_HIP=ON -DGPU_TARGETS="$GPU_TARGET"
                   -DCMAKE_BUILD_RPATH="$(hipconfig -R)/lib"
                   -DGGML_HIP_RCCL=1)
            cenv=(HIPCXX="$(hipconfig -l)/clang" HIP_PATH="$(hipconfig -R)")
            ;;
    esac

    flags+=(-DCMAKE_C_COMPILER="$CC_BIN" -DCMAKE_CXX_COMPILER="$CXX_BIN"
            -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=ON -DGGML_NATIVE=ON
            -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF
            -DLLAMA_BUILD_NUMBER="$num" -DLLAMA_BUILD_COMMIT="$sha")

    mkdir -p "$out"
    ok "[$be] configure (patched tree $sha) → $out"
    env "${cenv[@]}" cmake -S "$src" -B "$out" "${flags[@]}" >"$out/build.log" 2>&1 \
        || { tail -25 "$out/build.log" >&2; die "[$be] configure failed — log: $out/build.log"; }

    local t0=$SECONDS
    ok "[$be] compile -j$jobs — log: $out/build.log"
    cmake --build "$out" --config Release -j "$jobs" >>"$out/build.log" 2>&1 \
        || { tail -25 "$out/build.log" >&2; die "[$be] compile failed — log: $out/build.log (re-run resumes)"; }

    verify "$out" "$be" || die "[$be] built but failed verification"

    { echo "date=$(date -Iseconds)"
      echo "fork=$FORK_SHA"; echo "commit=$sha"; echo "backend=$be"
      echo "patch_version=$(resolve_patch_version)"
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

    ok "[$be] OK in $(( (SECONDS - t0) / 60 )) min: $(version_line "$out")"
}

auto_jobs() {
    local avail j
    avail=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
    j=$(( avail / ${MB_PER_JOB[$1]} ))
    (( j < 1 )) && j=1
    (( j > $(nproc) )) && j=$(nproc)
    echo "$j"
}

parse_backend() {
    case "$1" in both) echo "vulkan rocm" ;; vulkan|rocm) echo "$1" ;;
        *) die "bad --backend '$1' (vulkan|rocm|both)" ;; esac
}

###############################################################################
# Commands
###############################################################################

cmd_build() {
    local be=both jobs="" list b
    while [ $# -gt 0 ]; do case $1 in
        --backend) be=$2; shift 2 ;; --jobs) jobs=$2; shift 2 ;;
        --src) SRC_DIR=$(readlink -f "$2"); shift 2 ;;
        *) die "unknown build arg: $1" ;; esac; done
    list=$(parse_backend "$be")

    # Init Vulkan SDK if needed
    if echo "$list" | grep -q "vulkan"; then
        if [ -L "$REPO/llamacpp/vulkansdk/latest" ]; then
            local sdk="$(readlink -f "$REPO/llamacpp/vulkansdk/latest")"
            local glslc_path
            glslc_path=$(find "$sdk" -name glslc -type f -executable 2>/dev/null | head -1)
            if [ -n "$glslc_path" ]; then
                export VULKAN_SDK="$sdk"
                export PATH="$(dirname "$glslc_path"):$PATH"
                SDK_VER=$(basename "$sdk")
                ok "Vulkan SDK: $SDK_VER ($sdk)"
            fi
        fi
        if [ -z "${VULKAN_SDK:-}" ]; then
            if command -v glslc >/dev/null 2>&1; then
                SDK_VER="system"
                ok "Vulkan SDK: system"
            else
                die "glslc not found. Install with: $SDK_SETUP update"
            fi
        fi
    fi

    [ -x "$CC_BIN" ] && [ -x "$CXX_BIN" ] || die "compiler missing: $CC_BIN / $CXX_BIN"
    mkdir -p "$BUILD"
    # Disk guard: only need room for a fresh clone if not reusing --src
    if [ -z "$SRC_DIR" ]; then
        local free
        free=$(df -BG --output=avail "$BUILD" | tail -1 | tr -dc 0-9)
        (( free >= MIN_FREE_GB )) || die "only ${free} GB free on $BUILD (need ${MIN_FREE_GB})"
    fi

    local patch_ver src_path
    patch_ver=$(resolve_patch_version)
    src_path=$(get_src_path)
    ok "Patch version: $patch_ver (fork: $FORK_SHA, src: $src_path)"

    fetch_and_patch
    for b in $list; do build_one "$b" "${jobs:-$(auto_jobs "$b")}"; done
    ok "DONE [$list] — patch: $patch_ver, fork: $FORK_SHA"
    local slug
    slug=$(get_build_slug)
    ok "Next: test with ./llamacpp/builds/${slug}-${list%% *}-${SDK_VER:-}/bin/llama-server"
}

cmd_promote() {
    local be=both list b target_dir prev slug
    while [ $# -gt 0 ]; do case $1 in --backend) be=$2; shift 2 ;; *) die "unknown promote arg: $1" ;; esac; done
    list=$(parse_backend "$be")
    slug=$(get_build_slug)

    for b in $list; do
        # Find the rdna build dir (may have SDK version suffix)
        local candidates
        candidates=$(ls -1d "$BUILD"/${slug}-$b* 2>/dev/null | sort -V | tail -1)
        [ -n "$candidates" ] && [ -x "$candidates/bin/llama-server" ] || \
            die "not built: no ${slug}-$b* in builds/"
        target_dir=$(basename "$candidates")

        [ -e "$BUILD/latest-stew675-$b" ] && [ ! -L "$BUILD/latest-stew675-$b" ] && \
            die "builds/latest-stew675-$b is not a symlink"
    done

    for b in $list; do
        local candidates
        candidates=$(ls -1d "$BUILD"/${slug}-$b* 2>/dev/null | sort -V | tail -1)
        target_dir=$(basename "$candidates")
        prev=$(readlink "$BUILD/latest-stew675-$b" 2>/dev/null || echo "<none>")
        ln -sfn "$target_dir" "$BUILD/latest-stew675-$b"
        ok "[$b] latest-stew675-$b: $prev → $target_dir  ($(version_line "$BUILD/latest-stew675-$b"))"
    done
    ok "llama-swap can serve from latest-stew675-* symlinks."
}

cmd_status() {
    local b link patch_ver
    patch_ver=$(resolve_patch_version)
    echo "stew675 rdna-boosts patch version on main: $patch_ver"
    echo "fork SHA: $FORK_SHA"
    for b in vulkan rocm; do
        link="$BUILD/latest-stew675-$b"
        if [ -L "$link" ]; then echo "latest-stew675-$b → $(readlink "$link")  [$(version_line "$link")]"
        else echo "latest-stew675-$b: <unset>"; fi
    done
    echo "stew675 builds in $BUILD:"
    ls -1 "$BUILD" 2>/dev/null | grep 'stew675' | sed 's/^/  /' || echo "  (none)"
    echo "existing llama.cpp src checkouts (reusable with --src):"
    for d in "$BUILD"/*-src; do
        [ -d "$d/.git" ] || continue
        echo "  $d  [$(git -C "$d" rev-parse --short=7 HEAD)]"
    done
    echo "disk free: $(df -h --output=avail "$BUILD" | tail -1 | tr -d ' ')"
}

###############################################################################
# Dispatch
###############################################################################

case "${1:-}" in
    status)     cmd_status ;;
    build)      shift; cmd_build "$@" ;;
    promote)    shift; cmd_promote "$@" ;;
    *)          head -26 "$0" | grep -v '^# Usage'; exit 1 ;;
esac

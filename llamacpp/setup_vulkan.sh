#!/usr/bin/env bash
# setup_vulkan.sh — manage self-contained Vulkan SDK under llamacpp/vulkansdk/
#
# Uses the official Lunarg Vulkan SDK (https://vulkan.lunarg.com/sdk/home).
# Latest version via: https://vulkan.lunarg.com/sdk/latest/linux.txt
# Download: https://sdk.lunarg.com/sdk/download/latest/linux/vulkan_sdk.tar.xz (~314MB, .tar.xz)
# SHA verify: https://sdk.lunarg.com/sdk/sha/latest/linux/vulkan_sdk.tar.xz.txt
#
# Commands:
#   setup_vulkan.sh status             show installed vs latest available
#   setup_vulkan.sh check              verify SDK installed + glslc works, exit 0/1
#   setup_vulkan.sh update [VERSION]   download & install latest (or specific) SDK
#
# SDK layout after install:
#   llamacpp/vulkansdk/1.4.357.1/     ← versioned directory
#   llamacpp/vulkansdk/latest → 1.4.357.1

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
SDK_BASE="$REPO/llamacpp/vulkansdk"
DOWNLOADS="$SDK_BASE/.downloads"
CACHE_TARBALL="$DOWNLOADS/vulkan_sdk.tar.xz"

# Official Lunarg API
LATEST_VER_URL="https://vulkan.lunarg.com/sdk/latest/linux.txt"
DOWNLOAD_URL="https://sdk.lunarg.com/sdk/download"
SHA_URL="https://sdk.lunarg.com/sdk/sha"

die() { echo "setup_vulkan: $*" >&2; exit 1; }
ok()  { echo "setup_vulkan: $*"; }

##############################################################################
# Version resolution
##############################################################################

installed_version() {
    local latest="$SDK_BASE/latest"
    [ -L "$latest" ] && basename "$(readlink -f "$latest")" || echo ""
}

latest_available() {
    local ver
    ver=$(curl -sf --max-time 15 "$LATEST_VER_URL" 2>/dev/null) || {
        echo "??"
        return 1
    }
    echo "$ver"
}

##############################################################################
# Download + install
##############################################################################

download_sdk() {  # VER
    local ver=$1
    mkdir -p "$DOWNLOADS"

    # Reuse cached tarball if SHA matches
    if [ -f "$CACHE_TARBALL" ]; then
        local cached_sha expected_sha
        cached_sha=$(sha256sum "$CACHE_TARBALL" | awk '{print $1}')
        expected_sha=$(curl -sf --max-time 15 "${SHA_URL}/${ver}/linux/vulkan_sdk.tar.xz.txt" 2>/dev/null | awk '{print $1}') || true
        if [ -n "$expected_sha" ] && [ "$cached_sha" = "$expected_sha" ]; then
            ok "using cached tarball (SHA verified)"
            return 0
        fi
        ok "cached tarball SHA mismatch — re-downloading"
    fi

    ok "Downloading Vulkan SDK $ver (~314MB)..."
    # Use versioned URL; append ?Human=true to avoid rate limiting
    curl -L --progress-bar --max-time 600 \
        -o "$CACHE_TARBALL" \
        "${DOWNLOAD_URL}/${ver}/linux/vulkan_sdk.tar.xz?Human=true" \
        || die "download failed for SDK $ver"
    [ -s "$CACHE_TARBALL" ] || die "download produced empty file"

    # Verify SHA
    local actual_sha expected_sha
    actual_sha=$(sha256sum "$CACHE_TARBALL" | awk '{print $1}')
    expected_sha=$(curl -sf --max-time 15 "${SHA_URL}/${ver}/linux/vulkan_sdk.tar.xz.txt" 2>/dev/null | awk '{print $1}') || true
    if [ -n "$expected_sha" ]; then
        if [ "$actual_sha" != "$expected_sha" ]; then
            die "SHA mismatch: expected $expected_sha, got $actual_sha"
        fi
        ok "SHA256 verified"
    else
        ok "SHA verification skipped (could not fetch expected hash)"
    fi
}

install_sdk() {  # VER
    local ver=$1
    local target="$SDK_BASE/$ver"

    [ -d "$target" ] && { ok "SDK $ver already installed — skipping"; return 0; }

    ok "Extracting SDK $ver → $target ..."
    local partial="$target.partial"
    rm -rf "$partial"
    mkdir -p "$partial"
    tar -xJf "$CACHE_TARBALL" -C "$partial" --strip-components=1 \
        || { rm -rf "$partial"; die "extraction failed"; }
    mv "$partial" "$target"

    # Update latest symlink
    ln -sfn "$ver" "$SDK_BASE/latest"

    # Smoke test: verify glslc exists
    local glslc
    glslc=$(find "$target" -name glslc -type f -executable 2>/dev/null | head -1)
    [ -n "$glslc" ] || die "glslc not found after extracting SDK $ver"
    ok "SDK $ver installed (glslc: $glslc)"
}

##############################################################################
# Commands
##############################################################################

cmd_status() {
    local installed available
    installed=$(installed_version)
    available=$(latest_available) || available="?? (offline)"
    echo "Installed: ${installed:-(none)}"
    echo "Available: $available"
    if [ -n "$installed" ] && [ "${available%%.*}" != "?" ]; then
        if [ "$installed" = "$available" ]; then
            echo "Status: UP-TO-DATE"
        else
            echo "Status: UPDATE AVAILABLE ($installed → $available)"
        fi
    fi

    if [ -L "$SDK_BASE/latest" ]; then
        local sdk="$(readlink -f "$SDK_BASE/latest")"
        echo ""
        echo "SDK root: $sdk"
        ls "$sdk" 2>/dev/null | head -8 | sed 's/^/  /'
        local glslc
        glslc=$(find "$sdk" -name glslc -type f -executable 2>/dev/null | head -1)
        [ -n "$glslc" ] && echo "  glslc: $( "$glslc" --version 2>&1 | head -1 )"
    fi
}

cmd_check() {
    local ver
    ver=$(installed_version)
    if [ -z "$ver" ]; then
        # Fallback: system glslc
        if command -v glslc >/dev/null 2>&1; then
            ok "No local SDK; system glslc available: $(glslc --version 2>&1 | head -1)"
            return 0
        fi
        die "No Vulkan SDK installed. Run: $0 update"
    fi

    local sdk="$(readlink -f "$SDK_BASE/latest")"
    local glslc
    glslc=$(find "$sdk" -name glslc -type f -executable 2>/dev/null | head -1)
    if [ -z "$glslc" ]; then
        # Fallback to system
        if command -v glslc >/dev/null 2>&1; then
            ok "SDK $ver installed but no glslc found; falling back to system glslc"
            return 0
        fi
        die "SDK $ver installed but glslc not found"
    fi
    ok "Vulkan SDK $ver (glslc: $( "$glslc" --version 2>&1 | head -1 ))"
    return 0
}

cmd_update() {
    local ver="${1:-}"
    if [ -z "$ver" ]; then
        ver=$(latest_available) || die "cannot determine latest version (offline?)"
        local installed
        installed=$(installed_version)
        if [ "$installed" = "$ver" ]; then
            ok "Already at latest ($ver). Pass a version to force reinstall."
            return 0
        fi
        echo "Latest available: $ver (installed: ${installed:-none})"
    fi
    download_sdk "$ver"
    install_sdk "$ver"
    cmd_check
}

##############################################################################

case "${1:-status}" in
    status)  cmd_status  ;;
    check)   cmd_check   ;;
    update)  shift; cmd_update "${1:-}" ;;
    *)       echo "Usage: $0 {status|check|update [VERSION]}"; exit 1 ;;
esac

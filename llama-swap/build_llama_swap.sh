#!/usr/bin/env bash
# Build a patched llama-swap and install it to ~/.local/bin/llama-swap.
#
# Steps:
#   1. Ensure a Go toolchain (uses system go >= 1.27, else downloads one
#      into .go-toolchain/ next to this script).
#   2. Apply derive-stream-rates.patch to llama-swap/llama-swap/ (idempotent:
#      skipped when already applied; fails if the tree is in a mixed state).
#      The patch derives prefill/decode rates on the proxy side for backends
#      that report token counts but no timings object (llama.cpp's Anthropic
#      /v1/messages), so the activity table shows real rates instead of
#      "unknown".
#   3. go vet + go test -short ./... (the project's own gate, minus staticcheck).
#   4. Build the web UI if missing (npm install + vite build into
#      internal/server/ui_dist) and compile the linux-amd64 binary with
#      -tags embed_ui, same ldflags as the Makefile's linux-amd64 target.
#   5. Back up the current ~/.local/bin/llama-swap and install the new one.
#
# The running llama-swap instance is NOT touched or restarted — it keeps its
# own binary inode until you restart it yourself:
#     kill <pid> && llama-swap -config ~/.config/llama-swap/config.yaml \
#         -listen :9292 -watch-config &
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$SCRIPT_DIR/llama-swap"
PATCH="$SCRIPT_DIR/derive-stream-rates.patch"
INSTALL_BIN="${HOME}/.local/bin/llama-swap"
GO_VERSION="1.27.1"
TOOLCHAIN_DIR="$SCRIPT_DIR/.go-toolchain"

log() { echo ">> $*"; }

# --- 1. Go toolchain ---------------------------------------------------------
GO_CMD=""
if command -v go >/dev/null 2>&1; then
    v="$(go env GOVERSION | sed 's/^go//')"
    if [ "$(printf '%s\n%s\n' "1.27" "$v" | sort -V | head -n1)" = "1.27" ]; then
        GO_CMD="go"
    fi
fi
if [ -z "$GO_CMD" ] && [ -x "$TOOLCHAIN_DIR/bin/go" ]; then
    GO_CMD="$TOOLCHAIN_DIR/bin/go"
fi
if [ -z "$GO_CMD" ]; then
    log "Installing Go $GO_VERSION into $TOOLCHAIN_DIR"
    mkdir -p "$TOOLCHAIN_DIR"
    tmp="$(mktemp)"
    curl -fsSL -o "$tmp" "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz"
    tar -C "$TOOLCHAIN_DIR" --strip-components=1 -xzf "$tmp"
    rm -f "$tmp"
    GO_CMD="$TOOLCHAIN_DIR/go/bin/go"
fi
log "Using $($GO_CMD version)"

# --- 2. Apply the patch (idempotent) ----------------------------------------
cd "$SRC_DIR"
if git apply --check "$PATCH" 2>/dev/null; then
    log "Applying $(basename "$PATCH")"
    git apply "$PATCH"
elif git apply --check --reverse "$PATCH" 2>/dev/null; then
    log "Patch already applied, skipping"
else
    echo "ERROR: $PATCH neither applies nor is already applied." >&2
    echo "       The source tree is in a mixed state — inspect with: git -C $SRC_DIR status/diff" >&2
    exit 1
fi

# --- 3. Vet + tests ----------------------------------------------------------
log "go vet ./..."
"$GO_CMD" vet ./...
log "go test -short ./..."
"$GO_CMD" test -short ./...

# --- 4. UI + binary build ----------------------------------------------------
if [ ! -f internal/server/ui_dist/index.html ]; then
    log "Building web UI (npm install + vite build)"
    (cd ui && npm install && npm run build)
fi

GIT_HASH="$(git rev-parse --short HEAD)"
[ -n "$(git status --porcelain)" ] && GIT_HASH="${GIT_HASH}+"
GIT_VERSION="$(git describe --abbrev=6 --tags 2>/dev/null || echo devel)"
BUILD_DATE="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

OUT="build/llama-swap-linux-amd64"
mkdir -p build
log "Building $OUT (version=$GIT_VERSION commit=$GIT_HASH date=$BUILD_DATE)"
GOOS=linux GOARCH=amd64 "$GO_CMD" build -tags embed_ui \
    -ldflags="-X main.commit=${GIT_HASH} -X main.version=${GIT_VERSION} -X main.date=${BUILD_DATE}" \
    -o "$OUT" .

# --- 5. Verify + install -----------------------------------------------------
log "Verifying new binary"
"./$OUT" --version

if [ -x "$INSTALL_BIN" ]; then
    backup="${INSTALL_BIN}.bak-$(date +%Y%m%d-%H%M%S)"
    log "Backing up current binary to $backup"
    cp -f "$INSTALL_BIN" "$backup"
fi
log "Installing to $INSTALL_BIN"
install -m 0755 "./$OUT" "$INSTALL_BIN"
"$INSTALL_BIN" --version

echo
echo "Done. The running llama-swap instance still uses the OLD binary until you"
echo "restart it (it keeps its own file inode). Restart with:"
echo "    kill <pid> && llama-swap -config ~/.config/llama-swap/config.yaml -listen :9292 -watch-config &"

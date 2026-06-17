#!/usr/bin/env bash
# EncoreHub build script — Linux / macOS / WSL
# Usage: ./scripts/build.sh [--skip-engine] [--skip-gateway] [--skip-frontend] [--debug] [--tauri]
#
# Examples:
#   ./scripts/build.sh                         # full release build (no installer)
#   ./scripts/build.sh --debug                 # debug build
#   ./scripts/build.sh --tauri                 # release + desktop installer
#   ./scripts/build.sh --skip-engine --skip-gateway  # frontend only

set -euo pipefail

# ---------- args ----------
SKIP_ENGINE=false
SKIP_GATEWAY=false
SKIP_FRONTEND=false
DEBUG_BUILD=false
TAURI_BUILD=false

for arg in "$@"; do
    case "$arg" in
        --skip-engine)   SKIP_ENGINE=true   ;;
        --skip-gateway)  SKIP_GATEWAY=true  ;;
        --skip-frontend) SKIP_FRONTEND=true ;;
        --debug)         DEBUG_BUILD=true   ;;
        --tauri)         TAURI_BUILD=true   ;;
        *) echo "Unknown arg: $arg"; exit 1 ;;
    esac
done

# ---------- resolve paths ----------
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CARGO_PROFILE=""
CARGO_TARGET="debug"
GO_LDFLAGS=""
TAURI_CMD="tauri build"

if [ "$DEBUG_BUILD" = false ]; then
    CARGO_PROFILE="--release"
    CARGO_TARGET="release"
    GO_LDFLAGS="-ldflags '-s -w'"
fi

BINARY_DIR="$REPO_ROOT/frontend/src-tauri/binaries"
ENGINE_SRC="$REPO_ROOT/engine/target/$CARGO_TARGET/encorehub-engine"
GATEWAY_SRC="$REPO_ROOT/gateway/bin/gateway"

# platform suffix for binaries
case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) ENGINE_SRC="${ENGINE_SRC}.exe"; GATEWAY_SRC="${GATEWAY_SRC}.exe" ;;
esac

# ---------- helpers ----------
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'

step()  { printf "\n${CYAN}>>> %s${NC}\n" "$1"; }
ok()    { printf "  ${GREEN}✓${NC} %s\n" "$1"; }
err()   { printf "  ${RED}✗${NC} %s\n" "$1"; exit 1; }
warn()  { printf "  ${YELLOW}⚠${NC} %s\n" "$1"; }

# ---------- preflight ----------
step "Checking prerequisites"
for cmd in node pnpm go cargo; do
    if command -v "$cmd" &>/dev/null; then
        ok "$cmd"
    else
        err "$cmd not found"
    fi
done

# ---------- engine ----------
if [ "$SKIP_ENGINE" = false ]; then
    step "Building engine (Rust)"
    ( cd "$REPO_ROOT/engine" && cargo build $CARGO_PROFILE ) || err "engine build failed"
    ok "engine built"
fi

# ---------- gateway ----------
if [ "$SKIP_GATEWAY" = false ]; then
    step "Building gateway (Go)"
    mkdir -p "$REPO_ROOT/gateway/bin"
    # shellcheck disable=SC2086
    ( cd "$REPO_ROOT/gateway" && go build ${GO_LDFLAGS:+"$GO_LDFLAGS"} -o bin/gateway ./cmd/gateway ) || err "gateway build failed"
    ok "gateway built"
fi

# ---------- frontend ----------
if [ "$SKIP_FRONTEND" = false ]; then
    step "Building frontend (TypeScript + Vite)"
    ( cd "$REPO_ROOT/frontend" && pnpm install --frozen-lockfile ) || err "pnpm install failed"

    if [ "$TAURI_BUILD" = false ]; then
        ( cd "$REPO_ROOT/frontend" && pnpm build ) || err "frontend build failed"
    fi
    ok "frontend built"
fi

# ---------- copy binaries for Tauri ----------
if [ "$TAURI_BUILD" = true ]; then
    step "Preparing external binaries for Tauri"
    mkdir -p "$BINARY_DIR"

    if [ -f "$ENGINE_SRC" ]; then
        cp -f "$ENGINE_SRC" "$BINARY_DIR/encorehub-engine$( [[ "$ENGINE_SRC" == *.exe ]] && echo .exe )"
        ok "copied engine binary"
    else
        warn "engine binary not found (skipped --skip-engine?), continuing"
    fi

    if [ -f "$GATEWAY_SRC" ]; then
        cp -f "$GATEWAY_SRC" "$BINARY_DIR/gateway$( [[ "$GATEWAY_SRC" == *.exe ]] && echo .exe )"
        ok "copied gateway binary"
    else
        warn "gateway binary not found (skipped --skip-gateway?), continuing"
    fi

    # ---------- Tauri bundle ----------
    step "Building Tauri desktop installer"
    ( cd "$REPO_ROOT/frontend" && pnpm tauri build ) || err "tauri build failed"
    ok "Tauri installer generated"
fi

printf "\n${GREEN}=== Build complete ===${NC}\n"
if [ "$TAURI_BUILD" = true ]; then
    echo "  MSI:   $REPO_ROOT/frontend/src-tauri/target/release/bundle/msi"
    echo "  NSIS:  $REPO_ROOT/frontend/src-tauri/target/release/bundle/nsis"
fi

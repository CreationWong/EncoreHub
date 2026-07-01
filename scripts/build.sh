#!/usr/bin/env bash
# EncoreHub build script — Linux / macOS / WSL
# Usage: ./scripts/build.sh [--skip-engine] [--skip-gateway] [--skip-frontend] [--debug] [--tauri] [--parallel] [--skip-install]
#
# Examples:
#   ./scripts/build.sh                         # full release build (no installer)
#   ./scripts/build.sh --debug                 # debug build (fast iteration)
#   ./scripts/build.sh --tauri                 # release + desktop installer
#   ./scripts/build.sh --parallel              # build engine + gateway concurrently
#   ./scripts/build.sh --skip-engine --skip-gateway  # frontend only
#   ./scripts/build.sh --skip-install          # skip pnpm install (offline / pre-installed)

set -euo pipefail

# ---------- args ----------
SKIP_ENGINE=false
SKIP_GATEWAY=false
SKIP_FRONTEND=false
DEBUG_BUILD=false
TAURI_BUILD=false
PARALLEL=false
SKIP_INSTALL=false

for arg in "$@"; do
    case "$arg" in
        --skip-engine)   SKIP_ENGINE=true   ;;
        --skip-gateway)  SKIP_GATEWAY=true  ;;
        --skip-frontend) SKIP_FRONTEND=true ;;
        --debug)         DEBUG_BUILD=true   ;;
        --tauri)         TAURI_BUILD=true   ;;
        --parallel)      PARALLEL=true      ;;
        --skip-install)  SKIP_INSTALL=true  ;;
        *) echo "Unknown arg: $arg"; exit 1 ;;
    esac
done

# ---------- resolve paths ----------
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CARGO_PROFILE=""
CARGO_TARGET="debug"
GO_LDFLAGS=()
TAURI_CMD="tauri build"

if [ "$DEBUG_BUILD" = false ]; then
    CARGO_PROFILE="--release"
    CARGO_TARGET="release"
    GO_LDFLAGS=(-ldflags "-s -w")
fi

BINARY_DIR="$REPO_ROOT/frontend/src-tauri/binaries"
ENGINE_BIN="encorehub-engine"
GATEWAY_BIN="gateway"

# platform suffix
case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*)
        ENGINE_BIN="${ENGINE_BIN}.exe"
        GATEWAY_BIN="${GATEWAY_BIN}.exe"
        ;;
esac

ENGINE_SRC="$REPO_ROOT/engine/target/$CARGO_TARGET/$ENGINE_BIN"
GATEWAY_SRC="$REPO_ROOT/gateway/bin/$GATEWAY_BIN"

# ---------- helpers ----------
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'

TIMINGS_FILE="$(mktemp)"

step()  { printf "\n${CYAN}── %s ──${NC}\n" "$1"; }
ok()    { printf "    ${GREEN}✔${NC} %s\n" "$1"; }
warn()  { printf "    ${YELLOW}⚠${NC} %s\n" "$1"; }
err()   { printf "    ${RED}✘${NC} %s\n" "$1"; exit 1; }

time_step() {
    local name="$1"; shift
    local start elapsed
    start=$(date +%s%3N 2>/dev/null || echo 0)
    "$@"
    elapsed=$(($(date +%s%3N 2>/dev/null || echo 0) - start))
    printf "%.2f|%s\n" "$(awk "BEGIN {printf \"%.2f\", $elapsed/1000}")" "$name" >> "$TIMINGS_FILE"
}

format_size() {
    local bytes=$1
    if command -v numfmt &>/dev/null; then
        numfmt --to=iec --suffix=B "$bytes" 2>/dev/null || echo "${bytes} B"
    else
        awk "BEGIN {s=$bytes; u=\"B\"; if(s>=1e6){s/=1e6;u=\"MB\"} else if(s>=1e3){s/=1e3;u=\"KB\"}; printf \"%.1f %s\", s, u}"
    fi
}

# ---------- preflight ----------
step "Prerequisites"
check_cmd() {
    local name="$1" skip="$2"
    if command -v "$name" &>/dev/null; then
        ok "$name"
    elif [ "$skip" = true ]; then
        warn "$name skipped (build disabled)"
    else
        err "$name not found in PATH"
    fi
}
check_cmd node  false
check_cmd pnpm  false
check_cmd go    "$SKIP_GATEWAY"
check_cmd cargo "$SKIP_ENGINE"

# ---------- engine ----------
build_engine() {
    if [ "$TAURI_BUILD" = true ]; then
        step "Engine (cargo check — Tauri builds in-process)"
        warn "engine binary is NOT a Tauri sidecar; checking lib only"
        (cd "$REPO_ROOT/engine" && cargo check $CARGO_PROFILE) || err "cargo check failed"
        ok "engine lib checked (in-process for Tauri)"
    else
        step "Engine (standalone binary)"
        (cd "$REPO_ROOT/engine" && cargo build --features standalone $CARGO_PROFILE) || err "cargo build failed"
        if [ -f "$ENGINE_SRC" ]; then
            ok "engine built ($(format_size $(wc -c < "$ENGINE_SRC")))"
        else
            ok "engine built"
        fi
    fi
}

# ---------- gateway ----------
build_gateway() {
    step "Gateway (Go)"
    mkdir -p "$REPO_ROOT/gateway/bin"
    (cd "$REPO_ROOT/gateway" && go build -trimpath "${GO_LDFLAGS[@]}" -o "bin/$GATEWAY_BIN" ./cmd/gateway) || err "go build failed"
    if [ -f "$GATEWAY_SRC" ]; then
        ok "gateway built ($(format_size $(wc -c < "$GATEWAY_SRC")))"
    else
        ok "gateway built"
    fi
}

# ---------- frontend ----------
build_frontend() {
    step "Frontend (TypeScript + Vite)"
    if [ "$SKIP_INSTALL" = false ]; then
        (cd "$REPO_ROOT/frontend" && pnpm install --frozen-lockfile) || err "pnpm install failed"
    fi
    if [ "$TAURI_BUILD" = false ]; then
        (cd "$REPO_ROOT/frontend" && pnpm build) || err "pnpm build failed"
    fi
    if [ -f "$REPO_ROOT/frontend/dist/index.html" ]; then
        ok "frontend built (dist/ ready)"
    else
        ok "frontend prepared (Tauri will build internally)"
    fi
}

# ---------- execute ----------
if [ "$PARALLEL" = true ] && [ "$SKIP_ENGINE" = false ] && [ "$SKIP_GATEWAY" = false ]; then
    # Engine + Gateway are independent — run them concurrently.
    time_step "engine"  build_engine &
    time_step "gateway" build_gateway &
    wait
    # Frontend depends on both (for Tauri sidecar copy), so run after.
    if [ "$SKIP_FRONTEND" = false ]; then
        time_step "frontend" build_frontend
    fi
else
    if [ "$SKIP_ENGINE" = false ]; then
        time_step "engine" build_engine
    fi
    if [ "$SKIP_GATEWAY" = false ]; then
        time_step "gateway" build_gateway
    fi
    if [ "$SKIP_FRONTEND" = false ]; then
        time_step "frontend" build_frontend
    fi
fi

# ---------- copy gateway sidecar + Tauri bundle ----------
if [ "$TAURI_BUILD" = true ]; then
    step "Tauri external binaries"
    mkdir -p "$BINARY_DIR"

    # Only gateway is a Tauri sidecar — engine runs in-process.
    if [ -f "$GATEWAY_SRC" ]; then
        cp -f "$GATEWAY_SRC" "$BINARY_DIR/$GATEWAY_BIN"
        ok "copied $GATEWAY_BIN → binaries/ ($(format_size $(wc -c < "$GATEWAY_SRC")))"
    else
        warn "gateway binary not found — Tauri may use a stale cached binary"
    fi

    step "Tauri desktop installer (pnpm $TAURI_CMD)"
    (cd "$REPO_ROOT/frontend" && pnpm "tauri" "$TAURI_CMD") || err "tauri $TAURI_CMD failed"
    ok "Tauri installer generated"
fi

# ---------- summary ----------
printf "\n${GREEN}%-50s${NC}\n" "=================================================="
printf "${GREEN}  Build complete${NC}\n"
printf "${GREEN}%-50s${NC}\n" "=================================================="
while IFS='|' read -r elapsed name; do
    printf "  %-28s %s\n" "$name" "${elapsed}s"
done < "$TIMINGS_FILE"
printf "${GREEN}%-50s${NC}\n" "=================================================="
rm -f "$TIMINGS_FILE"

if [ "$TAURI_BUILD" = true ]; then
    printf "\n  MSI:   %s/frontend/src-tauri/target/release/bundle/msi\n" "$REPO_ROOT"
    printf "  NSIS:  %s/frontend/src-tauri/target/release/bundle/nsis\n\n" "$REPO_ROOT"
fi

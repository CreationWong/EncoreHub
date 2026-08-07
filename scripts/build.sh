#!/usr/bin/env bash
# EncoreHub build workflow - Linux, macOS, and WSL
# Usage: ./scripts/build.sh [--skip-engine] [--skip-gateway] [--skip-frontend] [--debug] [--tauri] [--parallel] [--skip-install] [--components <names>]
#
# Examples:
#   ./scripts/build.sh
#   ./scripts/build.sh --debug
#   ./scripts/build.sh --tauri
#   ./scripts/build.sh --tauri --debug
#   ./scripts/build.sh --parallel
#   ./scripts/build.sh --skip-engine --skip-gateway
#   ./scripts/build.sh --skip-install
#   ./scripts/build.sh --components engine,gateway
#   ./scripts/build.sh --components desktop

set -Eeuo pipefail

show_usage() {
    sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
}

SKIP_ENGINE=false
SKIP_GATEWAY=false
SKIP_FRONTEND=false
DEBUG_BUILD=false
TAURI_BUILD=false
PARALLEL=false
SKIP_INSTALL=false
COMPONENTS=""

while [ "$#" -gt 0 ]; do
    case "$1" in
        --skip-engine)   SKIP_ENGINE=true ;;
        --skip-gateway)  SKIP_GATEWAY=true ;;
        --skip-frontend) SKIP_FRONTEND=true ;;
        --debug)         DEBUG_BUILD=true ;;
        --tauri)         TAURI_BUILD=true ;;
        --parallel)      PARALLEL=true ;;
        --skip-install)  SKIP_INSTALL=true ;;
        --components)
            shift
            if [ "$#" -eq 0 ]; then
                echo "--components requires a comma-separated value" >&2
                exit 2
            fi
            COMPONENTS="$1"
            ;;
        --help|-h)       show_usage; exit 0 ;;
        *) echo "Unknown argument: $1" >&2; show_usage >&2; exit 2 ;;
    esac
    shift
done

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FRONTEND_DIR="$REPO_ROOT/frontend"
ENGINE_DIR="$REPO_ROOT/engine"
GATEWAY_DIR="$REPO_ROOT/gateway"
BINARY_DIR="$FRONTEND_DIR/src-tauri/binaries"

if [ -n "$COMPONENTS" ]; then
    if [ "$TAURI_BUILD" = true ] || [ "$SKIP_ENGINE" = true ] || \
       [ "$SKIP_GATEWAY" = true ] || [ "$SKIP_FRONTEND" = true ] || \
       [ "$PARALLEL" = true ] || [ "$SKIP_INSTALL" = true ]; then
        echo "--components cannot be combined with legacy build-selection switches" >&2
        exit 2
    fi
    PROFILE_FLAG="--release"
    if [ "$DEBUG_BUILD" = true ]; then
        PROFILE_FLAG="--debug"
    fi
    exec node "$REPO_ROOT/scripts/build-components.mjs" \
        --components "$COMPONENTS" "$PROFILE_FLAG"
fi

CARGO_TARGET="debug"
CARGO_ARGS=()
GO_BUILD_ARGS=(-trimpath -gcflags "all=-N -l")
TAURI_ARGS=(tauri dev)

if [ "$DEBUG_BUILD" = false ]; then
    CARGO_TARGET="release"
    CARGO_ARGS=(--release)
    GO_BUILD_ARGS=(-trimpath -ldflags "-s -w")
    TAURI_ARGS=(tauri build)
fi

ENGINE_BIN="encorehub-engine"
GATEWAY_BIN="encorehub-gateway"
case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*)
        ENGINE_BIN="${ENGINE_BIN}.exe"
        GATEWAY_BIN="${GATEWAY_BIN}.exe"
        ;;
esac

ENGINE_SOURCE="$ENGINE_DIR/target/$CARGO_TARGET/$ENGINE_BIN"
GATEWAY_SOURCE="$GATEWAY_DIR/bin/$GATEWAY_BIN"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'

TIMINGS_FILE="$(mktemp "${TMPDIR:-/tmp}/encorehub-build.XXXXXX")"
trap 'rm -f "$TIMINGS_FILE"' EXIT

section() { printf "\n${CYAN}-- %s --${NC}\n" "$1"; }
ok()      { printf "    ${GREEN}[OK]${NC} %s\n" "$1"; }
warn()    { printf "    ${YELLOW}[WARN]${NC} %s\n" "$1"; }
fail()    { printf "    ${RED}[FAIL]${NC} %s\n" "$1" >&2; exit 1; }

time_step() {
    local name="$1"
    shift
    local start end elapsed status
    start="$(date +%s)"
    if "$@"; then
        status=0
    else
        status=$?
    fi
    end="$(date +%s)"
    elapsed=$((end - start))
    printf "%s|%s\n" "$elapsed" "$name" >> "$TIMINGS_FILE"
    return "$status"
}

format_size() {
    local bytes="$1"
    if command -v numfmt >/dev/null 2>&1; then
        numfmt --to=iec --suffix=B "$bytes" 2>/dev/null || printf "%s B" "$bytes"
    else
        awk -v bytes="$bytes" 'BEGIN {
            size = bytes
            unit = "B"
            if (size >= 1000000) {
                size /= 1000000
                unit = "MB"
            } else if (size >= 1000) {
                size /= 1000
                unit = "KB"
            }
            printf "%.1f %s", size, unit
        }'
    fi
}

check_command() {
    local name="$1"
    local required="$2"
    if [ "$required" = false ]; then
        return
    fi
    if command -v "$name" >/dev/null 2>&1; then
        ok "$name"
    else
        fail "$name is required but was not found in PATH"
    fi
}

resolve_protoc() {
    local required="$1"
    if [ "$required" = false ]; then
        return
    fi

    if [ -n "${PROTOC:-}" ]; then
        if [ ! -f "$PROTOC" ] || ! "$PROTOC" --version >/dev/null 2>&1; then
            fail "PROTOC does not point to a working executable: $PROTOC"
        fi
        export PROTOC
        ok "protoc (PROTOC)"
        return
    fi

    if command -v protoc >/dev/null 2>&1; then
        PROTOC="$(command -v protoc)"
        export PROTOC
        ok "protoc (PATH)"
        return
    fi

    local resolver_manifest="$ENGINE_DIR/crates/protoc-resolver/Cargo.toml"
    local resolved
    if ! resolved="$(cargo run --quiet --manifest-path "$resolver_manifest")"; then
        fail "vendored protoc resolver failed"
    fi
    PROTOC="$(printf '%s\n' "$resolved" | tail -n 1)"
    if [ -z "$PROTOC" ] || [ ! -f "$PROTOC" ] || ! "$PROTOC" --version >/dev/null 2>&1; then
        fail "vendored protoc resolver returned an invalid executable: $PROTOC"
    fi
    export PROTOC
    ok "protoc (vendored)"
}

build_engine() {
    if [ "$TAURI_BUILD" = true ]; then
        section "Engine Runtime library"
        local profile_flag="--debug"
        if [ "$DEBUG_BUILD" = false ]; then
            profile_flag="--release"
        fi
        if ! node "$REPO_ROOT/scripts/prepare-engine-runtime.mjs" "$profile_flag"; then
            return 1
        fi
        ok "engine runtime library prepared"
        return
    fi

    section "Engine standalone binary"
    if ! (cd "$ENGINE_DIR" && cargo build --features standalone "${CARGO_ARGS[@]}"); then
        return 1
    fi
    if [ -f "$ENGINE_SOURCE" ]; then
        local bytes
        bytes="$(wc -c < "$ENGINE_SOURCE")"
        ok "engine built ($(format_size "$bytes"))"
    else
        ok "engine built"
    fi
}

build_gateway() {
    section "Gateway"
    local profile_flag="--debug"
    if [ "$DEBUG_BUILD" = false ]; then
        profile_flag="--release"
    fi
    if ! node "$REPO_ROOT/scripts/prepare-gateway-sidecar.mjs" "$profile_flag"; then
        return 1
    fi
    if [ ! -f "$GATEWAY_SOURCE" ]; then
        warn "gateway command completed without producing $GATEWAY_SOURCE"
        return 1
    fi
    local bytes
    bytes="$(wc -c < "$GATEWAY_SOURCE")"
    ok "gateway built ($(format_size "$bytes"))"
}

build_frontend() {
    section "Frontend"
    if [ "$SKIP_INSTALL" = false ]; then
        if ! (cd "$FRONTEND_DIR" && pnpm install --frozen-lockfile); then
            return 1
        fi
    fi

    if [ "$TAURI_BUILD" = true ]; then
        ok "frontend dependencies ready; Tauri owns the Vite lifecycle"
        return
    fi

    if ! (cd "$FRONTEND_DIR" && pnpm build); then
        return 1
    fi
    if [ ! -f "$FRONTEND_DIR/dist/index.html" ]; then
        warn "frontend build completed without producing dist/index.html"
        return 1
    fi
    ok "frontend built (dist ready)"
}

run_core_builds() {
    if [ "$PARALLEL" = true ] && [ "$SKIP_ENGINE" = false ] && [ "$SKIP_GATEWAY" = false ]; then
        time_step "engine" build_engine &
        local engine_pid=$!
        time_step "gateway" build_gateway &
        local gateway_pid=$!
        local engine_status=0
        local gateway_status=0

        wait "$engine_pid" || engine_status=$?
        wait "$gateway_pid" || gateway_status=$?
        if [ "$engine_status" -ne 0 ] || [ "$gateway_status" -ne 0 ]; then
            fail "parallel core build failed (engine=$engine_status, gateway=$gateway_status)"
        fi
        return
    fi

    if [ "$SKIP_ENGINE" = false ]; then
        time_step "engine" build_engine || fail "engine build failed"
    fi
    if [ "$SKIP_GATEWAY" = false ]; then
        time_step "gateway" build_gateway || fail "gateway build failed"
    fi
}

prepare_tauri_sidecar() {
    section "Tauri sidecar"
    mkdir -p "$BINARY_DIR"

    local target_triple
    target_triple="$(rustc -vV | awk '/^host:/ { print $2; exit }')"
    if [ -z "$target_triple" ]; then
        warn "could not determine the Rust host target triple"
        return 1
    fi
    ok "host target triple: $target_triple"

    local runtime_library="libencorehub_desktop_runtime.so"
    case "$(uname -s)" in
        Darwin*) runtime_library="libencorehub_desktop_runtime.dylib" ;;
        MINGW*|MSYS*|CYGWIN*) runtime_library="encorehub_desktop_runtime.dll" ;;
    esac
    if [ ! -f "$BINARY_DIR/$runtime_library" ] || \
       [ ! -f "$BINARY_DIR/engine-runtime.json" ]; then
        warn "Engine Runtime module is missing; build the engine component first"
        return 1
    fi
    ok "engine runtime module ready"
    if [ ! -f "$BINARY_DIR/gateway-runtime.json" ]; then
        warn "Gateway module manifest is missing; build the gateway component first"
        return 1
    fi

    if [ "$SKIP_GATEWAY" = true ]; then
        warn "gateway build was skipped; using the existing binary when available"
    fi
    if [ ! -f "$GATEWAY_SOURCE" ]; then
        warn "gateway sidecar not found at $GATEWAY_SOURCE"
        return 1
    fi

    local target_gateway="encorehub-gateway-${target_triple}"
    case "$(uname -s)" in
        MINGW*|MSYS*|CYGWIN*) target_gateway="${target_gateway}.exe" ;;
    esac

    if ! cp -f "$GATEWAY_SOURCE" "$BINARY_DIR/$GATEWAY_BIN"; then
        return 1
    fi
    if ! cp -f "$GATEWAY_SOURCE" "$BINARY_DIR/$target_gateway"; then
        return 1
    fi

    local bytes
    bytes="$(wc -c < "$GATEWAY_SOURCE")"
    ok "gateway sidecar copied ($(format_size "$bytes"); target $target_triple)"
}

run_tauri_development() {
    section "Tauri desktop development"
    warn "Development sessions are not timed. Press Ctrl+C to stop."
    if ! (cd "$FRONTEND_DIR" && pnpm "${TAURI_ARGS[@]}"); then
        fail "Tauri development session failed"
    fi
}

build_tauri_installer() {
    section "Tauri installer"
    if ! (cd "$FRONTEND_DIR" && pnpm "${TAURI_ARGS[@]}"); then
        return 1
    fi
}

print_summary() {
    local title="$1"
    printf "\n${GREEN}%s${NC}\n" "======================================================"
    printf "${GREEN}  %s${NC}\n" "$title"
    printf "${GREEN}%s${NC}\n" "======================================================"
    while IFS='|' read -r elapsed name; do
        [ -n "$name" ] || continue
        printf "  %-30s %7ss\n" "$name" "$elapsed"
    done < "$TIMINGS_FILE"
    printf "${GREEN}%s${NC}\n" "======================================================"
}

print_release_locations() {
    local bundle_dir="$FRONTEND_DIR/src-tauri/target/release/bundle"
    printf "\n"
    case "$(uname -s)" in
        Darwin*)
            printf "  APP: %s/macos\n" "$bundle_dir"
            printf "  DMG: %s/dmg\n" "$bundle_dir"
            ;;
        MINGW*|MSYS*|CYGWIN*)
            printf "  MSI:  %s/msi\n" "$bundle_dir"
            printf "  NSIS: %s/nsis\n" "$bundle_dir"
            ;;
        *)
            printf "  AppImage: %s/appimage\n" "$bundle_dir"
            printf "  DEB:      %s/deb\n" "$bundle_dir"
            printf "  RPM:      %s/rpm\n" "$bundle_dir"
            ;;
    esac
    printf "\n"
}

NEEDS_NODE=false
if [ "$SKIP_FRONTEND" = false ] || [ "$TAURI_BUILD" = true ]; then
    NEEDS_NODE=true
fi
NEEDS_CARGO=false
if [ "$SKIP_ENGINE" = false ] || [ "$TAURI_BUILD" = true ]; then
    NEEDS_CARGO=true
fi
NEEDS_GO=false
if [ "$SKIP_GATEWAY" = false ]; then
    NEEDS_GO=true
fi

section "Prerequisites"
check_command node "$NEEDS_NODE"
check_command pnpm "$NEEDS_NODE"
check_command go "$NEEDS_GO"
check_command cargo "$NEEDS_CARGO"
check_command rustc "$TAURI_BUILD"
resolve_protoc "$NEEDS_CARGO"

run_core_builds

if [ "$SKIP_FRONTEND" = false ]; then
    time_step "frontend" build_frontend || fail "frontend build failed"
fi

if [ "$TAURI_BUILD" = true ]; then
    time_step "tauri sidecar" prepare_tauri_sidecar || fail "Tauri sidecar preparation failed"

    if [ "$DEBUG_BUILD" = true ]; then
        print_summary "Preparation complete"
        run_tauri_development
        exit 0
    fi

    time_step "tauri installer" build_tauri_installer || fail "Tauri installer build failed"
fi

print_summary "Build complete"
if [ "$TAURI_BUILD" = true ] && [ "$DEBUG_BUILD" = false ]; then
    print_release_locations
fi

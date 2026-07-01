.PHONY: help install dev build test lint clean proto check dist

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
	awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-22s\033[0m %s\n", $$1, $$2}'

# ===== Install =====
install: install-frontend install-gateway install-engine install-data ## Install all dependencies

install-frontend: ## pnpm install
	cd frontend && pnpm install --frozen-lockfile

install-gateway: ## go mod tidy
	cd gateway && go mod tidy

install-engine: ## cargo fetch
	cd engine && cargo fetch

install-data: ## uv sync (Python)
	cd data-services && uv sync

# ===== Development =====
dev: ## Start all services (redis + engine + gateway + frontend in parallel)
	@echo "Starting all services..."
	docker-compose up -d redis 2>/dev/null || true
	$(MAKE) dev-engine & $(MAKE) dev-gateway & $(MAKE) dev-frontend & wait

dev-frontend: ## Vite dev server (port 1420)
	cd frontend && pnpm dev

dev-gateway: ## Go gateway (port 8080)
	cd gateway && go run ./cmd/gateway

dev-engine: ## Rust engine standalone binary (port 3000)
	cd engine && cargo run --features standalone --bin encorehub-engine

dev-data: ## Python data-services (uvicorn)
	cd data-services && uv run uvicorn src.main:app --reload

# ===== Fast check (no build artifacts) =====
check: check-engine check-gateway check-frontend ## Static checks only (no compilation)

check-engine: ## cargo check (fast, no codegen)
	cd engine && cargo check

check-gateway: ## go vet (fast, no binary)
	cd gateway && go vet ./...

check-frontend: ## tsc --noEmit
	cd frontend && pnpm tsc --noEmit

# ===== Build =====
build: build-engine build-gateway build-frontend ## Build all (standalone engine binary)

build-ci: ## CI build (engine + gateway concurrent, frontend)
	@bash scripts/build.sh --parallel

build-frontend: ## Vite production build → dist/
	cd frontend && pnpm build

build-gateway: ## Go binary → gateway/bin/
	cd gateway && go build -trimpath -ldflags="-s -w" -o bin/gateway ./cmd/gateway

build-engine: ## Standalone engine binary (headless/sidecar use)
	cd engine && cargo build --release --features standalone

# ===== Desktop app =====
tauri-dev: ## Tauri desktop dev (engine runs in-process)
	cd frontend && pnpm tauri dev

tauri-build: ## Tauri desktop installer (.msi + .exe)
	@powershell -NoProfile -File scripts/build.ps1 -Tauri

tauri-build-win: ## Tauri installer (PowerShell)
	@powershell -NoProfile -File scripts/build.ps1 -Tauri

tauri-build-unix: ## Tauri installer (bash)
	@bash scripts/build.sh --tauri

dist: tauri-build ## Alias: build desktop installer

# ===== Test =====
test: test-engine test-gateway test-data test-frontend ## Run all tests

test-frontend: ## Vitest
	cd frontend && pnpm test

test-gateway: ## go test ./...
	cd gateway && go test ./...

test-engine: ## cargo test (lib + standalone)
	cd engine && cargo test && cargo test --features standalone

test-data: ## pytest (Python)
	cd data-services && uv run pytest

# ===== Lint =====
lint: lint-frontend lint-gateway lint-engine lint-data ## Lint all

lint-frontend: ## Biome check
	cd frontend && pnpm lint

lint-frontend-fix: ## Biome auto-fix
	cd frontend && pnpm lint:fix

lint-gateway: ## golangci-lint
	cd gateway && golangci-lint run ./...

lint-engine: ## cargo clippy
	cd engine && cargo clippy --all-targets --features standalone -- -D warnings

lint-data: ## ruff + mypy (Python)
	cd data-services && uv run ruff check src/ && uv run mypy src/

fmt: ## Format all (Biome + cargo fmt + gofmt)
	cd frontend && pnpm lint:fix
	cd engine && cargo fmt
	cd gateway && gofmt -w .

# ===== Docker =====
docker-up: ## docker-compose up -d
	docker-compose up -d

docker-down: ## docker-compose down
	docker-compose down

docker-logs: ## docker-compose logs -f
	docker-compose logs -f

# ===== Clean =====
clean: ## Clean build artifacts (preserves cargo/gomodule caches)
	cd engine && cargo clean
	cd gateway && go clean -cache
	rm -rf frontend/dist
	rm -rf frontend/src-tauri/target/release/bundle
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true

clean-all: clean ## Also clean dependency caches
	rm -rf frontend/node_modules
	rm -rf frontend/src-tauri/target
	cd gateway && go clean -modcache
	@echo "Run 'make install' to re-fetch everything."

# ===== Proto =====
proto: ## Generate protobuf stubs
	buf generate

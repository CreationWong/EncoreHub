.PHONY: help install dev build test lint clean proto

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
	awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

# ===== Install =====
install: install-frontend install-gateway install-engine install-data ## Install all dependencies

install-frontend:
	cd frontend && pnpm install

install-gateway:
	cd gateway && go mod tidy

install-engine:
	cd engine && cargo fetch

install-data:
	cd data-services && uv sync

# ===== Development =====
dev: ## Start all services in development mode
	@echo "Starting all services..."
	docker-compose up -d redis
	$(MAKE) dev-engine & $(MAKE) dev-gateway & $(MAKE) dev-frontend & wait

dev-frontend: ## Start frontend dev server
	cd frontend && pnpm dev

dev-gateway: ## Start Go gateway
	cd gateway && go run ./cmd/gateway

dev-engine: ## Start Rust engine (standalone binary; the desktop app runs it in-process)
	cd engine && cargo run --features standalone --bin encorehub-engine

dev-data: ## Start Python data services
	cd data-services && uv run uvicorn src.main:app --reload

# ===== Build =====
build: build-engine build-gateway build-frontend ## Build all

build-frontend:
	cd frontend && pnpm build

build-gateway:
	cd gateway && go build -o bin/gateway ./cmd/gateway

build-engine: ## Build the standalone engine binaries (headless / sidecar use)
	cd engine && cargo build --release --features standalone

# ===== Test =====
test: test-engine test-gateway test-data test-frontend ## Run all tests

test-frontend:
	cd frontend && pnpm test

test-gateway:
	cd gateway && go test ./...

test-engine: ## Test the engine in both library and standalone modes
	cd engine && cargo test && cargo test --features standalone

test-data:
	cd data-services && uv run pytest

# ===== Lint =====
lint: lint-frontend lint-gateway lint-engine lint-data ## Lint all

lint-frontend:
	cd frontend && pnpm lint

lint-gateway:
	cd gateway && golangci-lint run ./...

lint-engine:
	cd engine && cargo clippy -- -D warnings

lint-data:
	cd data-services && uv run ruff check src/ && uv run mypy src/

# ===== Code Generation =====
proto: ## Generate protobuf code
	buf generate

# ===== Docker =====
docker-up: ## Start all services via Docker
	docker-compose up -d

docker-down: ## Stop all Docker services
	docker-compose down

docker-logs: ## Tail Docker logs
	docker-compose logs -f

# ===== Clean =====
clean: ## Clean build artifacts
	cargo clean
	go clean -cache
	rm -rf frontend/dist frontend/node_modules/.vite
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true

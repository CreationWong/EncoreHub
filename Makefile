# Compatibility shim. Root package.json scripts are the canonical workspace entrypoint.

.PHONY: help install dev build check test lint fmt tauri-dev tauri-build docker-up docker-down docker-ps

help:
	@echo "Canonical commands: pnpm setup|dev|check|build|test|lint|format"

install:
	pnpm setup

dev:
	pnpm dev

check:
	pnpm check

build:
	pnpm build

test:
	pnpm test

lint:
	pnpm lint

fmt:
	pnpm format

tauri-dev:
	pnpm dev

tauri-build:
	pnpm build:desktop

docker-up:
	pnpm docker:up

docker-down:
	pnpm docker:down

docker-ps:
	pnpm docker:ps

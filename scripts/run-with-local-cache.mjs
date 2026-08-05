// Runs workspace tools with writable repository-local caches on every platform.

import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

const [tool, ...args] = process.argv.slice(2);
if (!tool) throw new Error("tool command required");

const cacheRoot = resolve(".cache");
const goCache = resolve(cacheRoot, "go-build");
const uvCache = resolve(cacheRoot, "uv");
// Per-invocation directories avoid Windows ACL conflicts between sandboxed and
// ordinary user processes and make concurrent workspace gates independent.
const runCache = resolve(cacheRoot, "runs", `${process.pid}-${randomUUID()}`);
const tempDirectory = resolve(runCache, "tmp");
const pytestCache = resolve(runCache, "pytest");
mkdirSync(goCache, { recursive: true });
mkdirSync(uvCache, { recursive: true });
mkdirSync(tempDirectory, { recursive: true });
mkdirSync(pytestCache, { recursive: true });

const result = spawnSync(tool, args, {
	stdio: "inherit",
	shell: process.platform === "win32",
	env: {
		...process.env,
		GOCACHE: goCache,
		TEMP: tempDirectory,
		TMP: tempDirectory,
		UV_CACHE_DIR: uvCache,
		PYTEST_ADDOPTS: `${process.env.PYTEST_ADDOPTS ?? ""} -o cache_dir=${pytestCache.replaceAll("\\", "/")}`.trim(),
	},
});
process.exit(result.status ?? 1);

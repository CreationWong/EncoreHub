import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseComponentArgs } from "./build-components.mjs";
import { resolveCargoTargetDir } from "./prepare-engine-runtime.mjs";

const repoRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);

test("component builds accept one or several independently selectable modules", () => {
	assert.deepEqual(parseComponentArgs(["--components", "engine", "--debug"]), {
		components: ["engine"],
		release: false,
	});
	assert.deepEqual(
		parseComponentArgs([
			"--components",
			"engine,gateway",
			"--components",
			"desktop",
			"--release",
		]),
		{
			components: ["engine", "gateway", "desktop"],
			release: true,
		},
	);
});

test("component builds reject unknown or empty selections", () => {
	assert.throws(() => parseComponentArgs([]), /Specify one or more components/);
	assert.throws(
		() => parseComponentArgs(["--components", "python"]),
		/Unknown component: python/,
	);
});

test("desktop components share one Cargo target directory", () => {
	assert.equal(
		resolveCargoTargetDir(repoRoot, ""),
		path.join(repoRoot, "frontend", "src-tauri", "target"),
	);
	assert.equal(
		resolveCargoTargetDir(repoRoot, path.join(".cache", "cargo")),
		path.join(repoRoot, ".cache", "cargo"),
	);

	const absolute = path.resolve(repoRoot, "..", "encorehub-cargo-target");
	assert.equal(resolveCargoTargetDir(repoRoot, absolute), absolute);
});

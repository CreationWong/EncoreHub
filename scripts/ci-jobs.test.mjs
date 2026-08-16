// Verifies commit-range path classification for selective CI jobs.
import assert from "node:assert/strict";
import test from "node:test";
import { ciJobsForPaths } from "./ci-jobs.mjs";

test("skips every job for an empty commit range", () => {
	assert.deepEqual(ciJobsForPaths([]), {
		docs: false,
		frontend: false,
		gateway: false,
		engine: false,
	});
});

test("runs only workspace checks for documentation and automation", () => {
	for (const changedPath of [
		"README.md",
		"docs/adr/0011-example.md",
		"frontend/README.md",
		".github/workflows/build.yml",
		"scripts/release-metadata.mjs",
	]) {
		assert.deepEqual(ciJobsForPaths([changedPath]), {
			docs: true,
			frontend: false,
			gateway: false,
			engine: false,
		});
	}
});

test("runs only directly changed component jobs", () => {
	assert.deepEqual(
		ciJobsForPaths([
			"frontend/src/App.tsx",
			"gateway/internal/handler/chat.go",
		]),
		{ docs: false, frontend: true, gateway: true, engine: false },
	);
	assert.deepEqual(ciJobsForPaths(["engine/src/lib.rs"]), {
		docs: false,
		frontend: false,
		gateway: false,
		engine: true,
	});
});

test("runs only consumers of shared runtime inputs", () => {
	assert.deepEqual(ciJobsForPaths(["proto/encorehub/v1/common.proto"]), {
		docs: false,
		frontend: false,
		gateway: true,
		engine: true,
	});
	for (const changedPath of [
		"skills/code-explainer/SKILL.md",
		"plugins/hello-world/plugin.json",
	]) {
		assert.deepEqual(ciJobsForPaths([changedPath]), {
			docs: false,
			frontend: false,
			gateway: false,
			engine: true,
		});
	}
});

test("keeps CI selection changes inside the workspace job", () => {
	for (const changedPath of [
		".github/workflows/ci.yml",
		"scripts/ci-jobs.mjs",
		"scripts/ci-jobs.test.mjs",
		"package.json",
	]) {
		assert.deepEqual(ciJobsForPaths([changedPath]), {
			docs: true,
			frontend: false,
			gateway: false,
			engine: false,
		});
	}
});

test("combines only jobs owned by mixed paths", () => {
	assert.deepEqual(
		ciJobsForPaths(["README.md", "frontend/src/App.tsx", "engine/src/lib.rs"]),
		{ docs: true, frontend: true, gateway: false, engine: true },
	);
});

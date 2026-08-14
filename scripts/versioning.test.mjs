// Verifies EncoreHub's independent component version and build identity policy.
import assert from "node:assert/strict";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
	bumpComponent,
	bumpVersion,
	componentsForPaths,
	createBuildId,
	formatDisplayVersion,
	formatEcosystemVersion,
	formatVersion,
	isVersionRollIgnoredPath,
	parseVersion,
} from "./versioning.mjs";

test("parses and formats the four-part EncoreHub version", () => {
	assert.deepEqual(parseVersion("V0.1.25.142\n"), {
		major: 0,
		compatibility: 1,
		feature: 25,
		patch: 142,
	});
	assert.equal(
		formatVersion({ major: 0, compatibility: 1, feature: 25, patch: 142 }),
		"V0.1.25.142",
	);
	assert.throws(() => parseVersion("0.1.25.142"), /VMAJOR/);
	assert.throws(() => parseVersion("V0.1.25"), /VMAJOR/);
});

test("manual version tiers reset all less significant tiers", () => {
	const current = parseVersion("V2.3.4.5");
	assert.equal(formatVersion(bumpVersion(current, "major")), "V3.0.0.0");
	assert.equal(
		formatVersion(bumpVersion(current, "compatibility")),
		"V2.4.0.0",
	);
	assert.equal(formatVersion(bumpVersion(current, "feature")), "V2.3.5.0");
	assert.equal(formatVersion(bumpVersion(current, "patch")), "V2.3.4.6");
});

test("ecosystem manifests use the public three-part version", () => {
	assert.equal(formatEcosystemVersion(parseVersion("V2.3.4.5")), "2.3.4");
});

test("frontend public bumps refresh the Tauri workspace package in Cargo.lock", (t) => {
	const repo = mkdtempSync(path.join(os.tmpdir(), "encorehub-version-"));
	t.after(() => rmSync(repo, { recursive: true, force: true }));
	for (const directory of [
		"frontend/src-tauri/src",
		"gateway/internal/buildinfo",
		"engine",
	]) {
		mkdirSync(path.join(repo, directory), { recursive: true });
	}
	const versionRecord = {
		component: "frontend",
		version: "V0.1.3.0",
		compatibility: {
			gateway: { min: "V0.1.0.0", max_exclusive: "V0.2.0.0" },
			engine: { min: "V0.1.0.0", max_exclusive: "V0.2.0.0" },
		},
	};
	writeFileSync(
		path.join(repo, "frontend/version.json"),
		JSON.stringify(versionRecord),
	);
	for (const manifest of ["package.json", "frontend/package.json"]) {
		writeFileSync(
			path.join(repo, manifest),
			JSON.stringify({ name: "encorehub", version: "0.1.3" }),
		);
	}
	writeFileSync(
		path.join(repo, "frontend/src-tauri/tauri.conf.json"),
		JSON.stringify({ version: "0.1.3" }),
	);
	writeFileSync(
		path.join(repo, "frontend/src-tauri/Cargo.toml"),
		'[package]\nname = "encorehub-desktop"\nversion = "0.1.3"\nedition = "2021"\n',
	);
	writeFileSync(
		path.join(repo, "frontend/src-tauri/Cargo.lock"),
		'version = 4\n\n[[package]]\nname = "encorehub-desktop"\nversion = "0.1.3"\n',
	);
	writeFileSync(
		path.join(repo, "frontend/src-tauri/src/main.rs"),
		"fn main() {}\n",
	);

	bumpComponent("frontend", "feature", repo);

	assert.match(
		readFileSync(path.join(repo, "frontend/src-tauri/Cargo.lock"), "utf8"),
		/name = "encorehub-desktop"\r?\nversion = "0\.1\.4"/,
	);
});

test("build ids combine a UTC date with the final six epoch-second digits", () => {
	const instant = new Date("2026-08-13T12:34:34.000Z");
	const expectedSuffix = String(Math.floor(instant.getTime() / 1000)).slice(-6);
	assert.equal(createBuildId(instant), `260813${expectedSuffix}`);
	assert.match(createBuildId(instant), /^\d{12}$/);
});

test("build ids are always public while patch tiers remain diagnostic", () => {
	const version = parseVersion("V0.1.25.142");
	assert.equal(
		formatDisplayVersion(version, "260813600474", false),
		"V0.1.25 (Build 260813600474)",
	);
	assert.equal(
		formatDisplayVersion(version, "260813600474", true),
		"V0.1.25.142 (Build 260813600474)",
	);
});

test("changed paths roll only affected production components", () => {
	assert.deepEqual(
		componentsForPaths([
			"frontend/src/App.tsx",
			"engine/src/main.rs",
			"docs/README.md",
			"frontend/src/App.test.tsx",
			"scripts/build-components.mjs",
		]),
		["frontend", "engine"],
	);
	assert.deepEqual(componentsForPaths(["proto/encorehub.proto"]), [
		"frontend",
		"gateway",
		"engine",
	]);
	assert.deepEqual(componentsForPaths(["CHANGELOG.md"]), []);
});

test("version rolls ignore documentation, samples, workflows, packages, builds, and tests", () => {
	for (const file of [
		"README.md",
		"LICENSE",
		"docs/adr/0001-language-split.md",
		"frontend/.env.example",
		"frontend/.env.local.template",
		"config.sample.json",
		".github/workflows/build.yml",
		"frontend/package.json",
		"engine/Cargo.lock",
		"gateway/go.mod",
		"frontend/src-tauri/tauri.windows.conf.json",
		"Makefile",
		"engine/build.rs",
		"scripts/build.ps1",
		"scripts/build-components.mjs",
		"scripts/prepare-engine-runtime.mjs",
		"scripts/generate-oss-compliance.mjs",
		"scripts/workspace-contract.test.mjs",
		"frontend/scripts/check-bundle-budget.mjs",
		"engine/tests/api_smoke.rs",
		"gateway/internal/handler/chat_test.go",
		"frontend/src/App.test.tsx",
	]) {
		assert.equal(isVersionRollIgnoredPath(file), true, file);
	}
	assert.equal(isVersionRollIgnoredPath("frontend/src/App.tsx"), false);
	assert.deepEqual(
		componentsForPaths([
			"gateway/internal/handler/chat_test.go",
			"scripts/build.sh",
			"scripts/release-metadata.mjs",
			"package.json",
		]),
		[],
	);
});

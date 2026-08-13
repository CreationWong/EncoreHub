// Verifies EncoreHub's independent component version and build identity policy.
import assert from "node:assert/strict";
import test from "node:test";
import {
	bumpVersion,
	componentsForPaths,
	createBuildId,
	formatDisplayVersion,
	formatEcosystemVersion,
	formatVersion,
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

test("changed paths roll only affected components and shared release changes roll all", () => {
	assert.deepEqual(
		componentsForPaths([
			"frontend/src/App.tsx",
			"engine/src/main.rs",
			"docs/README.md",
		]),
		["frontend", "engine"],
	);
	assert.deepEqual(componentsForPaths(["scripts/build-components.mjs"]), [
		"frontend",
		"gateway",
		"engine",
	]);
	assert.deepEqual(componentsForPaths(["CHANGELOG.md"]), []);
});

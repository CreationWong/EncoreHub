// Verifies release-note extraction, titles, contributors, and build matrices.
import assert from "node:assert/strict";
import test from "node:test";
import {
	createReleaseMetadata,
	extractReleaseSection,
	parseContributors,
	releaseMatrix,
} from "./release-metadata.mjs";

const changelog = `# Changelog

## [Unreleased]

## [1.2.3] - 2026-08-14

### Added

- Added release automation.

### Fixed

- Fixed package generation.

## [1.2.2] - 2026-08-01

### Added

- Older entry.
`;

test("extracts only the exact public release section", () => {
	const section = extractReleaseSection(changelog, "1.2.3");
	assert.match(section, /Added release automation/);
	assert.match(section, /Fixed package generation/);
	assert.doesNotMatch(section, /Older entry/);
});

test("rejects a missing or empty release section", () => {
	assert.throws(
		() => extractReleaseSection(changelog, "1.2.4"),
		/exactly one release heading/,
	);
	assert.throws(
		() => extractReleaseSection("## [1.2.3] - 2026-08-14\n", "1.2.3"),
		/no standard change category/,
	);
});

test("builds titles from the tag and optional release markers", () => {
	for (const { prerelease, titleSuffix, expected } of [
		{ prerelease: false, titleSuffix: "", expected: "V1.2.3" },
		{
			prerelease: false,
			titleSuffix: "Apple Silicon",
			expected: "V1.2.3 - Apple Silicon",
		},
		{
			prerelease: true,
			titleSuffix: "",
			expected: "V1.2.3 - Pre-release",
		},
		{
			prerelease: true,
			titleSuffix: "Apple Silicon",
			expected: "V1.2.3 - Pre-release - Apple Silicon",
		},
	]) {
		const metadata = createReleaseMetadata({
			packageVersion: "1.2.3",
			frontendVersion: "V1.2.3.7",
			changelog,
			contributors: ["Alice", "Bob"],
			platform: "macOS",
			prerelease,
			titleSuffix,
		});
		assert.equal(metadata.tag, "V1.2.3");
		assert.equal(metadata.title, expected);
		assert.deepEqual(metadata.matrix, {
			include: [{ os: "macos-latest", platform: "macOS" }],
		});
		assert.match(metadata.notes, /## Contributors\n\n- Alice\n- Bob/);
	}
});

test("rejects mismatched package and component public versions", () => {
	assert.throws(
		() =>
			createReleaseMetadata({
				packageVersion: "1.2.3",
				frontendVersion: "V1.2.4.0",
				changelog,
				contributors: [],
				platform: "ALL",
				prerelease: false,
			}),
		/does not match public version/,
	);
});

test("expands ALL to every supported installer platform", () => {
	assert.deepEqual(
		releaseMatrix("ALL").include.map(({ platform }) => platform),
		["Windows", "macOS", "Linux"],
	);
	assert.throws(() => releaseMatrix("Android"), /Unknown release platform/);
});

test("deduplicates contributors and excludes automation accounts", () => {
	assert.deepEqual(
		parseContributors(
			"Alice\talice@example.com\nAlice A.\talice@example.com\ngithub-actions[bot]\tbot@users.noreply.github.com\nBob\tbob@example.com\n",
		),
		["Alice", "Bob"],
	);
});

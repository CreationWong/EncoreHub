// Validates release versions and prepares deterministic GitHub Release metadata.
import { execFileSync } from "node:child_process";
import {
	appendFileSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const COMPONENT_VERSION_PATTERN =
	/^V(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const PLATFORMS = {
	ALL: [
		{ os: "windows-latest", platform: "Windows" },
		{ os: "macos-latest", platform: "macOS" },
		{ os: "ubuntu-latest", platform: "Linux" },
	],
	Windows: [{ os: "windows-latest", platform: "Windows" }],
	macOS: [{ os: "macos-latest", platform: "macOS" }],
	Linux: [{ os: "ubuntu-latest", platform: "Linux" }],
};

/** Return one non-empty Keep a Changelog release body for the public version. */
export function extractReleaseSection(changelog, version) {
	if (!PUBLIC_VERSION_PATTERN.test(version)) {
		throw new Error(`Invalid public release version: ${version}`);
	}
	const lines = changelog.split(/\r?\n/);
	const releasePattern = new RegExp(
		`^## \\[${version.replaceAll(".", "\\.")}\\] - \\d{4}-\\d{2}-\\d{2}$`,
	);
	const starts = lines
		.map((line, index) => (releasePattern.test(line) ? index : -1))
		.filter((index) => index >= 0);
	if (starts.length !== 1) {
		throw new Error(
			`CHANGELOG.md must contain exactly one release heading for ${version}`,
		);
	}
	const start = starts[0];
	const nextRelease = lines.findIndex(
		(line, index) => index > start && /^## \[/.test(line),
	);
	const body = lines
		.slice(start + 1, nextRelease === -1 ? undefined : nextRelease)
		.join("\n")
		.trim();
	if (
		!body ||
		!/^### (Added|Changed|Deprecated|Removed|Fixed|Security)$/m.test(body)
	) {
		throw new Error(
			`CHANGELOG.md release ${version} has no standard change category`,
		);
	}
	return body;
}

/** Convert one workflow platform choice into a GitHub Actions matrix. */
export function releaseMatrix(platform) {
	const include = PLATFORMS[platform];
	if (!include) throw new Error(`Unknown release platform: ${platform}`);
	return { include };
}

/** Deduplicate human Git authors while excluding automation identities. */
export function parseContributors(authorLines) {
	const contributors = new Map();
	for (const line of authorLines.split(/\r?\n/)) {
		const [rawName = "", rawEmail = ""] = line.split("\t");
		const name = rawName.trim();
		const email = rawEmail.trim().toLowerCase();
		if (
			!name ||
			/(?:dependabot|github-actions)(?:\[bot\])?/i.test(`${name} ${email}`)
		) {
			continue;
		}
		const key = email || name.toLowerCase();
		if (!contributors.has(key)) contributors.set(key, name);
	}
	return [...contributors.values()].sort((left, right) =>
		left.localeCompare(right, "en"),
	);
}

/** Build the immutable metadata shared by preflight, builders, and publication. */
export function createReleaseMetadata({
	packageVersion,
	frontendVersion,
	changelog,
	contributors,
	platform,
	prerelease,
	titleSuffix = "",
}) {
	if (!PUBLIC_VERSION_PATTERN.test(packageVersion)) {
		throw new Error(`package.json has invalid version ${packageVersion}`);
	}
	const componentMatch = frontendVersion.match(COMPONENT_VERSION_PATTERN);
	const frontendPublicVersion = componentMatch?.slice(1, 4).join(".");
	if (frontendPublicVersion !== packageVersion) {
		throw new Error(
			`Frontend ${frontendVersion} does not match public version ${packageVersion}`,
		);
	}
	const suffix = titleSuffix.trim();
	if (/\r|\n/.test(suffix) || suffix.length > 80) {
		throw new Error(
			"Release title suffix must be one line and at most 80 characters",
		);
	}
	const tag = `V${packageVersion}`;
	const releaseType = prerelease ? "Pre-release" : "Release";
	const titleParts = [tag];
	if (prerelease) titleParts.push(releaseType);
	if (suffix) titleParts.push(suffix);
	const changes = extractReleaseSection(changelog, packageVersion);
	const contributorList = contributors.length
		? contributors.map((name) => `- ${name}`).join("\n")
		: "- No human contributors found in the release range.";
	return {
		version: packageVersion,
		tag,
		title: titleParts.join(" - "),
		releaseType,
		matrix: releaseMatrix(platform),
		notes: `${changes}\n\n## Contributors\n\n${contributorList}\n`,
	};
}

/** Parse one named CLI option without accepting ambiguous duplicates. */
function option(args, name, fallback) {
	const matches = args
		.map((value, index) => (value === name ? index : -1))
		.filter((index) => index >= 0);
	if (matches.length > 1) throw new Error(`${name} may only be provided once`);
	if (matches.length === 0) return fallback;
	const value = args[matches[0] + 1];
	if (!value || value.startsWith("--"))
		throw new Error(`${name} requires a value`);
	return value;
}

/** Read Git history using the latest earlier Vx.y.z tag as the release boundary. */
function gitContributors(repoRoot, currentTag) {
	const tags = execFileSync(
		"git",
		["tag", "--list", "V[0-9]*", "--sort=-version:refname"],
		{ cwd: repoRoot, encoding: "utf8" },
	)
		.split(/\r?\n/)
		.map((tag) => tag.trim())
		.filter((tag) => tag && tag !== currentTag);
	const range = tags[0] ? `${tags[0]}..HEAD` : "HEAD";
	const authors = execFileSync("git", ["log", range, "--format=%aN%x09%aE"], {
		cwd: repoRoot,
		encoding: "utf8",
	});
	return parseContributors(authors);
}

/** Append scalar values using the GitHub Actions step-output protocol. */
function writeGitHubOutputs(file, metadata) {
	for (const [name, value] of Object.entries({
		version: metadata.version,
		tag: metadata.tag,
		title: metadata.title,
		release_type: metadata.releaseType,
		matrix: JSON.stringify(metadata.matrix),
	})) {
		appendFileSync(file, `${name}=${value}\n`);
	}
}

/** Execute release validation or write workflow-ready release artifacts. */
function runCli(args) {
	const [command = "check", ...options] = args;
	const packageVersion = JSON.parse(
		readFileSync(path.join(root, "package.json"), "utf8"),
	).version;
	const frontendVersion = JSON.parse(
		readFileSync(path.join(root, "frontend/version.json"), "utf8"),
	).version;
	const changelog = readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
	const platform = option(options, "--platform", "ALL");
	const prerelease = option(options, "--prerelease", "true") === "true";
	const titleSuffix = option(options, "--title-suffix", "");
	const tag = `V${packageVersion}`;
	const metadata = createReleaseMetadata({
		packageVersion,
		frontendVersion,
		changelog,
		contributors: gitContributors(root, tag),
		platform,
		prerelease,
		titleSuffix,
	});
	if (command === "check") {
		console.log(`Validated CHANGELOG.md release ${metadata.tag}`);
		return;
	}
	if (command !== "prepare") throw new Error(`Unknown command: ${command}`);
	const output = option(options, "--output");
	const githubOutput = option(options, "--github-output");
	mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
	writeFileSync(output, metadata.notes);
	writeGitHubOutputs(githubOutput, metadata);
	console.log(
		`Prepared ${metadata.tag} metadata for ${metadata.matrix.include.length} platform(s)`,
	);
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	try {
		runCli(process.argv.slice(2));
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	}
}

// Owns EncoreHub component version records, compatibility ranges, and build ids.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const COMPONENTS = ["frontend", "gateway", "engine"];
const COMPONENT_FILES = {
	frontend: "frontend/version.json",
	gateway: "gateway/internal/buildinfo/version.json",
	engine: "engine/version.json",
};
const FRONTEND_PACKAGE_FILES = [
	"package.json",
	"frontend/package.json",
	"frontend/src-tauri/tauri.conf.json",
];
const VERSION_PATTERN =
	/^V(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SHARED_RELEASE_PATHS = [
	"package.json",
	"scripts/",
	".github/workflows/",
	"docker-compose.yml",
];

/** Parse the repository's Vmajor.compatibility.feature.patch notation. */
export function parseVersion(value) {
	const match = String(value).trim().match(VERSION_PATTERN);
	if (!match) {
		throw new Error(
			`Invalid version ${JSON.stringify(value)}; expected VMAJOR.COMPATIBILITY.FEATURE.PATCH`,
		);
	}
	const [major, compatibility, feature, patch] = match.slice(1).map(Number);
	return { major, compatibility, feature, patch };
}

/** Format a parsed component version for persistence and diagnostics. */
export function formatVersion(version) {
	return `V${version.major}.${version.compatibility}.${version.feature}.${version.patch}`;
}

/** Format the stable public version without the commit/patch tier. */
export function formatPublicVersion(version) {
	return `V${version.major}.${version.compatibility}.${version.feature}`;
}

/** Format a component's public tier for npm, Cargo, and Tauri manifests. */
export function formatEcosystemVersion(version) {
	return `${version.major}.${version.compatibility}.${version.feature}`;
}

/** Always expose the build id and reveal the patch tier only for diagnostics. */
export function formatDisplayVersion(version, buildId, diagnostic) {
	if (!/^\d{12}$/.test(buildId))
		throw new Error(`Invalid build id: ${buildId}`);
	const visibleVersion = diagnostic
		? formatVersion(version)
		: formatPublicVersion(version);
	return `${visibleVersion} (Build ${buildId})`;
}

/** Increment one tier and reset every less-significant tier. */
export function bumpVersion(version, tier) {
	const next = { ...version };
	switch (tier) {
		case "major":
			next.major += 1;
			next.compatibility = 0;
			next.feature = 0;
			next.patch = 0;
			break;
		case "compatibility":
			next.compatibility += 1;
			next.feature = 0;
			next.patch = 0;
			break;
		case "feature":
			next.feature += 1;
			next.patch = 0;
			break;
		case "patch":
			next.patch += 1;
			break;
		default:
			throw new Error(`Unknown version tier: ${tier}`);
	}
	return next;
}

/** Generate yyMMdd plus the final six digits of the UTC Unix timestamp. */
export function createBuildId(now = new Date()) {
	if (Number.isNaN(now.getTime())) throw new Error("Build time is invalid");
	const two = (value) => String(value).padStart(2, "0");
	const date = `${two(now.getUTCFullYear() % 100)}${two(now.getUTCMonth() + 1)}${two(now.getUTCDate())}`;
	const epochSuffix = String(Math.floor(now.getTime() / 1000))
		.padStart(6, "0")
		.slice(-6);
	return `${date}${epochSuffix}`;
}

/** Return components affected by repository-relative changed paths. */
export function componentsForPaths(paths) {
	const normalized = paths.map((entry) => entry.replaceAll("\\", "/"));
	if (
		normalized.some((entry) =>
			SHARED_RELEASE_PATHS.some(
				(shared) => entry === shared || entry.startsWith(shared),
			),
		)
	) {
		return [...COMPONENTS];
	}
	return COMPONENTS.filter((component) =>
		normalized.some(
			(entry) =>
				entry.startsWith(`${component}/`) &&
				entry !== COMPONENT_FILES[component],
		),
	);
}

/** Read and structurally validate one component's version declaration. */
export function readVersionRecord(component, repoRoot = root) {
	if (!COMPONENTS.includes(component)) {
		throw new Error(`Unknown component: ${component}`);
	}
	const file = path.join(repoRoot, COMPONENT_FILES[component]);
	const record = JSON.parse(readFileSync(file, "utf8"));
	if (record.component !== component) {
		throw new Error(`${file} declares component ${record.component}`);
	}
	parseVersion(record.version);
	for (const peer of COMPONENTS.filter((name) => name !== component)) {
		const range = record.compatibility?.[peer];
		if (!range)
			throw new Error(`${component} has no compatibility range for ${peer}`);
		const min = parseVersion(range.min);
		const max = parseVersion(range.max_exclusive);
		if (compareVersions(min, max) >= 0) {
			throw new Error(
				`${component} has an empty compatibility range for ${peer}`,
			);
		}
	}
	return record;
}

/** Compare parsed versions lexicographically across all four tiers. */
export function compareVersions(left, right) {
	for (const key of ["major", "compatibility", "feature", "patch"]) {
		if (left[key] !== right[key]) return left[key] - right[key];
	}
	return 0;
}

/** Determine whether a version is inside a half-open compatibility range. */
export function versionInRange(version, range) {
	const parsed = typeof version === "string" ? parseVersion(version) : version;
	return (
		compareVersions(parsed, parseVersion(range.min)) >= 0 &&
		compareVersions(parsed, parseVersion(range.max_exclusive)) < 0
	);
}

/** Persist one tier increment without altering compatibility declarations. */
export function bumpComponent(component, tier, repoRoot = root) {
	const record = readVersionRecord(component, repoRoot);
	const previous = parseVersion(record.version);
	const next = bumpVersion(previous, tier);
	record.version = formatVersion(next);
	const file = path.join(repoRoot, COMPONENT_FILES[component]);
	writeFileSync(file, `${JSON.stringify(record, null, "\t")}\n`);
	if (formatEcosystemVersion(previous) !== formatEcosystemVersion(next)) {
		syncEcosystemVersion(component, next, repoRoot);
	}
	return record.version;
}

/** Synchronize three-part package metadata after a public version tier changes. */
export function syncEcosystemVersion(component, version, repoRoot = root) {
	const ecosystemVersion = formatEcosystemVersion(version);
	if (component === "frontend") {
		for (const relative of FRONTEND_PACKAGE_FILES) {
			const file = path.join(repoRoot, relative);
			const manifest = JSON.parse(readFileSync(file, "utf8"));
			manifest.version = ecosystemVersion;
			const indentation = relative === "package.json" ? "\t" : "  ";
			writeFileSync(file, `${JSON.stringify(manifest, null, indentation)}\n`);
		}
		const cargo = path.join(repoRoot, "frontend/src-tauri/Cargo.toml");
		writeCargoPackageVersion(cargo, ecosystemVersion);
		refreshCargoLock(repoRoot, "frontend/src-tauri/Cargo.toml");
	}
	if (component === "engine") {
		const cargo = path.join(repoRoot, "engine/Cargo.toml");
		writeCargoPackageVersion(cargo, ecosystemVersion);
		refreshCargoLock(repoRoot, "engine/Cargo.toml");
	}
}

/** Update the first package/workspace version without touching dependency versions. */
function writeCargoPackageVersion(file, version) {
	const source = readFileSync(file, "utf8");
	const updated = source.replace(
		/^(\s*version\s*=\s*")[^"]+("\s*)$/m,
		`$1${version}$2`,
	);
	if (updated === source) throw new Error(`${file} has no package version`);
	writeFileSync(file, updated);
}

/** Ask Cargo to refresh only workspace package metadata in the existing lockfile. */
function refreshCargoLock(repoRoot, manifest) {
	execFileSync(
		"cargo",
		[
			"metadata",
			"--no-deps",
			"--format-version",
			"1",
			"--manifest-path",
			manifest,
		],
		{ cwd: repoRoot, stdio: "ignore" },
	);
}

function changedPaths(base, head) {
	return execFileSync("git", ["diff", "--name-only", base, head], {
		cwd: root,
		encoding: "utf8",
	})
		.split(/\r?\n/)
		.map((entry) => entry.trim())
		.filter(Boolean);
}

function option(argv, name) {
	const index = argv.indexOf(name);
	if (index === -1 || !argv[index + 1]) throw new Error(`${name} is required`);
	return argv[index + 1];
}

function runCli(argv) {
	const [command, ...args] = argv;
	if (command === "show") {
		for (const component of COMPONENTS) {
			const record = readVersionRecord(component);
			console.log(`${component}: ${record.version}`);
		}
		return;
	}
	if (command === "build-id") {
		console.log(createBuildId());
		return;
	}
	if (command === "bump") {
		const [component, tier] = args;
		console.log(`${component}: ${bumpComponent(component, tier)}`);
		return;
	}
	if (command === "auto") {
		const base = option(args, "--base");
		const head = option(args, "--head");
		const components = componentsForPaths(changedPaths(base, head));
		for (const component of components) {
			console.log(`${component}: ${bumpComponent(component, "patch")}`);
		}
		return;
	}
	throw new Error(
		"Usage: versioning.mjs <show|build-id|bump COMPONENT TIER|auto --base REF --head REF>",
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

// Selects the CI jobs affected by all paths in one push or pull request range.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COMPONENTS = ["frontend", "gateway", "engine"];

/** Normalize repository-relative paths before matching CI ownership rules. */
function normalizeRepoPath(entry) {
	return String(entry).trim().replaceAll("\\", "/").replace(/^\.\//, "");
}

/** Match a directory prefix while also accepting the directory entry itself. */
function matchesPrefix(entry, prefix) {
	return entry === prefix.slice(0, -1) || entry.startsWith(prefix);
}

/** Identify prose and repository automation owned by the workspace job. */
function isWorkspacePath(entry) {
	const lower = entry.toLowerCase();
	const basename = lower.split("/").at(-1) ?? "";
	return (
		matchesPrefix(lower, "docs/") ||
		lower.includes("/docs/") ||
		matchesPrefix(lower, ".github/") ||
		matchesPrefix(lower, "scripts/") ||
		/^(?:readme|changelog)(?:\.[^/]*)?\.md$/.test(basename) ||
		/^license(?:\.[^/]*)?$/.test(basename)
	);
}

/** Return the stable job-output map for a collection of changed paths. */
export function ciJobsForPaths(paths) {
	const changed = [...new Set(paths.map(normalizeRepoPath).filter(Boolean))];
	const jobs = { docs: false, frontend: false, gateway: false, engine: false };
	for (const entry of changed) {
		if (matchesPrefix(entry, "proto/")) {
			jobs.gateway = true;
			jobs.engine = true;
			continue;
		}
		if (
			matchesPrefix(entry, "skills/") ||
			matchesPrefix(entry, "plugins/")
		) {
			jobs.engine = true;
			continue;
		}
		if (isWorkspacePath(entry)) {
			jobs.docs = true;
			continue;
		}
		const component = COMPONENTS.find((name) =>
			matchesPrefix(entry, `${name}/`),
		);
		if (component) jobs[component] = true;
		else jobs.docs = true;
	}
	return jobs;
}

/** Read one required named CLI option. */
function option(argv, name) {
	const index = argv.indexOf(name);
	if (index === -1 || !argv[index + 1]) throw new Error(`${name} is required`);
	return argv[index + 1];
}

/** List changed paths using push or pull-request diff semantics. */
function changedPaths(base, head, mode) {
	const commonArgs = ["--name-only", "-z", "--diff-filter=ACDMRTUXB"];
	let args;
	if (/^0+$/.test(base)) {
		args = ["diff-tree", "--root", "--no-commit-id", "-r", ...commonArgs, head];
	} else {
		const separator = mode === "merge-base" ? "..." : "..";
		args = ["diff", ...commonArgs, `${base}${separator}${head}`];
	}
	return execFileSync("git", args, { cwd: root })
		.toString("utf8")
		.split("\0")
		.filter(Boolean);
}

/** Append boolean selections using the GitHub Actions output protocol. */
function writeGitHubOutputs(file, jobs) {
	for (const [job, selected] of Object.entries(jobs)) {
		appendFileSync(file, `${job}=${selected}\n`);
	}
}

/** Calculate and publish job selections for one workflow event range. */
function runCli(argv) {
	const base = option(argv, "--base");
	const head = option(argv, "--head");
	const mode = option(argv, "--mode");
	const githubOutput = option(argv, "--github-output");
	if (!new Set(["direct", "merge-base"]).has(mode)) {
		throw new Error(`Unknown diff mode: ${mode}`);
	}
	const changed = changedPaths(base, head, mode);
	const jobs = ciJobsForPaths(changed);
	writeGitHubOutputs(githubOutput, jobs);
	console.log(`Changed paths (${changed.length}): ${changed.join(", ")}`);
	console.log(
		`Selected jobs: ${Object.entries(jobs)
			.filter(([, selected]) => selected)
			.map(([job]) => job)
			.join(", ") || "none"}`,
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

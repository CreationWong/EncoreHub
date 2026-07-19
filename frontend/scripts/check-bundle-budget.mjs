import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

export const DEFAULT_BUDGET_KIB = 300;

function requireManifestRecord(manifest, key) {
	const record = manifest[key];
	if (
		!record ||
		typeof record !== "object" ||
		typeof record.file !== "string"
	) {
		throw new Error(`Invalid Vite manifest entry: ${key}`);
	}
	return record;
}

function resolveInsideDist(distDir, file) {
	const resolved = path.resolve(distDir, file);
	const relative = path.relative(distDir, resolved);
	if (
		relative === ".." ||
		relative.startsWith(`..${path.sep}`) ||
		path.isAbsolute(relative)
	) {
		throw new Error(`Manifest file escapes dist directory: ${file}`);
	}
	return resolved;
}

export async function checkBundleBudget({
	distDir = path.resolve("dist"),
	budgetKiB = DEFAULT_BUDGET_KIB,
} = {}) {
	if (!Number.isFinite(budgetKiB) || budgetKiB <= 0) {
		throw new Error(
			`Bundle budget must be a positive number, received: ${budgetKiB}`,
		);
	}

	const manifestPath = path.join(distDir, ".vite", "manifest.json");
	const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
	const entrypoints = Object.entries(manifest)
		.filter(([, record]) => record?.isEntry === true)
		.map(([key]) => key)
		.sort();

	if (entrypoints.length === 0) {
		throw new Error("Vite manifest does not contain an entrypoint");
	}

	const visitedEntries = new Set();
	const initialFiles = new Set();

	function visit(key) {
		if (visitedEntries.has(key)) return;
		visitedEntries.add(key);

		const record = requireManifestRecord(manifest, key);
		if (/\.m?js$/i.test(record.file)) initialFiles.add(record.file);

		const imports = record.imports ?? [];
		if (!Array.isArray(imports)) {
			throw new Error(`Invalid imports list in Vite manifest entry: ${key}`);
		}
		for (const importedKey of imports) visit(importedKey);
	}

	for (const entrypoint of entrypoints) visit(entrypoint);
	if (initialFiles.size === 0) {
		throw new Error("Vite entrypoint graph does not contain JavaScript");
	}

	const files = [];
	for (const file of [...initialFiles].sort()) {
		const content = await readFile(resolveInsideDist(distDir, file));
		files.push({
			file,
			bytes: content.byteLength,
			gzipBytes: gzipSync(content).byteLength,
		});
	}

	const bytes = files.reduce((sum, file) => sum + file.bytes, 0);
	const gzipBytes = files.reduce((sum, file) => sum + file.gzipBytes, 0);
	const budgetBytes = Math.round(budgetKiB * 1024);
	const report = {
		schemaVersion: 1,
		budgetKiB,
		budgetBytes,
		entrypoints,
		initialJavaScript: {
			bytes,
			gzipBytes,
			gzipKiB: Number((gzipBytes / 1024).toFixed(2)),
			files,
		},
		passed: gzipBytes <= budgetBytes,
	};

	await writeFile(
		path.join(distDir, "bundle-budget.json"),
		`${JSON.stringify(report, null, 2)}\n`,
	);
	return report;
}

async function main() {
	const rawBudget = process.env.BUNDLE_BUDGET_KIB;
	const budgetKiB = rawBudget ? Number(rawBudget) : DEFAULT_BUDGET_KIB;
	const report = await checkBundleBudget({ budgetKiB });
	const actual = report.initialJavaScript.gzipKiB.toFixed(2);
	const limit = report.budgetKiB.toFixed(2);

	console.log(`Initial JavaScript gzip: ${actual} KiB / ${limit} KiB`);
	for (const file of report.initialJavaScript.files) {
		console.log(
			`  ${file.file}: ${(file.gzipBytes / 1024).toFixed(2)} KiB gzip`,
		);
	}

	if (!report.passed) {
		throw new Error(
			`Initial JavaScript gzip size ${actual} KiB exceeds ${limit} KiB budget`,
		);
	}
}

const isCli =
	process.argv[1] &&
	pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isCli) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	});
}

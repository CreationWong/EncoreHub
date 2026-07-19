import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { gzipSync } from "node:zlib";
import { checkBundleBudget } from "./check-bundle-budget.mjs";

const fixtureDirs = new Set();

afterEach(async () => {
	await Promise.all(
		[...fixtureDirs].map((directory) =>
			rm(directory, { recursive: true, force: true }),
		),
	);
	fixtureDirs.clear();
});

async function createFixture() {
	const distDir = await mkdtemp(
		path.join(tmpdir(), "encorehub-bundle-budget-"),
	);
	fixtureDirs.add(distDir);
	await mkdir(path.join(distDir, ".vite"));
	await mkdir(path.join(distDir, "assets"));

	const files = {
		"assets/entry.js": "import './shared.js'; console.log('entry');",
		"assets/shared.js": "export const shared = 'shared dependency';",
		"assets/lazy.js": "console.log('lazy syntax highlighter');".repeat(200),
	};
	await Promise.all(
		Object.entries(files).map(([file, contents]) =>
			writeFile(path.join(distDir, file), contents),
		),
	);

	const manifest = {
		"index.html": {
			file: "assets/entry.js",
			isEntry: true,
			imports: ["_shared.js", "_shared.js"],
			dynamicImports: ["src/lazy.tsx"],
		},
		"_shared.js": {
			file: "assets/shared.js",
			imports: [],
		},
		"src/lazy.tsx": {
			file: "assets/lazy.js",
			isDynamicEntry: true,
		},
	};
	await writeFile(
		path.join(distDir, ".vite", "manifest.json"),
		JSON.stringify(manifest),
	);
	return { distDir, files };
}

test("counts the complete initial static graph and excludes dynamic imports", async () => {
	const { distDir, files } = await createFixture();
	const report = await checkBundleBudget({ distDir, budgetKiB: 300 });

	const expectedFiles = ["assets/entry.js", "assets/shared.js"];
	const expectedGzipBytes = expectedFiles.reduce(
		(sum, file) => sum + gzipSync(files[file]).byteLength,
		0,
	);

	assert.equal(report.passed, true);
	assert.deepEqual(
		report.initialJavaScript.files.map((file) => file.file),
		expectedFiles,
	);
	assert.equal(report.initialJavaScript.gzipBytes, expectedGzipBytes);
	assert.ok(
		!report.initialJavaScript.files.some(
			(file) => file.file === "assets/lazy.js",
		),
	);

	const savedReport = JSON.parse(
		await readFile(path.join(distDir, "bundle-budget.json"), "utf8"),
	);
	assert.equal(savedReport.initialJavaScript.gzipBytes, expectedGzipBytes);
});

test("writes a failing report when the initial graph exceeds the budget", async () => {
	const { distDir } = await createFixture();
	const report = await checkBundleBudget({ distDir, budgetKiB: 0.001 });

	assert.equal(report.passed, false);
	assert.ok(report.initialJavaScript.gzipBytes > report.budgetBytes);
	const savedReport = JSON.parse(
		await readFile(path.join(distDir, "bundle-budget.json"), "utf8"),
	);
	assert.equal(savedReport.passed, false);
});

test("rejects an entrypoint graph without JavaScript", async () => {
	const { distDir } = await createFixture();
	await writeFile(
		path.join(distDir, ".vite", "manifest.json"),
		JSON.stringify({
			"index.html": { file: "index.html", isEntry: true },
		}),
	);

	await assert.rejects(
		() => checkBundleBudget({ distDir, budgetKiB: 300 }),
		/does not contain JavaScript/,
	);
});

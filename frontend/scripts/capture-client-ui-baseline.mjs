import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = fileURLToPath(new URL("..", import.meta.url));
const repositoryRoot = path.resolve(frontendRoot, "..");
const baselineDate = process.env.UI_BASELINE_DATE ?? "2026-07-24";
const baseUrl = (
	process.env.UI_BASELINE_URL ?? "http://127.0.0.1:1420"
).replace(/\/$/, "");
const outputDirectory = path.resolve(
	process.env.UI_BASELINE_OUTPUT ??
		path.join(repositoryRoot, "docs", "ui-baseline", baselineDate),
);

const captures = [
	...["light", "dark"].flatMap((theme) =>
		[
			{ width: 1600, height: 1120 },
			{ width: 1200, height: 800 },
			{ width: 900, height: 700 },
			{ width: 680, height: 480 },
		].map(({ width, height }) => ({
			name: `long-markdown-${theme}-${width}x${height}`,
			scenario: "long-markdown",
			theme,
			width,
			height,
			sidebar: "conversations",
		})),
	),
	{
		name: "streaming-dark-1200x800",
		scenario: "streaming",
		theme: "dark",
		width: 1200,
		height: 800,
		sidebar: "conversations",
	},
	{
		name: "failed-light-1200x800",
		scenario: "failed",
		theme: "light",
		width: 1200,
		height: 800,
		sidebar: "conversations",
	},
	{
		name: "providers-locked-light-1200x800",
		scenario: "providers-locked",
		theme: "light",
		width: 1200,
		height: 800,
		sidebar: "conversations",
	},
	{
		name: "characters-light-1200x800",
		scenario: "long-markdown",
		theme: "light",
		width: 1200,
		height: 800,
		sidebar: "characters",
	},
	{
		name: "sidebar-closed-light-1200x800",
		scenario: "long-markdown",
		theme: "light",
		width: 1200,
		height: 800,
		sidebar: "closed",
	},
	{
		name: "provider-unavailable-light-900x700",
		scenario: "provider-unavailable",
		theme: "light",
		width: 900,
		height: 700,
		sidebar: "conversations",
	},
	{
		name: "focus-mode-dark-1200x800",
		scenario: "long-markdown",
		theme: "dark",
		width: 1200,
		height: 800,
		sidebar: "focus",
	},
];

function browserCandidates() {
	if (process.env.CHROME_PATH) return [process.env.CHROME_PATH];

	if (process.platform === "win32") {
		return [
			path.join(
				process.env.PROGRAMFILES ?? "C:\\Program Files",
				"Google",
				"Chrome",
				"Application",
				"chrome.exe",
			),
			path.join(
				process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)",
				"Microsoft",
				"Edge",
				"Application",
				"msedge.exe",
			),
			path.join(
				process.env.LOCALAPPDATA ?? "",
				"Microsoft",
				"Edge",
				"Application",
				"msedge.exe",
			),
		];
	}

	if (process.platform === "darwin") {
		return [
			"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
			"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
			"/Applications/Chromium.app/Contents/MacOS/Chromium",
		];
	}

	return [
		"/usr/bin/google-chrome",
		"/usr/bin/google-chrome-stable",
		"/usr/bin/chromium",
		"/usr/bin/chromium-browser",
		"/usr/bin/microsoft-edge",
	];
}

function findBrowser() {
	const browser = browserCandidates().find((candidate) =>
		existsSync(candidate),
	);
	if (browser) return browser;
	throw new Error(
		"No Chrome-compatible browser found. Set CHROME_PATH to an executable path.",
	);
}

function readPngDimensions(file) {
	const data = readFileSync(file);
	const pngSignature = "89504e470d0a1a0a";
	if (
		data.length < 24 ||
		data.subarray(0, 8).toString("hex") !== pngSignature
	) {
		throw new Error(`Capture is not a valid PNG: ${file}`);
	}
	return {
		width: data.readUInt32BE(16),
		height: data.readUInt32BE(20),
		sha256: createHash("sha256").update(data).digest("hex"),
	};
}

async function assertBaselineServer() {
	let response;
	try {
		response = await fetch(`${baseUrl}/ui-baseline.html`, {
			signal: AbortSignal.timeout(5000),
		});
	} catch (cause) {
		throw new Error(
			`UI baseline server is unavailable at ${baseUrl}. Start it with: pnpm --dir frontend dev --host 127.0.0.1`,
			{ cause },
		);
	}
	if (!response.ok) {
		throw new Error(`UI baseline server returned HTTP ${response.status}`);
	}
}

async function main() {
	await assertBaselineServer();
	const browser = findBrowser();
	mkdirSync(outputDirectory, { recursive: true });

	const results = [];
	for (const capture of captures) {
		const outputPath = path.join(outputDirectory, `${capture.name}.png`);
		rmSync(outputPath, { force: true });
		const profileDirectory = mkdtempSync(
			path.join(tmpdir(), "encorehub-ui-baseline-"),
		);
		const url = new URL("/ui-baseline.html", baseUrl);
		url.searchParams.set("scenario", capture.scenario);
		url.searchParams.set("theme", capture.theme);
		url.searchParams.set("sidebar", capture.sidebar);

		try {
			const command = spawnSync(
				browser,
				[
					"--headless=new",
					"--disable-gpu",
					"--no-first-run",
					"--disable-default-apps",
					"--force-device-scale-factor=1",
					"--run-all-compositor-stages-before-draw",
					"--virtual-time-budget=2500",
					`--user-data-dir=${profileDirectory}`,
					`--window-size=${capture.width},${capture.height}`,
					`--screenshot=${outputPath}`,
					url.toString(),
				],
				{ encoding: "utf8", timeout: 30_000 },
			);

			if (command.error) throw command.error;
			if (!existsSync(outputPath)) {
				throw new Error(
					`Browser did not produce ${capture.name}: ${command.stderr.trim()}`,
				);
			}

			const image = readPngDimensions(outputPath);
			if (image.width !== capture.width || image.height !== capture.height) {
				throw new Error(
					`Unexpected dimensions for ${capture.name}: ${image.width}x${image.height}`,
				);
			}

			results.push({
				...capture,
				file: path.basename(outputPath),
				bytes: statSync(outputPath).size,
				sha256: image.sha256,
			});
			console.log(`captured ${capture.name}`);
		} finally {
			rmSync(profileDirectory, { force: true, recursive: true });
		}
	}

	const manifest = {
		schemaVersion: 1,
		baselineDate,
		baseUrl,
		browser: path.basename(browser),
		captures: results,
	};
	writeFileSync(
		path.join(outputDirectory, "manifest.json"),
		`${JSON.stringify(manifest, null, 2)}\n`,
	);
	console.log(`wrote ${results.length} captures to ${outputDirectory}`);
}

await main();

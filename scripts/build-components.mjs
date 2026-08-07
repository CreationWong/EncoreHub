import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCargoTargetDir } from "./prepare-engine-runtime.mjs";
import { resolveProtoc } from "./resolve-protoc.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const allowed = new Set([
	"desktop",
	"engine",
	"engine-standalone",
	"frontend",
	"gateway",
]);

export function parseComponentArgs(argv) {
	const options = { components: [], release: true };
	for (let index = 0; index < argv.length; index += 1) {
		const value = argv[index];
		if (value === "--components") {
			options.components.push(
				...argv[++index]
					.split(",")
					.map((entry) => entry.trim())
					.filter(Boolean),
			);
		} else if (value === "--debug") options.release = false;
		else if (value === "--release") options.release = true;
		else throw new Error(`Unknown argument: ${value}`);
	}
	if (options.components.length === 0) {
		throw new Error(
			"Specify one or more components: desktop, engine, engine-standalone, frontend, gateway",
		);
	}
	options.components = [...new Set(options.components)];
	for (const component of options.components) {
		if (!allowed.has(component))
			throw new Error(`Unknown component: ${component}`);
	}
	return options;
}

function run(command, args, cwd = root, env = process.env) {
	console.log(`\n-- ${[command, ...args].join(" ")} --`);
	const result = spawnSync(command, args, {
		cwd,
		env,
		stdio: "inherit",
		shell: process.platform === "win32" && command.endsWith(".cmd"),
	});
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(`${command} exited with status ${result.status}`);
	}
}

function hostTarget() {
	const result = spawnSync("rustc", ["-vV"], {
		cwd: root,
		encoding: "utf8",
		shell: false,
	});
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error("rustc -vV failed");
	const target = result.stdout.match(/^host:\s*(.+)$/m)?.[1]?.trim();
	if (!target) throw new Error("could not determine Rust host target triple");
	return target;
}

function runtimeLibraryName(target) {
	if (target.includes("windows")) return "encorehub_desktop_runtime.dll";
	if (target.includes("apple-darwin"))
		return "libencorehub_desktop_runtime.dylib";
	return "libencorehub_desktop_runtime.so";
}

function sidecarName(target) {
	return target.includes("windows")
		? `encorehub-gateway-${target}.exe`
		: `encorehub-gateway-${target}`;
}

function requireDesktopModules(release) {
	const target = hostTarget();
	const binaries = path.join(root, "frontend", "src-tauri", "binaries");
	const engineManifestPath = path.join(binaries, "engine-runtime.json");
	const gatewayManifestPath = path.join(binaries, "gateway-runtime.json");
	const required = [
		path.join(binaries, runtimeLibraryName(target)),
		engineManifestPath,
		path.join(binaries, sidecarName(target)),
		gatewayManifestPath,
	];
	const missing = required.filter((file) => !existsSync(file));
	if (missing.length > 0) {
		throw new Error(
			`Desktop modules are missing:\n${missing.join("\n")}\nBuild engine and gateway components first.`,
		);
	}
	const expectedProfile = release ? "release" : "debug";
	for (const manifestPath of [engineManifestPath, gatewayManifestPath]) {
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
		if (manifest.target !== target || manifest.profile !== expectedProfile) {
			throw new Error(
				`${manifest.module} is ${manifest.profile}/${manifest.target}; desktop requires ${expectedProfile}/${target}`,
			);
		}
	}
	const engineManifest = JSON.parse(readFileSync(engineManifestPath, "utf8"));
	if (engineManifest.abiVersion !== 1) {
		throw new Error(
			`Engine Runtime ABI ${engineManifest.abiVersion} is incompatible with Desktop ABI 1`,
		);
	}
}

export function buildComponents(options) {
	process.env.CARGO_TARGET_DIR = resolveCargoTargetDir(root);
	const selected = new Set(options.components);
	const profileFlag = options.release ? "--release" : "--debug";

	if (selected.has("engine")) {
		run("node", ["scripts/prepare-engine-runtime.mjs", profileFlag]);
	}
	if (selected.has("engine-standalone")) {
		const args = [
			"build",
			"--manifest-path",
			"engine/Cargo.toml",
			"--features",
			"standalone",
			"--bin",
			"encorehub-engine",
		];
		if (options.release) args.push("--release");
		run("cargo", args, root, {
			...process.env,
			PROTOC: resolveProtoc(root),
		});
	}
	if (selected.has("gateway")) {
		run("node", ["scripts/prepare-gateway-sidecar.mjs", profileFlag]);
	}
	if (selected.has("frontend") && !selected.has("desktop")) {
		run(pnpm, ["--dir", "frontend", "build"]);
	}
	if (selected.has("desktop")) {
		requireDesktopModules(options.release);
		const args = ["--dir", "frontend", "tauri", "build"];
		if (!options.release) args.push("--debug", "--no-bundle");
		run(pnpm, args);
	}

	console.log(
		`\nBuilt components (${options.release ? "release" : "debug"}): ${options.components.join(", ")}`,
	);
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	buildComponents(parseComponentArgs(process.argv.slice(2)));
}

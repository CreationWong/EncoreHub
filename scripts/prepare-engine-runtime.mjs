import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveProtoc } from "./resolve-protoc.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const engineDir = path.join(root, "engine");
const binariesDir = path.join(root, "frontend", "src-tauri", "binaries");

function run(command, args, cwd = root, env = process.env) {
	const result = spawnSync(command, args, {
		cwd,
		env,
		stdio: "inherit",
		shell: false,
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
	if (result.status !== 0)
		throw new Error(`rustc exited with status ${result.status}`);
	const target = result.stdout.match(/^host:\s*(.+)$/m)?.[1]?.trim();
	if (!target)
		throw new Error("could not determine the Rust host target triple");
	return target;
}

function libraryName(target) {
	if (target.includes("windows")) return "encorehub_desktop_runtime.dll";
	if (target.includes("apple-darwin"))
		return "libencorehub_desktop_runtime.dylib";
	return "libencorehub_desktop_runtime.so";
}

function parseArgs(argv) {
	const options = { release: false, target: null };
	for (let index = 0; index < argv.length; index += 1) {
		if (argv[index] === "--release") options.release = true;
		else if (argv[index] === "--debug") options.release = false;
		else if (argv[index] === "--target") options.target = argv[++index];
		else throw new Error(`Unknown argument: ${argv[index]}`);
	}
	return options;
}

export function resolveCargoTargetDir(
	repoRoot = root,
	configured = process.env.CARGO_TARGET_DIR,
) {
	if (configured) return path.resolve(repoRoot, configured);
	return path.join(repoRoot, "frontend", "src-tauri", "target");
}

function main(argv) {
	const options = parseArgs(argv);
	const target = options.target ?? hostTarget();
	const profile = options.release ? "release" : "debug";
	const cargoTargetDir = resolveCargoTargetDir();
	const cargoArgs = [
		"build",
		"--manifest-path",
		path.join(engineDir, "Cargo.toml"),
		"-p",
		"encorehub-desktop-runtime",
	];
	if (options.release) cargoArgs.push("--release");
	if (options.target) cargoArgs.push("--target", target);
	run("cargo", cargoArgs, root, {
		...process.env,
		CARGO_TARGET_DIR: cargoTargetDir,
		PROTOC: resolveProtoc(root),
	});

	const fileName = libraryName(target);
	const sourceDir = options.target
		? path.join(cargoTargetDir, target, profile)
		: path.join(cargoTargetDir, profile);
	const source = path.join(sourceDir, fileName);
	const destination = path.join(binariesDir, fileName);
	mkdirSync(binariesDir, { recursive: true });
	copyFileSync(source, destination);

	const bytes = readFileSync(destination);
	const enginePackage = readFileSync(
		path.join(engineDir, "Cargo.toml"),
		"utf8",
	);
	const version =
		enginePackage.match(/^version\s*=\s*"([^"]+)"/m)?.[1] ?? "0.1.0";
	const manifest = {
		schemaVersion: 1,
		module: "encorehub-engine-runtime",
		version,
		abiVersion: 1,
		target,
		profile,
		file: fileName,
		size: bytes.length,
		sha256: createHash("sha256").update(bytes).digest("hex"),
	};
	writeFileSync(
		path.join(binariesDir, "engine-runtime.json"),
		`${JSON.stringify(manifest, null, 2)}\n`,
	);
	console.log(
		`Prepared ${fileName} (${profile}, ABI 1, ${target}; shared Cargo target ${cargoTargetDir})`,
	);
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	main(process.argv.slice(2));
}

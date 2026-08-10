import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveProtoc } from "./resolve-protoc.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const engineDir = path.join(root, "engine");
const binariesDir = path.join(root, "frontend", "src-tauri", "binaries");
const nativeDependenciesDir = path.join(binariesDir, "engine-native");

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

/** Resolve the separately packaged RUSTScrapling parser library name. */
function rustScraplingLibraryName(target) {
	if (target.includes("windows")) return "encorehub_rust_scrapling.dll";
	if (target.includes("apple-darwin"))
		return "libencorehub_rust_scrapling.dylib";
	return "libencorehub_rust_scrapling.so";
}

function dynamicCurlBuildEnv(target) {
	const env = { ...process.env };
	if (target.includes("windows-msvc")) {
		const vcpkgExe = resolveVcpkgExecutable(env);
		if (!vcpkgExe) {
			throw new Error(
				"vcpkg is required to build the Engine Runtime with shared libcurl on Windows; set VCPKG_EXE if it is not installed with Visual Studio",
			);
		}
		env.VCPKG_DEFAULT_TRIPLET ??= target.startsWith("aarch64")
			? "arm64-windows"
			: "x64-windows";
		const packageRoot = path.join(root, ".cache", "vcpkg-runtime");
		const installedRoot = path.join(packageRoot, "installed");
		mkdirSync(packageRoot, { recursive: true });
		writeFileSync(path.join(packageRoot, ".vcpkg-root"), "");
		run(
			vcpkgExe,
			[
				"install",
				`--triplet=${env.VCPKG_DEFAULT_TRIPLET}`,
				`--x-manifest-root=${root}`,
				`--x-install-root=${installedRoot}`,
			],
			root,
			env,
		);
		env.VCPKG_ROOT = packageRoot;
		env.VCPKGRS_DYNAMIC = "1";
	}
	return env;
}

function resolveVcpkgExecutable(env) {
	const candidates = [
		env.VCPKG_EXE,
		env.VCPKG_ROOT && path.join(env.VCPKG_ROOT, "vcpkg.exe"),
		env.VCPKG_INSTALLATION_ROOT &&
			path.join(env.VCPKG_INSTALLATION_ROOT, "vcpkg.exe"),
		"C:\\vcpkg\\vcpkg.exe",
		"C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\VC\\vcpkg\\vcpkg.exe",
		"C:\\Program Files\\Microsoft Visual Studio\\2022\\Professional\\VC\\vcpkg\\vcpkg.exe",
		"C:\\Program Files\\Microsoft Visual Studio\\2022\\Enterprise\\VC\\vcpkg\\vcpkg.exe",
		"C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools\\VC\\vcpkg\\vcpkg.exe",
	].filter(Boolean);
	return candidates.find((candidate) => existsSync(candidate));
}

function windowsCurlDependencies(runtimeLibrary, env) {
	const triplet = env.VCPKG_DEFAULT_TRIPLET;
	const binDir = path.join(env.VCPKG_ROOT, "installed", triplet, "bin");
	if (!existsSync(binDir)) {
		throw new Error(
			`vcpkg shared libraries are missing at ${binDir}; install curl:${triplet}`,
		);
	}
	const files = new Map(
		readdirSync(binDir)
			.filter((name) => name.toLowerCase().endsWith(".dll"))
			.map((name) => [name.toLowerCase(), name]),
	);
	if (![...files].some(([name]) => /^libcurl.*\.dll$/i.test(name))) {
		throw new Error(`shared libcurl DLL is missing at ${binDir}`);
	}
	const runtimeBytes = readFileSync(runtimeLibrary);
	const pending = [...files.values()].filter(
		(name) =>
			/^libcurl.*\.dll$/i.test(name) && binaryImportsName(runtimeBytes, name),
	);
	const dependencies = [];
	const visited = new Set();
	while (pending.length > 0) {
		const requested = pending.pop();
		const actual = files.get(requested.toLowerCase());
		if (!actual || visited.has(actual.toLowerCase())) continue;
		visited.add(actual.toLowerCase());
		const source = path.join(binDir, actual);
		dependencies.push({ source, name: actual });
		for (const imported of importedDllNames(source)) {
			if (files.has(imported.toLowerCase())) pending.push(imported);
		}
	}
	if (dependencies.length === 0) {
		throw new Error("Engine Runtime does not import the vcpkg shared libcurl DLL");
	}
	return dependencies;
}

function binaryImportsName(bytes, name) {
	return (
		bytes.indexOf(name, 0, "ascii") >= 0 ||
		bytes.indexOf(name.toLowerCase(), 0, "ascii") >= 0 ||
		bytes.indexOf(name.toUpperCase(), 0, "ascii") >= 0
	);
}

function importedDllNames(file) {
	const matches = readFileSync(file)
		.toString("latin1")
		.match(/[a-z0-9._+-]+\.dll/gi);
	return [...new Set(matches ?? [])];
}

function unixCurlDependencies(runtimeLibrary, target) {
	const command = target.includes("apple-darwin") ? "otool" : "ldd";
	const args = target.includes("apple-darwin")
		? ["-L", runtimeLibrary]
		: [runtimeLibrary];
	const result = spawnSync(command, args, { encoding: "utf8", shell: false });
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`${command} failed for ${runtimeLibrary}`);
	const candidates = result.stdout
		.split(/\r?\n/)
		.map((line) => {
			if (target.includes("apple-darwin")) {
				const source = line.trim().split(/\s+/)[0];
				return source?.includes("curl")
					? { source, name: path.basename(source) }
					: undefined;
			}
			const match = line.match(/(libcurl[^ ]*)\s+=>\s+(\/[^ ]+)/);
			return match ? { name: match[1], source: match[2] } : undefined;
		})
		.filter(Boolean);
	if (candidates.length === 0) {
		throw new Error(
			"Engine Runtime is not dynamically linked to libcurl; install the shared libcurl development package",
		);
	}
	return [...new Map(candidates.map((item) => [item.name, item])).values()];
}

function copyNativeDependencies(runtimeLibrary, target, env) {
	const sources = target.includes("windows-msvc")
		? windowsCurlDependencies(runtimeLibrary, env)
		: unixCurlDependencies(runtimeLibrary, target);
	rmSync(nativeDependenciesDir, { recursive: true, force: true });
	mkdirSync(nativeDependenciesDir, { recursive: true });
	return sources.map(({ source, name }) => {
		copyFileSync(source, path.join(nativeDependenciesDir, name));
		copyFileSync(source, path.join(binariesDir, name));
		return name;
	});
}

function makeMacDependenciesRelocatable(runtimeLibrary, dependencies, target) {
	if (!target.includes("apple-darwin")) return;
	for (const dependency of dependencies) {
		const result = spawnSync(
			"install_name_tool",
			["-change", dependency.source, `@loader_path/${dependency.name}`, runtimeLibrary],
			{ stdio: "inherit", shell: false },
		);
		if (result.error) throw result.error;
		if (result.status !== 0) throw new Error("install_name_tool failed");
	}
}

function assertRuntimeLinksCurl(runtimeLibrary, target) {
	if (target.includes("windows")) {
		const bytes = readFileSync(runtimeLibrary);
		if (!binaryImportsName(bytes, "libcurl.dll")) {
			throw new Error(
				"Engine Runtime does not import shared libcurl; refusing to package a statically linked fallback",
			);
		}
		return;
	}
	unixCurlDependencies(runtimeLibrary, target);
}

export function dynamicCurlRustflags(target, existing = "") {
	const flags = existing.trim();
	if (!target.includes("windows-msvc")) return flags;
	return `${flags} --cfg encorehub_dynamic_curl`.trim();
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
		"-p",
		"encorehub-rust-scrapling",
	];
	if (options.release) cargoArgs.push("--release");
	if (options.target) cargoArgs.push("--target", target);
	const buildEnv = dynamicCurlBuildEnv(target);
	buildEnv.RUSTFLAGS = dynamicCurlRustflags(target, buildEnv.RUSTFLAGS);
	if (!target.includes("windows")) {
		const origin = target.includes("apple-darwin") ? "@loader_path" : "$ORIGIN";
		buildEnv.RUSTFLAGS = `${buildEnv.RUSTFLAGS ?? ""} -C link-arg=-Wl,-rpath,${origin}`.trim();
	}
	const fileName = libraryName(target);
	const rustScraplingFileName = rustScraplingLibraryName(target);
	const sourceDir = options.target
		? path.join(cargoTargetDir, target, profile)
		: path.join(cargoTargetDir, profile);
	const source = path.join(sourceDir, fileName);
	const rustScraplingSource = path.join(sourceDir, rustScraplingFileName);
	rmSync(source, { force: true });
	rmSync(rustScraplingSource, { force: true });
	run("cargo", cargoArgs, root, {
		...buildEnv,
		CARGO_TARGET_DIR: cargoTargetDir,
		PROTOC: resolveProtoc(root),
	});

	const destination = path.join(binariesDir, fileName);
	const rustScraplingDestination = path.join(
		binariesDir,
		rustScraplingFileName,
	);
	mkdirSync(binariesDir, { recursive: true });
	assertRuntimeLinksCurl(source, target);
	const resolvedDependencies = target.includes("windows-msvc")
		? windowsCurlDependencies(source, buildEnv)
		: unixCurlDependencies(source, target);
	makeMacDependenciesRelocatable(source, resolvedDependencies, target);
	copyFileSync(source, destination);
	copyFileSync(rustScraplingSource, rustScraplingDestination);
	const nativeDependencies = copyNativeDependencies(source, target, buildEnv);

	const bytes = readFileSync(destination);
	const rustScraplingBytes = readFileSync(rustScraplingDestination);
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
		nativeDependencies,
		rustScrapling: {
			module: "encorehub-rust-scrapling",
			abiVersion: 1,
			file: rustScraplingFileName,
			size: rustScraplingBytes.length,
			sha256: createHash("sha256")
				.update(rustScraplingBytes)
				.digest("hex"),
		},
	};
	writeFileSync(
		path.join(binariesDir, "engine-runtime.json"),
		`${JSON.stringify(manifest, null, 2)}\n`,
	);
	console.log(
		`Prepared ${fileName} with ${nativeDependencies.join(", ")} and ${rustScraplingFileName} (${profile}, ABI 1, ${target}; shared Cargo target ${cargoTargetDir})`,
	);
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	main(process.argv.slice(2));
}

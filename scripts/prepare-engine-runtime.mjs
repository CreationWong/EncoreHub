// Builds the versioned Engine Runtime and RUSTScrapling dynamic libraries and
// repackages their copyable native dependencies (libcurl) plus the startup manifest.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveProtoc } from "./resolve-protoc.mjs";
import { createBuildId, readVersionRecord } from "./versioning.mjs";

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

/** MCP stdio server binary name; packaged next to the runtime libraries. */
function mcpBinaryName(target) {
	return target.includes("windows") ? "encorehub-mcp.exe" : "encorehub-mcp";
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
		throw new Error(
			"Engine Runtime does not import the vcpkg shared libcurl DLL",
		);
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

/** List the LC_RPATH search directories one Mach-O file declares. */
function macRpaths(file) {
	const result = spawnSync("otool", ["-l", file], {
		encoding: "utf8",
		shell: false,
	});
	if (result.error || result.status !== 0) return [];
	const lines = result.stdout.split(/\r?\n/);
	const paths = [];
	for (let index = 0; index < lines.length; index += 1) {
		if (lines[index].trim() !== "cmd LC_RPATH") continue;
		const match = lines[index + 2]?.trim().match(/^path (.+?) \(offset/);
		if (!match) continue;
		const entry = match[1].startsWith("@loader_path/")
			? path.join(path.dirname(file), match[1].slice("@loader_path/".length))
			: match[1];
		if (entry.startsWith("/")) paths.push(entry);
	}
	return paths;
}

/** Resolve one Mach-O dependency reference to the file that dyld would load. */
function resolveMacDependency(reference, file) {
	if (reference.startsWith("/")) return reference;
	if (reference.startsWith("@loader_path/")) {
		const candidate = path.join(
			path.dirname(file),
			reference.slice("@loader_path/".length),
		);
		return existsSync(candidate) ? candidate : undefined;
	}
	if (reference.startsWith("@rpath/")) {
		const name = reference.slice("@rpath/".length);
		for (const dir of [path.dirname(file), ...macRpaths(file)]) {
			const candidate = path.join(dir, name);
			if (existsSync(candidate)) return candidate;
		}
	}
	return undefined;
}

/** List the copyable dylibs one Mach-O file loads, excluding its own id. */
function macDylibDependencies(file) {
	const result = spawnSync("otool", ["-L", file], {
		encoding: "utf8",
		shell: false,
	});
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`otool failed for ${file}`);
	const ownName = path.basename(file);
	const references = result.stdout
		.split(/\r?\n/)
		.slice(1)
		.map((line) => line.trim().split(/\s+/)[0])
		.filter((entry) => entry?.startsWith("@") || entry?.startsWith("/"))
		.filter((entry) => path.basename(entry) !== ownName);
	const dependencies = [];
	for (const reference of references) {
		const source = resolveMacDependency(reference, file);
		if (!source) {
			throw new Error(`cannot resolve ${reference} referenced by ${file}`);
		}
		if (isSystemLibrary(source)) continue;
		dependencies.push({ reference, source, name: path.basename(reference) });
	}
	return dependencies;
}

/** Exclude Apple libraries, which dyld always resolves from the operating system. */
function isSystemLibrary(pathname) {
	return (
		pathname.startsWith("/usr/lib/") ||
		pathname.startsWith("/System/Library/") ||
		pathname.startsWith("/System/iOSSupport/") ||
		pathname.startsWith("/Library/Apple/")
	);
}

/** Collect the transitive closure of copyable Mach-O dependencies for packaging. */
function macNativeDependencies(runtimeLibrary) {
	const dependencies = new Map();
	const pending = macDylibDependencies(runtimeLibrary);
	while (pending.length > 0) {
		const dependency = pending.pop();
		if (dependencies.has(dependency.name)) continue;
		dependencies.set(dependency.name, dependency);
		for (const nested of macDylibDependencies(dependency.source)) {
			pending.push(nested);
		}
	}
	const closure = [...dependencies.values()];
	if (!closure.some(({ name }) => /^libcurl/i.test(name))) {
		throw new Error(
			"Engine Runtime is not dynamically linked to libcurl; install the shared libcurl development package",
		);
	}
	return closure;
}

/** Locate the keg-only Homebrew libcurl that macOS packaging can actually copy. */
function macCurlLibraryDir() {
	const candidates = [];
	const pkg = spawnSync("pkg-config", ["--variable=libdir", "libcurl"], {
		encoding: "utf8",
		shell: false,
	});
	if (pkg.status === 0 && pkg.stdout) candidates.push(pkg.stdout.trim());
	const brew = spawnSync("brew", ["--prefix", "curl"], {
		encoding: "utf8",
		shell: false,
	});
	if (brew.status === 0 && brew.stdout) {
		candidates.push(path.join(brew.stdout.trim(), "lib"));
	}
	const libdir = candidates.find(
		(candidate) =>
			candidate && existsSync(path.join(candidate, "libcurl.4.dylib")),
	);
	if (!libdir) {
		throw new Error(
			"macOS Engine Runtime packaging requires a shared libcurl; run 'brew install curl' or point PKG_CONFIG_PATH at a libcurl installation",
		);
	}
	return libdir;
}

/** Resolve the shared libcurl a Linux runtime was linked against. */
function unixCurlDependencies(runtimeLibrary) {
	const result = spawnSync("ldd", [runtimeLibrary], {
		encoding: "utf8",
		shell: false,
	});
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(`ldd failed for ${runtimeLibrary}`);
	}
	const candidates = result.stdout
		.split(/\r?\n/)
		.map((line) => line.match(/(libcurl[^ ]*)\s+=>\s+(\/[^ ]+)/))
		.filter(Boolean)
		.map((match) => ({ name: match[1], source: match[2] }));
	if (candidates.length === 0) {
		throw new Error(
			"Engine Runtime is not dynamically linked to libcurl; install the shared libcurl development package",
		);
	}
	return [...new Map(candidates.map((item) => [item.name, item])).values()];
}

/** Copy resolved dependencies into the packaged and development module layouts. */
function copyNativeDependencies(sources, target) {
	rmSync(nativeDependenciesDir, { recursive: true, force: true });
	mkdirSync(nativeDependenciesDir, { recursive: true });
	return sources.map(({ source, name }) => {
		const packaged = path.join(nativeDependenciesDir, name);
		copyFileSync(source, packaged);
		if (target.includes("apple-darwin")) {
			// Homebrew ships read-only dylibs and points every dependency at an
			// absolute Cellar path; make the copy writable, repoint it and its own
			// dependencies at @loader_path, then sign it again for arm64 dyld.
			chmodSync(packaged, 0o755);
			for (const nested of macDylibDependencies(source)) {
				run("install_name_tool", [
					"-change",
					nested.reference,
					`@loader_path/${nested.name}`,
					packaged,
				]);
			}
			run("install_name_tool", ["-id", `@loader_path/${name}`, packaged]);
			run("codesign", ["--force", "--sign", "-", packaged]);
			rmSync(path.join(binariesDir, name), { force: true });
			copyFileSync(packaged, path.join(binariesDir, name));
			return name;
		}
		copyFileSync(source, path.join(binariesDir, name));
		return name;
	});
}

/** Repoint the Runtime module's dependencies and ad-hoc sign it for arm64 dyld. */
function makeMacDependenciesRelocatable(runtimeLibrary, dependencies, target) {
	if (!target.includes("apple-darwin")) return;
	for (const dependency of dependencies) {
		run("install_name_tool", [
			"-change",
			dependency.reference,
			`@loader_path/${dependency.name}`,
			runtimeLibrary,
		]);
	}
	run("codesign", ["--force", "--sign", "-", runtimeLibrary]);
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
	if (target.includes("apple-darwin")) {
		macNativeDependencies(runtimeLibrary);
		return;
	}
	unixCurlDependencies(runtimeLibrary);
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
	const engineVersion = readVersionRecord("engine", root);
	const buildId = process.env.ENCOREHUB_BUILD_ID ?? createBuildId();
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
	buildEnv.ENCOREHUB_BUILD_ID = buildId;
	if (!target.includes("windows")) {
		const origin = target.includes("apple-darwin") ? "@loader_path" : "$ORIGIN";
		buildEnv.RUSTFLAGS =
			`${buildEnv.RUSTFLAGS ?? ""} -C link-arg=-Wl,-rpath,${origin}`.trim();
	}
	if (target.includes("apple-darwin")) {
		// curl-sys prefers Apple's uncopyable system libcurl; a native search path
		// makes the linker resolve the keg-only Homebrew dylib this script packages.
		buildEnv.RUSTFLAGS = `${buildEnv.RUSTFLAGS} -L native=${macCurlLibraryDir()}`;
	}
	const fileName = libraryName(target);
	const rustScraplingFileName = rustScraplingLibraryName(target);
	const mcpFileName = mcpBinaryName(target);
	const sourceDir = options.target
		? path.join(cargoTargetDir, target, profile)
		: path.join(cargoTargetDir, profile);
	const source = path.join(sourceDir, fileName);
	const rustScraplingSource = path.join(sourceDir, rustScraplingFileName);
	const mcpSource = path.join(sourceDir, mcpFileName);
	rmSync(source, { force: true });
	rmSync(rustScraplingSource, { force: true });
	rmSync(mcpSource, { force: true });
	run("cargo", cargoArgs, root, {
		...buildEnv,
		CARGO_TARGET_DIR: cargoTargetDir,
		PROTOC: resolveProtoc(root),
	});

	// The MCP stdio server ships next to the runtime libraries so it resolves
	// the same libcurl closure instead of a second packaging path.
	const mcpCargoArgs = [
		"build",
		"--manifest-path",
		path.join(engineDir, "Cargo.toml"),
		"-p",
		"encorehub-engine",
		"--features",
		"standalone",
		"--bin",
		"encorehub-mcp",
	];
	if (options.release) mcpCargoArgs.push("--release");
	if (options.target) mcpCargoArgs.push("--target", target);
	run("cargo", mcpCargoArgs, root, {
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
		: target.includes("apple-darwin")
			? macNativeDependencies(source)
			: unixCurlDependencies(source);
	// The MCP binary links the same shared curl; relocate it identically so
	// both artifacts stay loadable from the packaged lib directory.
	const mcpDependencies = target.includes("windows-msvc")
		? windowsCurlDependencies(mcpSource, buildEnv)
		: target.includes("apple-darwin")
			? macNativeDependencies(mcpSource)
			: unixCurlDependencies(mcpSource);
	makeMacDependenciesRelocatable(source, resolvedDependencies, target);
	makeMacDependenciesRelocatable(mcpSource, mcpDependencies, target);
	copyFileSync(source, destination);
	copyFileSync(rustScraplingSource, rustScraplingDestination);
	const dependencyUnion = [
		...new Map(
			[...resolvedDependencies, ...mcpDependencies].map((item) => [
				item.name,
				item,
			]),
		).values(),
	];
	const nativeDependencies = copyNativeDependencies(dependencyUnion, target);
	// copyNativeDependencies clears the directory first, so the MCP binary is
	// placed afterwards and lands beside its dylibs in the packaged lib dir.
	const mcpDestination = path.join(nativeDependenciesDir, mcpFileName);
	copyFileSync(mcpSource, mcpDestination);
	if (target.includes("apple-darwin")) {
		run("codesign", ["--force", "--sign", "-", mcpDestination]);
	}

	const bytes = readFileSync(destination);
	const rustScraplingBytes = readFileSync(rustScraplingDestination);
	const mcpBytes = readFileSync(mcpDestination);
	const manifest = {
		schemaVersion: 1,
		module: "encorehub-engine-runtime",
		version: engineVersion.version,
		build_id: buildId,
		compatibility: engineVersion.compatibility,
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
			sha256: createHash("sha256").update(rustScraplingBytes).digest("hex"),
		},
		mcp: {
			module: "encorehub-mcp",
			file: mcpFileName,
			size: mcpBytes.length,
			sha256: createHash("sha256").update(mcpBytes).digest("hex"),
		},
	};
	writeFileSync(
		path.join(binariesDir, "engine-runtime.json"),
		`${JSON.stringify(manifest, null, 2)}\n`,
	);
	console.log(
		`Prepared ${fileName} with ${nativeDependencies.join(", ")}, ${rustScraplingFileName}, and ${mcpFileName} (${profile}, ABI 1, ${target}; shared Cargo target ${cargoTargetDir})`,
	);
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	main(process.argv.slice(2));
}

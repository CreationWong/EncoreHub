/**
 * Builds the release-target open-source component manifest from installed,
 * production dependency graphs. Unknown licenses are fatal so a release
 * cannot silently publish an incomplete compliance list.
 */
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontendDir = path.join(root, "frontend");
const generatedManifest = path.join(
	frontendDir,
	"src",
	"components",
	"settings",
	"thirdPartyComponents.generated.json",
);
const generatedSummary = path.join(
	frontendDir,
	"src",
	"components",
	"settings",
	"thirdPartySummary.generated.ts",
);

/** Run a required local tool and return its stdout. */
export function run(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: root,
		encoding: "utf8",
		maxBuffer: 32 * 1024 * 1024,
		shell: false,
		...options,
	});
	if (result.error) throw result.error;
	if (result.status !== 0) {
		const detail = result.stderr?.trim() || result.stdout?.trim();
		throw new Error(
			`${command} exited with status ${result.status}${detail ? `: ${detail}` : ""}`,
		);
	}
	return result.stdout;
}

/** Resolve the Rust release triple from CLI, Tauri, or the host toolchain. */
export function resolveTarget(argv = process.argv.slice(2), env = process.env) {
	const targetIndex = argv.indexOf("--target");
	if (targetIndex >= 0) {
		const value = argv[targetIndex + 1];
		if (!value || value.startsWith("--")) {
			throw new Error("--target requires a Rust target triple");
		}
		return value;
	}
	if (env.TAURI_ENV_TARGET_TRIPLE) return env.TAURI_ENV_TARGET_TRIPLE;
	const verbose = run("rustc", ["-vV"]);
	const host = verbose.match(/^host:\s*(.+)$/m)?.[1]?.trim();
	if (!host) throw new Error("could not determine the Rust host target triple");
	return host;
}

/** Map a Rust target triple to the Go compiler target used by the sidecar. */
export function rustTargetToGo(target) {
	const goos = target.includes("windows")
		? "windows"
		: target.includes("apple-darwin")
			? "darwin"
			: target.includes("linux")
				? "linux"
				: null;
	const goarch = target.startsWith("x86_64-")
		? "amd64"
		: target.startsWith("aarch64-")
			? "arm64"
			: target.startsWith("i686-")
				? "386"
				: null;
	if (!goos || !goarch) {
		throw new Error(`unsupported desktop release target: ${target}`);
	}
	return { goos, goarch };
}

/** Normalize package-manager license fields into a usable SPDX expression. */
export function normalizeLicense(value) {
	if (typeof value === "string") {
		const normalized = value
			.trim()
			.replace(/^\((.+)\)$/, "$1")
			.replace(/\s*\/\s*/g, " OR ");
		if (normalized && !/^unknown|unlicensed$/i.test(normalized)) {
			return normalized;
		}
	}
	if (value && typeof value === "object" && typeof value.type === "string") {
		return normalizeLicense(value.type);
	}
	if (Array.isArray(value)) {
		const licenses = value.map(normalizeLicense).filter(Boolean);
		if (licenses.length > 0) return [...new Set(licenses)].join(" OR ");
	}
	return null;
}

/** Identify common open-source license texts shipped by Go modules. */
export function detectLicenseIdentifiers(text) {
	const identifiers = [];
	const add = (identifier) => {
		if (!identifiers.includes(identifier)) identifiers.push(identifier);
	};
	if (/Apache License[\s\S]{0,80}Version 2\.0/i.test(text)) add("Apache-2.0");
	if (/Mozilla Public License[\s\S]{0,80}2\.0/i.test(text)) add("MPL-2.0");
	if (
		/GNU (?:LESSER )?GENERAL PUBLIC LICENSE[\s\S]{0,80}Version 3/i.test(text)
	) {
		add(/LESSER/i.test(text.slice(0, 200)) ? "LGPL-3.0-only" : "GPL-3.0-only");
	}
	if (
		/Permission is hereby granted, free of charge, to any person obtaining\s+a copy/i.test(
			text,
		)
	) {
		add("MIT");
	}
	if (
		/Permission to use, copy, modify, and\/or distribute this software for any purpose with or without fee/i.test(
			text,
		)
	) {
		add("ISC");
	}
	if (/Redistribution and use in source and binary forms/i.test(text)) {
		add(
			/Neither the name|Neither this software nor the name/i.test(text)
				? "BSD-3-Clause"
				: "BSD-2-Clause",
		);
	}
	if (
		/This is free and unencumbered software released into the public domain/i.test(
			text,
		)
	) {
		add("Unlicense");
	}
	if (
		/This software is provided ['\u2018\u2019]as-is['\u2018\u2019][\s\S]*Permission is granted to anyone to use this software/i.test(
			text,
		)
	) {
		add("Zlib");
	}
	return identifiers;
}

/** Read and classify all license files at a Go module root. */
export function detectLicenseFromDirectory(directory) {
	const files = readdirSync(directory, { withFileTypes: true })
		.filter(
			(entry) =>
				entry.isFile() &&
				/^(?:licen[cs]e|copying)(?:[-_.].*)?$/i.test(entry.name),
		)
		.map((entry) => entry.name)
		.sort();
	const identifiers = [];
	for (const file of files) {
		const text = readFileSync(path.join(directory, file), "utf8");
		for (const identifier of detectLicenseIdentifiers(text)) {
			if (!identifiers.includes(identifier)) identifiers.push(identifier);
		}
	}
	return identifiers.length > 0 ? identifiers.join(" OR ") : null;
}

/** Find an installed pnpm dependency from the current package boundary. */
function resolveInstalledPackage(packageDirectory, packageName) {
	const segments = packageName.split("/");
	const candidates = [];
	let cursor = packageDirectory;
	while (cursor.startsWith(path.join(frontendDir, "node_modules"))) {
		candidates.push(
			path.join(cursor, "node_modules", ...segments, "package.json"),
		);
		if (path.basename(cursor) === "node_modules") {
			candidates.push(path.join(cursor, ...segments, "package.json"));
		}
		const parent = path.dirname(cursor);
		if (parent === cursor) break;
		cursor = parent;
	}
	candidates.push(
		path.join(frontendDir, "node_modules", ...segments, "package.json"),
	);
	for (const candidate of candidates) {
		if (existsSync(candidate)) return realpathSync(candidate);
	}
	return null;
}

/** Traverse only installed frontend production dependencies. */
export function collectNpmComponents() {
	const frontendPackage = JSON.parse(
		readFileSync(path.join(frontendDir, "package.json"), "utf8"),
	);
	const queue = Object.keys(frontendPackage.dependencies).map((name) => ({
		name,
		from: frontendDir,
		required: true,
	}));
	const visited = new Set();
	const components = [];
	while (queue.length > 0) {
		const request = queue.shift();
		const packageJsonPath = resolveInstalledPackage(request.from, request.name);
		if (!packageJsonPath) {
			if (request.required) {
				throw new Error(
					`npm production dependency is not installed: ${request.name}`,
				);
			}
			continue;
		}
		if (visited.has(packageJsonPath)) continue;
		visited.add(packageJsonPath);
		const manifest = JSON.parse(readFileSync(packageJsonPath, "utf8"));
		const license = normalizeLicense(manifest.license ?? manifest.licenses);
		if (!license) {
			throw new Error(
				`npm package has no recognized license: ${manifest.name}@${manifest.version}`,
			);
		}
		components.push({
			ecosystem: "npm",
			layer: "Interface",
			name: manifest.name,
			packageName: manifest.name,
			version: manifest.version,
			license,
		});
		const packageDirectory = path.dirname(packageJsonPath);
		for (const name of Object.keys(manifest.dependencies ?? {})) {
			queue.push({ name, from: packageDirectory, required: true });
		}
		for (const name of Object.keys(manifest.optionalDependencies ?? {})) {
			queue.push({ name, from: packageDirectory, required: false });
		}
	}
	return components;
}

/** Walk normal Cargo dependency edges from one or more package IDs. */
function cargoRuntimeClosure(metadata, roots) {
	const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
	const visited = new Set();
	const queue = [...roots];
	while (queue.length > 0) {
		const id = queue.shift();
		if (visited.has(id)) continue;
		visited.add(id);
		const node = nodes.get(id);
		for (const dependency of node?.deps ?? []) {
			const kinds = dependency.dep_kinds ?? [];
			if (kinds.length === 0 || kinds.some((kind) => kind.kind === null)) {
				queue.push(dependency.pkg);
			}
		}
	}
	return visited;
}

/** Load one target-filtered Cargo graph without build-only dependencies. */
function cargoMetadata(manifestPath, target) {
	return JSON.parse(
		run("cargo", [
			"metadata",
			"--manifest-path",
			manifestPath,
			"--locked",
			"--format-version",
			"1",
			"--filter-platform",
			target,
		]),
	);
}

/** Convert one runtime closure into licensed third-party component records. */
function cargoComponentsForRoots(metadata, rootNames, layer) {
	const roots = metadata.packages
		.filter((pkg) => rootNames.includes(pkg.name))
		.map((pkg) => pkg.id);
	if (roots.length !== rootNames.length) {
		throw new Error(
			`Cargo metadata is missing runtime roots: ${rootNames.join(", ")}`,
		);
	}
	const runtime = cargoRuntimeClosure(metadata, roots);
	return metadata.packages
		.filter(
			(pkg) =>
				runtime.has(pkg.id) && (pkg.source || pkg.name === "rust_scrapling"),
		)
		.map((pkg) => {
			const license = normalizeLicense(pkg.license);
			if (!license) {
				throw new Error(
					`Cargo package has no recognized license: ${pkg.name}@${pkg.version}`,
				);
			}
			return {
				ecosystem: "cargo",
				layer,
				name: pkg.name,
				packageName: pkg.name,
				version: pkg.version,
				license,
			};
		});
}

/** Collect target-filtered Rust crates from Desktop and independent runtimes. */
export function collectCargoComponents(target) {
	const desktopMetadata = cargoMetadata(
		path.join(frontendDir, "src-tauri", "Cargo.toml"),
		target,
	);
	const engineMetadata = cargoMetadata(
		path.join(root, "engine", "Cargo.toml"),
		target,
	);
	return [
		...cargoComponentsForRoots(
			desktopMetadata,
			["encorehub-desktop"],
			"Desktop",
		),
		...cargoComponentsForRoots(
			engineMetadata,
			["encorehub-desktop-runtime", "encorehub-rust-scrapling"],
			"Engine",
		),
	];
}

/** Collect Go modules compiled into the target-specific Gateway sidecar. */
export function collectGoComponents(target) {
	const { goos, goarch } = rustTargetToGo(target);
	const goCache = path.join(root, ".cache", "go-build", `${goos}-${goarch}`);
	mkdirSync(goCache, { recursive: true });
	const format =
		"{{with .Module}}{{if not .Main}}{{.Path}}\t{{.Version}}\t{{.Dir}}{{end}}{{end}}";
	const stdout = run(
		"go",
		["list", "-mod=readonly", "-deps", "-f", format, "./cmd/gateway"],
		{
			cwd: path.join(root, "gateway"),
			env: {
				...process.env,
				CGO_ENABLED: "0",
				GOCACHE: goCache,
				GOARCH: goarch,
				GOOS: goos,
			},
		},
	);
	const modules = new Map();
	for (const line of stdout.split(/\r?\n/)) {
		if (!line.trim()) continue;
		const [name, version, directory] = line.split("\t");
		if (name && version && directory)
			modules.set(`${name}@${version}`, { name, version, directory });
	}
	return [...modules.values()].map((module) => {
		const license = detectLicenseFromDirectory(module.directory);
		if (!license) {
			throw new Error(
				`Go module has no recognized license: ${module.name}@${module.version} (${module.directory})`,
			);
		}
		return {
			ecosystem: "go",
			layer: "Gateway",
			name: module.name,
			packageName: module.name,
			version: module.version.replace(/^v/, ""),
			license,
		};
	});
}

/** Deduplicate exact packages and keep a stable, reviewable output order. */
export function normalizeComponents(components) {
	const unique = new Map();
	for (const component of components) {
		const key = `${component.ecosystem}:${component.packageName}@${component.version}`;
		unique.set(key, component);
	}
	const layers = ["Interface", "Desktop", "Gateway", "Engine"];
	return [...unique.values()].sort(
		(left, right) =>
			layers.indexOf(left.layer) - layers.indexOf(right.layer) ||
			left.packageName.localeCompare(right.packageName) ||
			left.version.localeCompare(right.version),
	);
}

/** Serialize generated JSON using the same style enforced by Biome. */
export function serializeManifest(manifest) {
	return `${JSON.stringify(manifest, null, "\t")}\n`;
}

/** Generate both the full lazy-loaded manifest and its small eager summary. */
export function generateComplianceManifest(target) {
	const components = normalizeComponents([
		...collectNpmComponents(),
		...collectCargoComponents(target),
		...collectGoComponents(target),
	]);
	const manifest = {
		schemaVersion: 1,
		releaseTarget: target,
		components,
	};
	writeFileSync(generatedManifest, serializeManifest(manifest));
	writeFileSync(
		generatedSummary,
		`/** Generated by scripts/generate-oss-compliance.mjs. Do not edit. */\nexport const OSS_COMPONENT_COUNT = ${components.length};\nexport const OSS_RELEASE_TARGET = ${JSON.stringify(target)};\n`,
	);
	return manifest;
}

async function main() {
	const target = resolveTarget();
	const manifest = generateComplianceManifest(target);
	const counts = new Map();
	for (const component of manifest.components) {
		counts.set(component.ecosystem, (counts.get(component.ecosystem) ?? 0) + 1);
	}
	const summary = [...counts.entries()]
		.map(([ecosystem, count]) => `${ecosystem}=${count}`)
		.join(", ");
	console.log(
		`Generated ${manifest.components.length} open-source components for ${target} (${summary})`,
	);
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

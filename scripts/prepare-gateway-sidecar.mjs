import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createBuildId, readVersionRecord } from "./versioning.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const gatewayDir = path.join(root, "gateway");
const binariesDir = path.join(root, "frontend", "src-tauri", "binaries");
const extension = process.platform === "win32" ? ".exe" : "";
const builtBinary = path.join(
	gatewayDir,
	"bin",
	`encorehub-gateway${extension}`,
);
const goCache = process.env.GOCACHE || path.join(root, ".cache", "go-build");
const release = process.argv.slice(2).includes("--release");
const gatewayVersion = readVersionRecord("gateway", root);
const buildId = process.env.ENCOREHUB_BUILD_ID ?? createBuildId();

function run(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: root,
		stdio: "inherit",
		shell: false,
		...options,
	});
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(`${command} exited with status ${result.status}`);
	}
	return result;
}

mkdirSync(path.dirname(builtBinary), { recursive: true });
mkdirSync(binariesDir, { recursive: true });
mkdirSync(goCache, { recursive: true });
const linkerFlags = [
	...(release ? ["-s", "-w"] : []),
	"-X",
	`com.0d000721.encorehub/gateway/internal/buildinfo.BuildID=${buildId}`,
];
const goArgs = ["build", "-trimpath", "-ldflags", linkerFlags.join(" ")];
goArgs.push("-o", builtBinary, "./cmd/gateway");
run("go", goArgs, {
	cwd: gatewayDir,
	env: { ...process.env, GOCACHE: goCache },
});

const rustc = spawnSync("rustc", ["-vV"], {
	cwd: root,
	encoding: "utf8",
	shell: false,
});
if (rustc.error) throw rustc.error;
if (rustc.status !== 0)
	throw new Error(`rustc exited with status ${rustc.status}`);
const target = rustc.stdout.match(/^host:\s*(.+)$/m)?.[1]?.trim();
if (!target) throw new Error("could not determine Rust host target triple");

copyFileSync(
	builtBinary,
	path.join(binariesDir, `encorehub-gateway${extension}`),
);
copyFileSync(
	builtBinary,
	path.join(binariesDir, `encorehub-gateway-${target}${extension}`),
);
const bytes = readFileSync(builtBinary);
writeFileSync(
	path.join(binariesDir, "gateway-runtime.json"),
	`${JSON.stringify(
		{
			schemaVersion: 1,
			module: "encorehub-gateway",
			version: gatewayVersion.version,
			build_id: buildId,
			compatibility: gatewayVersion.compatibility,
			target,
			profile: release ? "release" : "debug",
			file: `encorehub-gateway${extension}`,
			size: bytes.length,
			sha256: createHash("sha256").update(bytes).digest("hex"),
		},
		null,
		2,
	)}\n`,
);
console.log(
	`Prepared Gateway sidecar (${release ? "release" : "debug"}, ${target})`,
);

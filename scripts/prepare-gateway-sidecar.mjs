import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
run("go", ["build", "-trimpath", "-o", builtBinary, "./cmd/gateway"], {
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
console.log(`Prepared Gateway sidecar for ${target}`);

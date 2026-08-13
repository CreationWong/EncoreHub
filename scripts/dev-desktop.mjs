// Prepares and launches the desktop development stack with one shared Build ID.
import { spawnSync } from "node:child_process";
import { createBuildId } from "./versioning.mjs";

const rootEnv = { ...process.env };
rootEnv.ENCOREHUB_BUILD_ID ??= createBuildId();
rootEnv.VITE_BUILD_ID ??= rootEnv.ENCOREHUB_BUILD_ID;
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

/** Run one preparation or development process with the shared build identity. */
function run(command, args) {
	const result = spawnSync(command, args, {
		stdio: "inherit",
		shell: process.platform === "win32" && command.endsWith(".cmd"),
		env: rootEnv,
	});
	if (result.error) throw result.error;
	if (result.status !== 0) process.exit(result.status ?? 1);
}

run("node", ["scripts/prepare-engine-runtime.mjs", "--debug"]);
run("node", ["scripts/prepare-gateway-sidecar.mjs", "--debug"]);
run(pnpm, ["--dir", "frontend", "tauri", "dev"]);

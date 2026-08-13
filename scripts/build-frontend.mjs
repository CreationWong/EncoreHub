// Builds the web frontend with a fixed Build ID embedded in the bundle.
import { spawnSync } from "node:child_process";
import { createBuildId } from "./versioning.mjs";

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const buildId = process.env.ENCOREHUB_BUILD_ID ?? createBuildId();
const result = spawnSync(pnpm, ["--dir", "frontend", "build"], {
	stdio: "inherit",
	shell: process.platform === "win32",
	env: {
		...process.env,
		ENCOREHUB_BUILD_ID: buildId,
		VITE_BUILD_ID: buildId,
	},
});
if (result.error) throw result.error;
if (result.status !== 0) process.exitCode = result.status ?? 1;

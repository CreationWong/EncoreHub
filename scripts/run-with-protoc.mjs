import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveProtoc } from "./resolve-protoc.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [command, ...args] = process.argv.slice(2);
if (!command) throw new Error("tool command required");

const result = spawnSync(command, args, {
	cwd: root,
	env: { ...process.env, PROTOC: resolveProtoc(root) },
	stdio: "inherit",
	shell: false,
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);

import { spawnSync } from "node:child_process";
import path from "node:path";

function works(command) {
	if (!command) return false;
	const result = spawnSync(command, ["--version"], {
		encoding: "utf8",
		shell: false,
	});
	return !result.error && result.status === 0;
}

export function resolveProtoc(repoRoot) {
	if (works(process.env.PROTOC)) return process.env.PROTOC;
	if (works("protoc")) return "protoc";

	const manifest = path.join(
		repoRoot,
		"engine",
		"crates",
		"protoc-resolver",
		"Cargo.toml",
	);
	const result = spawnSync(
		"cargo",
		["run", "--quiet", "--manifest-path", manifest],
		{
			cwd: repoRoot,
			encoding: "utf8",
			shell: false,
			stdio: ["ignore", "pipe", "inherit"],
		},
	);
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(`vendored protoc resolver exited with ${result.status}`);
	}
	const resolved = result.stdout
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.at(-1);
	if (!works(resolved)) {
		throw new Error("vendored protoc resolver returned an invalid executable");
	}
	return resolved;
}

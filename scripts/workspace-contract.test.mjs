import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFile(path.join(root, relativePath), "utf8");

test("Engine container builds the standalone HTTP binary with readonly skills", async () => {
	const [dockerfile, dockerignore, main] = await Promise.all([
		read("engine/Dockerfile"),
		read(".dockerignore"),
		read("engine/src/main.rs"),
	]);
	assert.match(
		dockerfile,
		/cargo build --release --features standalone --bin encorehub-engine/,
	);
	assert.match(dockerfile, /COPY skills\/ \/opt\/encorehub\/skills\//);
	assert.match(dockerfile, /ENV ENCOREHUB_SKILLS_DIR=\/opt\/encorehub\/skills/);
	assert.match(dockerfile, /ENV ENGINE_DB=\/data\/encorehub\.db/);
	assert.match(dockerfile, /EXPOSE 3000/);
	assert.doesNotMatch(dockerfile, /50051|9090/);
	assert.match(dockerignore, /^\*\*\/target\/$/m);
	assert.doesNotMatch(dockerignore, /^!engine\/\*\*$/m);
	assert.match(main, /ENCOREHUB_SKILLS_DIR/);
	assert.match(main, /ENGINE_DB/);
});

test("Gateway builder matches go.mod and exposes only HTTP", async () => {
	const [dockerfile, goMod] = await Promise.all([
		read("gateway/Dockerfile"),
		read("gateway/go.mod"),
	]);
	const goVersion = goMod.match(/^go\s+(\d+\.\d+)/m)?.[1];
	const imageVersion = dockerfile.match(/^FROM golang:(\d+\.\d+)-alpine/m)?.[1];
	assert.ok(goVersion, "go.mod must declare a Go version");
	assert.equal(imageVersion, goVersion);
	assert.match(dockerfile, /EXPOSE 8080/);
	assert.match(dockerfile, /bin\/encorehub-gateway/);
	assert.match(dockerfile, /CMD \["encorehub-gateway"\]/);
	assert.doesNotMatch(dockerfile, /9090|50051/);
});

test("Compose uses the Engine image contract and readiness dependencies", async () => {
	const compose = await read("docker-compose.yml");
	assert.match(
		compose,
		/engine:\s*\n\s*build:\s*\n\s*context: \.\s*\n\s*dockerfile: engine\/Dockerfile/,
	);
	assert.match(compose, /ENGINE_DB=\/data\/encorehub\.db/);
	assert.match(compose, /condition: service_healthy/);
	assert.match(compose, /\/api\/v1\/health\/ready/);
	assert.match(compose, /\/health\/ready/);
	assert.doesNotMatch(compose, /DATABASE_URL=|LANCEDB_PATH=|DATA_SERVICE_URL=/);
	assert.doesNotMatch(compose, /3000:3000/);
});

test("Root package scripts are canonical, non-recursive, and standalone-aware", async () => {
	const [packageText, makefile, readme] = await Promise.all([
		read("package.json"),
		read("Makefile"),
		read("README.md"),
	]);
	const pkg = JSON.parse(packageText);
	const scripts = pkg.scripts ?? {};
	for (const name of [
		"dev",
		"build",
		"test",
		"lint",
		"check",
		"test:contracts",
	]) {
		assert.equal(typeof scripts[name], "string", `missing root script ${name}`);
	}
	const serialized = JSON.stringify(scripts);
	assert.doesNotMatch(serialized, /concurrently|--filter\s+['"]?\*/);
	assert.match(scripts["dev:engine"], /--features standalone/);
	assert.match(scripts["dev:engine"], /--bin encorehub-engine/);
	assert.match(scripts["build:engine"], /--features standalone/);
	assert.match(scripts["build:engine"], /--bin encorehub-engine/);
	assert.match(makefile, /Compatibility shim/);
	assert.doesNotMatch(
		makefile,
		/cargo (build|test|check)|go (build|test|vet)|pnpm --filter/,
	);
	assert.doesNotMatch(readme, /\bmake (dev|build|check|test|lint|fmt)\b/);
});

test("Frontend keeps non-critical features outside the initial module graph", async () => {
	const [
		app,
		workspaceSurface,
		settingsModal,
		markdownRenderer,
		highlightedCodeBlock,
		devtools,
		confirmConsumers,
	] = await Promise.all([
		read("frontend/src/App.tsx"),
		read("frontend/src/components/workspace/WorkspaceSurface.tsx"),
		read("frontend/src/components/settings/SettingsModal.tsx"),
		read("frontend/src/components/chat/MarkdownRenderer.tsx"),
		read("frontend/src/components/chat/HighlightedCodeBlock.tsx"),
		read("frontend/src/services/devtools.ts"),
		Promise.all([
			read("frontend/src/components/sidebar/ConversationList.tsx"),
			read("frontend/src/components/settings/ProvidersPanel.tsx"),
			read("frontend/src/components/settings/SecurityPanel.tsx"),
		]).then((files) => files.join("\n")),
	]);

	assert.match(app, /^import WorkspaceSurface from /m);
	assert.doesNotMatch(app, /^import SettingsModal/m);
	assert.match(
		workspaceSurface,
		/lazy\(\(\) => import\("\.\.\/settings\/SettingsModal"\)\)/,
	);
	assert.match(
		workspaceSurface,
		/lazy\(\(\) => import\("\.\/WorkspaceLauncher"\)\)/,
	);
	assert.match(workspaceSurface, /openTabs\.includes\("settings"\)/);
	assert.match(workspaceSurface, /hidden=\{activeTab !== "settings"\}/);
	assert.doesNotMatch(workspaceSurface, /^import SettingsModal/m);
	assert.doesNotMatch(workspaceSurface, /^import WorkspaceLauncher/m);
	assert.match(settingsModal, /lazy\(\(\) => import\("\.\/DeveloperPanel"\)\)/);
	assert.doesNotMatch(settingsModal, /^import DeveloperPanel/m);
	assert.match(
		markdownRenderer,
		/lazy\(\(\) => import\("\.\/HighlightedCodeBlock"\)\)/,
	);
	assert.doesNotMatch(markdownRenderer, /from "react-syntax-highlighter/);
	assert.match(highlightedCodeBlock, /from "react-syntax-highlighter"/);
	assert.match(devtools, /await import\("@tauri-apps\/api\/core"\)/);
	assert.doesNotMatch(devtools, /^import .*@tauri-apps\/api\/core/m);
	assert.doesNotMatch(confirmConsumers, /import\([^)]*confirmStore/);
});

test("Frontend build enforces and retains its initial gzip budget", async () => {
	const [
		frontendPackageText,
		rootPackageText,
		viteConfig,
		budgetCheck,
		workflow,
	] = await Promise.all([
		read("frontend/package.json"),
		read("package.json"),
		read("frontend/vite.config.ts"),
		read("frontend/scripts/check-bundle-budget.mjs"),
		read(".github/workflows/build.yml"),
	]);
	const frontendScripts = JSON.parse(frontendPackageText).scripts;
	const rootScripts = JSON.parse(rootPackageText).scripts;

	assert.match(frontendScripts.build, /bundle:check/);
	assert.match(frontendScripts.check, /tsc --noEmit/);
	assert.match(frontendScripts["analyze:bundle"], /vite build --mode analyze/);
	assert.match(frontendScripts["bundle:check"], /check-bundle-budget\.mjs/);
	assert.match(frontendScripts["test:bundle"], /node --test/);
	assert.match(rootScripts["test:frontend"], /test:bundle/);
	assert.match(rootScripts["check:frontend"], /--dir frontend check/);
	assert.match(viteConfig, /manifest:\s*true/);
	assert.match(viteConfig, /bundle-analysis\.json/);
	assert.match(budgetCheck, /DEFAULT_BUDGET_KIB = 300/);
	assert.match(budgetCheck, /record\.imports/);
	assert.match(workflow, /Upload frontend bundle statistics/);
	assert.match(workflow, /BUNDLE_BUDGET_KIB: "300"/);
	assert.match(workflow, /if: always\(\)/);
	assert.match(workflow, /frontend\/dist\/bundle-budget\.json/);
});

test("Desktop keeps mutable state in app data and bundles readonly skills", async () => {
	const [main, runtimePaths, tauriConfig] = await Promise.all([
		read("frontend/src-tauri/src/main.rs"),
		read("frontend/src-tauri/src/runtime_paths.rs"),
		read("frontend/src-tauri/tauri.conf.json"),
	]);
	assert.match(main, /app\.path\(\)\.app_data_dir\(\)/);
	assert.match(main, /app\.path\(\)\.resource_dir\(\)/);
	assert.doesNotMatch(main, /with_log_dir\(exe_dir\.join\("log"\)\)/);
	assert.doesNotMatch(main, /exe_dir\.join\("data"\)/);
	assert.match(
		runtimePaths,
		/#\[cfg\(any\(target_os = "windows", test\)\)\]\s*pub\(crate\) mod legacy_migration/,
	);
	assert.doesNotMatch(runtimePaths, /allow\(dead_code\)/);
	const config = JSON.parse(tauriConfig);
	assert.equal(config.bundle.resources?.["../../skills/"], "skills/");
});

test("Desktop launches the Gateway through Tauri's sidecar resolver", async () => {
	const main = await read("frontend/src-tauri/src/main.rs");
	assert.match(main, /\.shell\(\)\.sidecar\("encorehub-gateway"\)/);
	assert.doesNotMatch(main, /fn find_binary|std::process::Command/);
});

test("Windows custom titlebar is platform scoped and has a native rollback", async () => {
	const [baseText, windowsText, capabilityText, main] = await Promise.all([
		read("frontend/src-tauri/tauri.conf.json"),
		read("frontend/src-tauri/tauri.windows.conf.json"),
		read("frontend/src-tauri/capabilities/windows-titlebar.json"),
		read("frontend/src-tauri/src/main.rs"),
	]);
	const base = JSON.parse(baseText);
	const windows = JSON.parse(windowsText);
	const capability = JSON.parse(capabilityText);

	assert.equal(base.app.windows[0].decorations, true);
	assert.equal(windows.app.windows[0].decorations, false);
	assert.deepEqual(capability.platforms, ["windows"]);
	for (const permission of [
		"core:window:allow-minimize",
		"core:window:allow-toggle-maximize",
		"core:window:allow-close",
		"core:window:allow-start-dragging",
	]) {
		assert.ok(capability.permissions.includes(permission));
	}
	assert.match(main, /ENCOREHUB_NATIVE_TITLEBAR/);
	assert.match(main, /set_decorations\(true\)/);
	assert.match(main, /fn use_custom_titlebar\(\) -> bool/);
});

test("Unix desktop build uses argument arrays and target-triple sidecars", async () => {
	const script = await read("scripts/build.sh");
	assert.match(script, /TAURI_ARGS=\([^\n]*tauri[^\n]*(build|dev)/);
	assert.match(script, /pnpm "\$\{TAURI_ARGS\[@\]\}"/);
	assert.match(script, /encorehub-gateway-\$\{?target_triple\}?/i);
	assert.doesNotMatch(
		script,
		/TAURI_CMD="tauri build"|pnpm "tauri" "\$TAURI_CMD"/,
	);
});

test("Local build workflows keep Tauri development outside timed release steps", async () => {
	const [powershell, shell, attributes] = await Promise.all([
		read("scripts/build.ps1"),
		read("scripts/build.sh"),
		read(".gitattributes"),
	]);

	assert.doesNotMatch(
		powershell,
		/Invoke-TimedStep[^\n]*Start-TauriDevelopment/,
	);
	assert.match(
		powershell,
		/if \(\$Debug\) \{\s*Write-BuildSummary "Preparation complete"\s*Start-TauriDevelopment/,
	);
	assert.match(
		powershell,
		/if \(\$Tauri -and -not \$Debug\) \{[\s\S]*?MSI:[\s\S]*?NSIS:/,
	);
	assert.match(powershell, /Start-Job[^\n]*-ArgumentList/);
	assert.doesNotMatch(powershell, /\$\{function:Build-(?:Engine|Gateway)\}/);

	assert.doesNotMatch(shell, /time_step[^\n]*run_tauri_development/);
	assert.match(
		shell,
		/if \[ "\$DEBUG_BUILD" = true \]; then\s*print_summary "Preparation complete"\s*run_tauri_development/,
	);
	assert.match(
		shell,
		/if \[ "\$TAURI_BUILD" = true \] && \[ "\$DEBUG_BUILD" = false \]; then\s*print_release_locations/,
	);
	assert.match(shell, /wait "\$engine_pid" \|\| engine_status=\$\?/);
	assert.match(shell, /wait "\$gateway_pid" \|\| gateway_status=\$\?/);
	assert.match(attributes, /^\*\.sh text eol=lf$/m);
	assert.match(attributes, /^\*\.ps1 text eol=crlf$/m);
});

test("Expensive builds only run from the manual workflow", async () => {
	const [ciWorkflow, buildWorkflow] = await Promise.all([
		read(".github/workflows/ci.yml"),
		read(".github/workflows/build.yml"),
	]);

	assert.match(ciWorkflow, /^ {2}push:\s*$/m);
	assert.match(ciWorkflow, /^ {2}pull_request:\s*$/m);
	assert.match(ciWorkflow, /run: pnpm check/);
	assert.match(ciWorkflow, /Check workspace contracts/);
	assert.match(buildWorkflow, /^ {2}workflow_dispatch:\s*$/m);
	assert.doesNotMatch(buildWorkflow, /^ {2}(?:push|pull_request):/m);

	for (const command of [
		/run: pnpm build/,
		/run: go build -o bin\/encorehub-gateway/,
		/run: cargo build --release/,
		/run: pnpm --dir frontend tauri build --debug --no-bundle --ci/,
		/run: docker compose build --no-cache/,
	]) {
		assert.match(buildWorkflow, command);
		assert.doesNotMatch(ciWorkflow, command);
	}
});

test("Manual desktop build compiles all declared platforms", async () => {
	const workflow = await read(".github/workflows/build.yml");
	for (const runner of ["ubuntu-latest", "macos-latest", "windows-latest"]) {
		assert.match(workflow, new RegExp(`os: ${runner}`));
	}
	assert.match(workflow, /tauri build --debug --no-bundle/);
});

test("Windows uninstall hooks preserve app data outside the install directory", async () => {
	const [wix, nsis] = await Promise.all([
		read("frontend/src-tauri/wix/cleanup-runtime-data.wxs"),
		read("frontend/src-tauri/nsis/installer-hooks.nsh"),
	]);
	assert.doesNotMatch(
		`${wix}\n${nsis}`,
		/APPDATA|LOCALAPPDATA|AppData|Roaming/i,
	);
	assert.match(wix, /NOT UPGRADINGPRODUCTCODE/);
	assert.match(nsis, /\$UpdateMode <> 1/);
});

test("Data Services stays dependency-minimal and opt-in", async () => {
	const [compose, dockerfile, pyproject, rootPackage, workflow] =
		await Promise.all([
			read("docker-compose.yml"),
			read("data-services/Dockerfile"),
			read("data-services/pyproject.toml"),
			read("package.json"),
			read(".github/workflows/build.yml"),
		]);
	assert.match(compose, /data-services:\s*\n\s*profiles: \["data"\]/);
	assert.doesNotMatch(compose, /^\s{2}redis:/m);
	assert.doesNotMatch(compose, /REDIS_URL=|DATA_SERVICE_URL=/);
	assert.doesNotMatch(dockerfile, /build-essential|curl|uvicorn\[standard\]/);
	assert.match(dockerfile, /uv sync --frozen --no-dev --no-install-project/);
	assert.match(dockerfile, /"uv", "run", "--no-sync"/);
	assert.match(dockerfile, /USER encorehub/);
	assert.doesNotMatch(
		pyproject,
		/sentence-transformers|llama-index|pymupdf|celery|grpcio|pandas|redis>=/,
	);
	const scripts = JSON.parse(rootPackage).scripts;
	assert.match(scripts["docker:up:data"], /--profile data/);
	assert.match(scripts["docker:ps"], /--profile data/);
	assert.match(scripts["docker:down"], /--profile data/);
	assert.match(workflow, /Smoke optional Data Services profile/);
});

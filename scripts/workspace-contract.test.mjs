import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFile(path.join(root, relativePath), "utf8");

async function filesBelow(directory, suffix) {
	const entries = await readdir(path.join(root, directory), {
		withFileTypes: true,
	});
	const nested = await Promise.all(
		entries.map(async (entry) => {
			const relativePath = path.join(directory, entry.name);
			if (entry.isDirectory()) return filesBelow(relativePath, suffix);
			return entry.name.endsWith(suffix) ? [relativePath] : [];
		}),
	);
	return nested.flat();
}

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

test("Independent component versions retain compatibility and mainline roll contracts", async () => {
	const [frontend, gateway, engine, workflow, packageText] = await Promise.all([
		read("frontend/version.json"),
		read("gateway/internal/buildinfo/version.json"),
		read("engine/version.json"),
		read(".github/workflows/version-roll.yml"),
		read("package.json"),
	]);
	const records = [frontend, gateway, engine].map(JSON.parse);
	for (const record of records) {
		assert.match(record.version, /^V\d+\.\d+\.\d+\.\d+$/);
		const peers = records.filter((peer) => peer.component !== record.component);
		for (const peer of peers) {
			assert.match(
				record.compatibility[peer.component].min,
				/^V\d+\.\d+\.\d+\.\d+$/,
			);
			assert.match(
				record.compatibility[peer.component].max_exclusive,
				/^V\d+\.\d+\.\d+\.\d+$/,
			);
		}
	}
	assert.match(workflow, /branches: \[master, main\]/);
	assert.match(workflow, /versioning\.mjs auto --base HEAD\^ --head HEAD/);
	assert.match(workflow, /\[skip version-roll\]/);
	const scripts = JSON.parse(packageText).scripts;
	assert.match(scripts["version:show"], /versioning\.mjs show/);
	assert.match(scripts["version:bump"], /versioning\.mjs bump/);
	assert.match(scripts["version:auto"], /versioning\.mjs auto/);
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
	assert.equal(
		config.bundle.resources?.["resources/document-parser/"],
		undefined,
	);
});

test("Document processing stays native to Rust without a Python runtime", async () => {
	const [rootPackageText, main, parser, cargo] = await Promise.all([
		read("package.json"),
		read("frontend/src-tauri/src/main.rs"),
		read("engine/src/document_processing.rs"),
		read("engine/Cargo.toml"),
	]);
	const scripts = JSON.parse(rootPackageText).scripts;
	assert.equal(scripts["prepare:parser"], undefined);
	assert.doesNotMatch(scripts["build:desktop"], /parser|python|pyoxidizer/i);
	assert.doesNotMatch(main, /ENCOREHUB_DOCUMENT_PARSER|document-parser/);
	assert.match(parser, /pub fn parse_rich_text/);
	assert.match(parser, /fn parse_xml_archive/);
	assert.match(parser, /fn parse_epub/);
	assert.match(cargo, /quick-xml/);
	assert.match(cargo, /lancedb/);
});

test("Desktop suppresses browser autofill and uses native clipboard access", async () => {
	const [
		baseText,
		windowsText,
		capabilityText,
		cargo,
		main,
		clipboardService,
		clipboardConsumers,
	] = await Promise.all([
		read("frontend/src-tauri/tauri.conf.json"),
		read("frontend/src-tauri/tauri.windows.conf.json"),
		read("frontend/src-tauri/capabilities/default.json"),
		read("frontend/src-tauri/Cargo.toml"),
		read("frontend/src-tauri/src/main.rs"),
		read("frontend/src/services/clipboard.ts"),
		Promise.all([
			read("frontend/src/components/chat/CopyButton.tsx"),
			read("frontend/src/components/settings/ProviderModelModal.tsx"),
			read("frontend/src/components/ui/AppContextMenu.tsx"),
		]).then((files) => files.join("\n")),
	]);
	const base = JSON.parse(baseText);
	const windows = JSON.parse(windowsText);
	const capability = JSON.parse(capabilityText);

	assert.equal(base.app.windows[0].generalAutofillEnabled, false);
	assert.equal(windows.app.windows[0].generalAutofillEnabled, false);
	assert.ok(
		capability.permissions.includes("clipboard-manager:allow-read-text"),
	);
	assert.ok(
		capability.permissions.includes("clipboard-manager:allow-write-text"),
	);
	assert.match(cargo, /tauri-plugin-clipboard-manager\s*=\s*"2"/);
	assert.match(main, /tauri_plugin_clipboard_manager::init\(\)/);
	assert.match(
		clipboardService,
		/import\("@tauri-apps\/plugin-clipboard-manager"\)/,
	);
	assert.doesNotMatch(clipboardConsumers, /navigator\.clipboard/);
});

test("Every native text entry control opts out of browser autofill", async () => {
	const files = (await filesBelow("frontend/src", ".tsx")).filter(
		(file) => !file.endsWith(".test.tsx"),
	);
	const missing = [];
	for (const file of files) {
		const source = await read(file);
		for (const match of source.matchAll(/<(?:input|textarea)\b[\s\S]*?\/>/g)) {
			if (!match[0].includes("autoComplete=")) {
				const line = source.slice(0, match.index).split("\n").length;
				missing.push(`${file}:${line}`);
			}
		}
	}
	assert.deepEqual(missing, []);
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
	assert.doesNotMatch(
		powershell,
		/Prepare-DocumentParser|pyoxidizer|prepare:parser/,
	);
	assert.match(
		powershell,
		/if \(\$Tauri -and -not \$Debug\) \{[\s\S]*?MSI:[\s\S]*?NSIS:/,
	);
	assert.match(powershell, /Start-Job[^\n]*-ArgumentList/);
	assert.doesNotMatch(powershell, /\$\{function:Build-(?:Engine|Gateway)\}/);

	assert.doesNotMatch(shell, /time_step[^\n]*run_tauri_development/);
	assert.doesNotMatch(
		shell,
		/prepare_document_parser|pyoxidizer|prepare:parser/,
	);
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

test("Desktop loads a versioned cross-platform Engine Runtime module", async () => {
	const [
		cargo,
		main,
		loader,
		runtimeCargo,
		runtime,
		scraplingCargo,
		scraplingRuntime,
		windows,
		linux,
		macos,
		rootPackage,
	] = await Promise.all([
		read("frontend/src-tauri/Cargo.toml"),
		read("frontend/src-tauri/src/main.rs"),
		read("frontend/src-tauri/src/engine_runtime.rs"),
		read("engine/crates/desktop-runtime/Cargo.toml"),
		read("engine/crates/desktop-runtime/src/lib.rs"),
		read("engine/crates/rust-scrapling-runtime/Cargo.toml"),
		read("engine/crates/rust-scrapling-runtime/src/lib.rs"),
		read("frontend/src-tauri/tauri.windows.conf.json"),
		read("frontend/src-tauri/tauri.linux.conf.json"),
		read("frontend/src-tauri/tauri.macos.conf.json"),
		read("package.json"),
	]);
	assert.doesNotMatch(cargo, /encorehub-engine\s*=/);
	assert.match(cargo, /libloading/);
	assert.match(main, /EngineRuntimeLibrary::load/);
	assert.match(loader, /ENGINE_RUNTIME_ABI_VERSION:\s*u32\s*=\s*1/);
	assert.match(loader, /LOAD_WITH_ALTERED_SEARCH_PATH/);
	assert.match(loader, /WindowsLibrary::load_with_flags/);
	assert.match(runtimeCargo, /crate-type\s*=\s*\["cdylib"\]/);
	assert.match(runtime, /encorehub_engine_runtime_abi_version/);
	assert.match(runtime, /encorehub_engine_runtime_start/);
	assert.match(runtime, /encorehub_engine_runtime_stop/);
	assert.match(scraplingCargo, /crate-type\s*=\s*\["cdylib"\]/);
	assert.match(scraplingCargo, /rust_scrapling\s*=\s*\{\s*path/);
	assert.match(scraplingRuntime, /encorehub_rust_scrapling_abi_version/);
	assert.match(scraplingRuntime, /encorehub_rust_scrapling_extract_html/);
	assert.match(windows, /encorehub_desktop_runtime\.dll/);
	assert.match(windows, /encorehub_rust_scrapling\.dll/);
	assert.match(windows, /binaries\/engine-native\//);
	assert.match(linux, /libencorehub_desktop_runtime\.so/);
	assert.match(linux, /libencorehub_rust_scrapling\.so/);
	assert.match(linux, /binaries\/engine-native\//);
	assert.match(macos, /libencorehub_desktop_runtime\.dylib/);
	assert.match(macos, /libencorehub_rust_scrapling\.dylib/);
	assert.match(macos, /binaries\/engine-native\//);
	const scripts = JSON.parse(rootPackage).scripts;
	assert.match(scripts["build:desktop"], /engine,gateway,desktop/);
});

test("Engine Runtime dynamically links and packages libcurl", async () => {
	const [preparer, builder, workflow] = await Promise.all([
		read("scripts/prepare-engine-runtime.mjs"),
		read("scripts/build-components.mjs"),
		read(".github/workflows/build.yml"),
	]);
	assert.match(preparer, /VCPKGRS_DYNAMIC/);
	assert.match(preparer, /--x-manifest-root/);
	assert.match(preparer, /libcurl[^\n]*\.dll/);
	assert.match(preparer, /does not import shared libcurl/);
	assert.match(preparer, /nativeDependencies/);
	assert.match(preparer, /encorehub-rust-scrapling/);
	assert.match(preparer, /rustScraplingBytes/);
	assert.match(preparer, /path\.join\(binariesDir, name\)/);
	assert.match(builder, /engineManifest\.nativeDependencies/);
	assert.match(builder, /engineManifest\.rustScrapling/);
	assert.match(workflow, /Install shared libcurl for Engine Runtime/);
	assert.match(workflow, /brew install curl pkg-config/);
	assert.match(workflow, /Prepare current-target Engine Runtime/);
	const manifest = JSON.parse(await read("vcpkg.json"));
	assert.ok(manifest.dependencies.includes("curl"));
});

test("Open-source manifest includes the independent RUSTScrapling graph", async () => {
	const generator = await read("scripts/generate-oss-compliance.mjs");
	assert.match(generator, /engine[\\"', ]+Cargo\.toml/);
	assert.match(generator, /encorehub-rust-scrapling/);
	assert.match(generator, /pkg\.name === "rust_scrapling"/);
});

test("Routine release builds keep Engine Runtime linking iterative", async () => {
	const cargo = await read("engine/Cargo.toml");
	const releaseHeader = "[profile.release]";
	const releaseStart = cargo.indexOf(releaseHeader);
	assert.notEqual(releaseStart, -1, "engine release profile is missing");
	const releaseTail = cargo.slice(releaseStart + releaseHeader.length);
	const nextSection = releaseTail.search(/^\[/m);
	const releaseProfile =
		nextSection === -1 ? releaseTail : releaseTail.slice(0, nextSection);
	assert.match(releaseProfile, /^lto\s*=\s*false\s*$/m);
	assert.match(releaseProfile, /^codegen-units\s*=\s*16\s*$/m);
	assert.doesNotMatch(releaseProfile, /^lto\s*=\s*true\s*$/m);
	assert.doesNotMatch(releaseProfile, /^lto\s*=\s*"thin"\s*$/m);
	assert.doesNotMatch(releaseProfile, /^codegen-units\s*=\s*1\s*$/m);
});

test("Component builds select one or several modules on every host", async () => {
	const [builder, powershell, shell] = await Promise.all([
		read("scripts/build-components.mjs"),
		read("scripts/build.ps1"),
		read("scripts/build.sh"),
	]);
	assert.match(builder, /engine-standalone/);
	assert.match(builder, /components\.join/);
	assert.match(powershell, /\[string\[\]\]\$Components/);
	assert.match(powershell, /build-components\.mjs/);
	assert.match(shell, /--components/);
	assert.match(shell, /build-components\.mjs/);
});

test("Local builds resolve a vendored protoc without a global installation", async () => {
	const [
		powershell,
		shell,
		cargo,
		resolverCargo,
		resolverMain,
		nodeResolver,
		runtimeBuilder,
		componentBuilder,
		rootPackage,
	] = await Promise.all([
		read("scripts/build.ps1"),
		read("scripts/build.sh"),
		read("engine/Cargo.toml"),
		read("engine/crates/protoc-resolver/Cargo.toml"),
		read("engine/crates/protoc-resolver/src/main.rs"),
		read("scripts/resolve-protoc.mjs"),
		read("scripts/prepare-engine-runtime.mjs"),
		read("scripts/build-components.mjs"),
		read("package.json"),
	]);

	assert.match(cargo, /"crates\/protoc-resolver"/);
	assert.match(resolverCargo, /protoc-bin-vendored/);
	assert.match(resolverMain, /protoc_bin_path/);
	assert.match(powershell, /Resolve-Protoc -Required \$needsCargo/);
	assert.match(powershell, /\$env:PROTOC/);
	assert.doesNotMatch(powershell, /Test-Prerequisite -Name "protoc"/);
	assert.match(shell, /resolve_protoc "\$NEEDS_CARGO"/);
	assert.match(shell, /export PROTOC/);
	assert.doesNotMatch(shell, /check_command protoc/);
	assert.match(nodeResolver, /protoc-resolver/);
	assert.match(nodeResolver, /process\.env\.PROTOC/);
	assert.match(runtimeBuilder, /PROTOC: resolveProtoc\(root\)/);
	assert.match(componentBuilder, /PROTOC: resolveProtoc\(root\)/);
	for (const name of ["check:engine", "test:engine", "lint:engine"]) {
		assert.match(JSON.parse(rootPackage).scripts[name], /run-with-protoc\.mjs/);
	}
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

test("Workspace has no Python data service or Chroma deployment contract", async () => {
	const [compose, rootPackage, ci, workflow] = await Promise.all([
		read("docker-compose.yml"),
		read("package.json"),
		read(".github/workflows/ci.yml"),
		read(".github/workflows/build.yml"),
	]);
	const scripts = JSON.parse(rootPackage).scripts;
	assert.doesNotMatch(compose, /data-services|chroma|python/i);
	assert.equal(scripts["dev:data"], undefined);
	assert.equal(scripts["check:data"], undefined);
	assert.equal(scripts["test:data"], undefined);
	assert.equal(scripts["lint:data"], undefined);
	assert.doesNotMatch(
		`${ci}\n${workflow}`,
		/setup-python|data-services|chroma/i,
	);
	assert.match(`${ci}\n${workflow}`, /arduino\/setup-protoc@v3/);
});

/// <reference types="vitest" />
import { Buffer } from "node:buffer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import react from "@vitejs/plugin-react";
import { type Plugin, defineConfig } from "vite";

const frontendRoot = fileURLToPath(new URL(".", import.meta.url));

function normalizeModuleId(id: string): string {
	if (id.startsWith("\0")) return `virtual:${id.slice(1)}`;

	const [file] = id.split("?", 1);
	const relative = path.relative(frontendRoot, file);
	if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
		return relative.split(path.sep).join("/");
	}
	return id.replaceAll("\\", "/");
}

function bundleAnalysisPlugin(mode: string): Plugin {
	return {
		name: "encorehub-bundle-analysis",
		apply: "build",
		generateBundle(_options, bundle) {
			const chunks = Object.values(bundle)
				.filter((item) => item.type === "chunk")
				.map((chunk) => ({
					file: chunk.fileName,
					isEntry: chunk.isEntry,
					isDynamicEntry: chunk.isDynamicEntry,
					bytes: Buffer.byteLength(chunk.code),
					gzipBytes: gzipSync(chunk.code).byteLength,
					imports: chunk.imports,
					dynamicImports: chunk.dynamicImports,
					modules: Object.entries(chunk.modules)
						.map(([id, module]) => ({
							id: normalizeModuleId(id),
							renderedBytes: module.renderedLength,
						}))
						.sort((left, right) => right.renderedBytes - left.renderedBytes),
				}))
				.sort((left, right) => right.bytes - left.bytes);

			const assets = Object.values(bundle)
				.filter((item) => item.type === "asset")
				.map((asset) => {
					const source = asset.source;
					return {
						file: asset.fileName,
						bytes:
							typeof source === "string"
								? Buffer.byteLength(source)
								: source.byteLength,
						gzipBytes: gzipSync(source).byteLength,
					};
				})
				.sort((left, right) => right.bytes - left.bytes);

			const report = {
				schemaVersion: 1,
				mode,
				totals: {
					javascriptBytes: chunks.reduce((sum, chunk) => sum + chunk.bytes, 0),
					javascriptGzipBytes: chunks.reduce(
						(sum, chunk) => sum + chunk.gzipBytes,
						0,
					),
					assetBytes: assets.reduce((sum, asset) => sum + asset.bytes, 0),
					assetGzipBytes: assets.reduce(
						(sum, asset) => sum + asset.gzipBytes,
						0,
					),
				},
				chunks,
				assets,
			};

			this.emitFile({
				type: "asset",
				fileName: "bundle-analysis.json",
				source: `${JSON.stringify(report, null, 2)}\n`,
			});
		},
	};
}

export default defineConfig(({ mode }) => ({
	plugins: [react(), bundleAnalysisPlugin(mode)],
	clearScreen: false,
	server: {
		port: 1420,
		strictPort: true,
		watch: {
			ignored: ["**/src-tauri/**"],
		},
	},
	envPrefix: ["VITE_", "TAURI_"],
	build: {
		target: ["es2021", "chrome100", "safari13"],
		minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
		sourcemap: !!process.env.TAURI_DEBUG,
		manifest: true,
	},
	test: {
		environment: "jsdom",
		globals: false,
		include: ["src/**/*.{test,spec}.{ts,tsx}"],
	},
}));

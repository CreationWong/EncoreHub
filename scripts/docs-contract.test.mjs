import assert from "node:assert/strict";
import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFile(path.join(root, relativePath), "utf8");
const HTTP_METHODS = new Set(["delete", "get", "patch", "post", "put"]);

async function walkMarkdown(directory, excludedDirectories = new Set()) {
	const files = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			if (!excludedDirectories.has(entry.name)) {
				files.push(
					...(await walkMarkdown(
						path.join(directory, entry.name),
						excludedDirectories,
					)),
				);
			}
		} else if (entry.isFile() && entry.name.endsWith(".md")) {
			files.push(path.join(directory, entry.name));
		}
	}
	return files;
}

function localLinkTarget(rawTarget) {
	const raw = rawTarget.trim();
	const target = raw.startsWith("<")
		? raw.slice(1, raw.indexOf(">"))
		: raw.split(/\s+/, 1)[0];
	if (!target || target.startsWith("#")) return null;
	if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return null;
	return target;
}

function jsonPointerValue(document, reference) {
	assert.match(
		reference,
		/^#\//,
		`only local OpenAPI refs are allowed: ${reference}`,
	);
	return reference
		.slice(2)
		.split("/")
		.map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))
		.reduce((value, part) => value?.[part], document);
}

function collectRefs(value, refs = []) {
	if (Array.isArray(value)) {
		for (const item of value) collectRefs(item, refs);
	} else if (value && typeof value === "object") {
		if (typeof value.$ref === "string") refs.push(value.$ref);
		for (const item of Object.values(value)) collectRefs(item, refs);
	}
	return refs;
}

function joinRoute(prefix, fragment) {
	const joined = `${prefix}${fragment}`.replaceAll(/\/{2,}/g, "/");
	return joined || "/";
}

function normalizeGoRoute(route) {
	return route
		.replaceAll(/:([A-Za-z_][A-Za-z0-9_]*)/g, "{$1}")
		.replaceAll(/\*([A-Za-z_][A-Za-z0-9_]*)/g, "{$1}");
}

function parseGatewayRoutes(source) {
	const groups = new Map([["r", ""]]);
	const groupPattern = /(\w+)\s*:=\s*(\w+)\.Group\("([^"]*)"\)/g;
	for (const match of source.matchAll(groupPattern)) {
		const [, name, parent, fragment] = match;
		assert.ok(groups.has(parent), `unknown Gin route group: ${parent}`);
		groups.set(name, joinRoute(groups.get(parent), fragment));
	}

	const exact = new Set();
	const any = [];
	const routePattern =
		/^\s*(\w+)\.(GET|POST|PUT|PATCH|DELETE|Any)\(\s*"([^"]*)"\s*,/gm;
	for (const match of source.matchAll(routePattern)) {
		const [, receiver, method, fragment] = match;
		if (!groups.has(receiver)) continue;
		const route = normalizeGoRoute(joinRoute(groups.get(receiver), fragment));
		if (method === "Any") any.push(route);
		else exact.add(`${method.toLowerCase()} ${route}`);
	}

	const proxyResources = source.match(
		/for _, res := range \[\]string\{([^}]+)\}/,
	)?.[1];
	assert.ok(proxyResources, "Gateway proxy resource inventory is missing");
	for (const match of proxyResources.matchAll(/"([^"]+)"/g)) {
		const resource = match[1];
		any.push(`/api/v1/${resource}`);
		any.push(`/api/v1/${resource}/{rest}`);
	}

	return { exact, any };
}

function routePatternMatches(pattern, candidate) {
	const segments = pattern.split("/");
	const expression = segments
		.map((segment) => {
			if (segment === "{rest}") return ".+";
			if (/^\{[^}]+\}$/.test(segment)) return "[^/]+";
			return segment.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
		})
		.join("/");
	return new RegExp(`^${expression}$`).test(candidate);
}

function pathParameterNames(spec, parameters = []) {
	return new Set(
		parameters
			.map((parameter) =>
				parameter?.$ref ? jsonPointerValue(spec, parameter.$ref) : parameter,
			)
			.filter((parameter) => parameter?.in === "path")
			.map((parameter) => parameter.name),
	);
}

test("maintained Markdown links resolve inside the repository", async () => {
	const files = [
		path.join(root, "README.md"),
		path.join(root, "CLAUDE.md"),
		path.join(root, "DEVELOPMENT_PLAN.md"),
		...(await walkMarkdown(
			path.join(root, "docs"),
			new Set(["vendor", "claude API"]),
		)),
	];
	const missing = [];

	for (const file of files) {
		const content = await readFile(file, "utf8");
		const linkPattern = /!?\[[^\]]*\]\(([^)\n]+)\)/g;
		for (const match of content.matchAll(linkPattern)) {
			const target = localLinkTarget(match[1]);
			if (!target) continue;
			const [encodedPath] = target.split(/[?#]/, 1);
			let decodedPath;
			try {
				decodedPath = decodeURIComponent(encodedPath);
			} catch {
				missing.push(
					`${path.relative(root, file)}: invalid URL encoding ${target}`,
				);
				continue;
			}
			if (decodedPath.startsWith("/")) {
				missing.push(`${path.relative(root, file)}: site-root link ${target}`);
				continue;
			}
			const resolved = path.resolve(path.dirname(file), decodedPath);
			const relative = path.relative(root, resolved);
			if (
				relative === ".." ||
				relative.startsWith(`..${path.sep}`) ||
				path.isAbsolute(relative)
			) {
				missing.push(
					`${path.relative(root, file)}: escapes repository ${target}`,
				);
				continue;
			}
			try {
				await access(resolved);
			} catch {
				const line = content.slice(0, match.index).split("\n").length;
				missing.push(`${path.relative(root, file)}:${line}: missing ${target}`);
			}
		}
	}

	assert.deepEqual(missing, []);
});

test("EncoreHub OpenAPI is small, internally valid, and matches Gateway routes", async () => {
	const [openapiText, routerSource, vendorText, openapiStat, vendorStat] =
		await Promise.all([
			read("docs/openapi.json"),
			read("gateway/internal/router/router.go"),
			read("docs/vendor/openai-openapi-reference.yaml"),
			stat(path.join(root, "docs/openapi.json")),
			stat(path.join(root, "docs/vendor/openai-openapi-reference.yaml")),
		]);
	const spec = JSON.parse(openapiText);

	assert.equal(spec.openapi, "3.1.0");
	assert.equal(spec.info.title, "EncoreHub Gateway API");
	assert.ok(
		openapiStat.size < 128 * 1024,
		"project OpenAPI must stay reviewable",
	);
	assert.ok(
		vendorStat.size > 2_000_000,
		"OpenAI snapshot should remain intact",
	);
	assert.match(vendorText.slice(0, 500), /title: OpenAI API/);
	assert.doesNotMatch(openapiText, /api\.openai\.com|title"\s*:\s*"OpenAI API/);
	await assert.rejects(access(path.join(root, "docs/openapi.yaml")));

	const attachmentPaths = [
		"/api/v1/conversations/{id}/attachments",
		"/api/v1/conversations/{id}/attachments/{attachment_id}",
		"/api/v1/conversations/{id}/attachments/{attachment_id}/content",
		"/api/v1/conversations/{id}/attachments/{attachment_id}/ocr",
	];
	for (const route of attachmentPaths) {
		assert.ok(spec.paths[route], `OpenAPI misses attachment route: ${route}`);
	}
	assert.equal(spec.components.parameters.AttachmentId.name, "attachment_id");
	assert.equal(
		spec.components.schemas.Attachment.properties.storage_path.type,
		"string",
	);
	for (const field of [
		"attachment_ids",
		"model_supports_vision",
		"image_strategy",
		"vision_provider",
		"vision_model",
	]) {
		assert.ok(
			spec.components.schemas.ChatRequest.properties[field],
			`ChatRequest misses attachment field: ${field}`,
		);
	}

	for (const reference of collectRefs(spec)) {
		assert.notEqual(
			jsonPointerValue(spec, reference),
			undefined,
			`unresolved OpenAPI ref: ${reference}`,
		);
	}

	const operationIds = new Set();
	const documented = new Set();
	for (const [route, pathItem] of Object.entries(spec.paths)) {
		assert.match(route, /^\//);
		const pathParameters = pathParameterNames(spec, pathItem.parameters);
		for (const [method, operation] of Object.entries(pathItem)) {
			if (!HTTP_METHODS.has(method)) continue;
			assert.equal(
				typeof operation.operationId,
				"string",
				`${method} ${route}`,
			);
			assert.ok(
				!operationIds.has(operation.operationId),
				`duplicate operationId: ${operation.operationId}`,
			);
			operationIds.add(operation.operationId);
			assert.ok(
				Object.keys(operation.responses ?? {}).some((code) => /^2/.test(code)),
			);

			const parameters = new Set([
				...pathParameters,
				...pathParameterNames(spec, operation.parameters),
			]);
			for (const name of route.matchAll(/\{([^}]+)\}/g)) {
				assert.ok(
					parameters.has(name[1]),
					`${method} ${route} misses {${name[1]}}`,
				);
			}
			documented.add(`${method} ${route}`);
		}
	}

	const gateway = parseGatewayRoutes(routerSource);
	for (const route of gateway.exact) {
		assert.ok(documented.has(route), `OpenAPI misses Gateway route: ${route}`);
	}
	for (const route of documented) {
		const [method, candidate] = route.split(" ", 2);
		const implemented =
			gateway.exact.has(route) ||
			gateway.any.some((pattern) => routePatternMatches(pattern, candidate));
		assert.ok(
			implemented,
			`OpenAPI documents an unregistered route: ${method} ${candidate}`,
		);
	}
});

test("Slash completion exposes Gateway tools without local application handlers", async () => {
	const [inputBox, registry, gatewayRegistry, claude, readme] =
		await Promise.all([
			read("frontend/src/components/chat/InputBox.tsx"),
			read("frontend/src/tools/slashTools.ts"),
			read("gateway/internal/handler/slash_tools.go"),
			read("CLAUDE.md"),
			read("README.md"),
		]);
	await assert.rejects(
		access(path.join(root, "frontend/src/commands/slash.ts")),
	);
	assert.match(inputBox, /SlashToolMenu/);
	assert.match(registry, /name: "\/web_search"/);
	assert.doesNotMatch(registry, /\brun\s*:/);
	assert.doesNotMatch(registry, /\/settings|\/new|\/clear/);
	assert.match(gatewayRegistry, /"web_search"/);
	assert.match(
		gatewayRegistry,
		/resolveWebSearchProvider\(ctx, handler\.engine, ""\)/,
	);
	assert.match(
		claude,
		/`\/web_search <query>` is an explicit, pre-executed tool request/,
	);
	assert.match(readme, /\*\*Slash 工具请求\*\*/);
});

test("documentation decisions and CI command smoke stay connected", async () => {
	const [packageText, workflow, claude, languageAdr, runtimeAdr, turnAdr] =
		await Promise.all([
			read("package.json"),
			read(".github/workflows/ci.yml"),
			read("CLAUDE.md"),
			read("docs/adr/0001-language-split.md"),
			read("docs/adr/0004-engine-in-process-and-internal-auth.md"),
			read("docs/adr/0003-chat-turn-state-and-stream-finalization.md"),
		]);
	const scripts = JSON.parse(packageText).scripts;

	assert.equal(
		scripts["test:docs"],
		"node --test scripts/docs-contract.test.mjs",
	);
	assert.match(scripts["test:contracts"], /docs-contract\.test\.mjs/);
	assert.match(workflow, /^ {2}docs:\s*$/m);
	assert.match(workflow, /run: pnpm test:docs/);
	assert.doesNotMatch(claude, /ENGINE_TAURI_MERGE_PLAN/);
	assert.match(claude, /0004-engine-in-process-and-internal-auth\.md/);
	assert.match(languageAdr, /ADR-0004/);
	assert.match(runtimeAdr, /\* \*\*Status\*\*: Accepted/);
	assert.match(turnAdr, /\* \*\*Status\*\*: Accepted/);
});

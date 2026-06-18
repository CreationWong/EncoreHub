import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.fn();
vi.mock("./api", () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

import { knowledgeApi } from "./knowledge";
import { memoriesApi } from "./memories";
import { skillsApi } from "./skills";

beforeEach(() => apiFetch.mockReset().mockResolvedValue(undefined));

describe("skillsApi", () => {
	it("list -> GET /skills", async () => {
		await skillsApi.list();
		expect(apiFetch).toHaveBeenCalledWith("/skills");
	});

	it("match url-encodes the query", async () => {
		await skillsApi.match("中文 q&a");
		expect(apiFetch).toHaveBeenCalledWith(
			"/skills/match?q=%E4%B8%AD%E6%96%87%20q%26a",
		);
	});

	it("toggle posts JSON body with the boolean", async () => {
		await skillsApi.toggle("skill-1", false);
		const [path, opts] = apiFetch.mock.calls[0];
		expect(path).toBe("/skills/skill-1/toggle");
		expect(opts.method).toBe("POST");
		expect(JSON.parse(opts.body)).toEqual({ enabled: false });
	});
});

describe("memoriesApi", () => {
	it("list with no scope -> /memories", async () => {
		await memoriesApi.list();
		expect(apiFetch).toHaveBeenCalledWith("/memories");
	});

	it("list with scope encodes it as a query param", async () => {
		await memoriesApi.list("global");
		expect(apiFetch).toHaveBeenCalledWith("/memories?scope=global");
	});

	it("search builds top_k + scope into URLSearchParams", async () => {
		await memoriesApi.search({ q: "hello world", scope: "global", top_k: 10 });
		const [path] = apiFetch.mock.calls[0];
		// URLSearchParams encodes spaces as + (not %20); accept either since
		// the engine's serde_urlencoded handles both.
		expect(path).toMatch(
			/^\/memories\/search\?q=hello(\+|%20)world&scope=global&top_k=10$/,
		);
	});

	it("delete -> DELETE /memories/:id", async () => {
		await memoriesApi.delete("m1");
		expect(apiFetch).toHaveBeenCalledWith("/memories/m1", { method: "DELETE" });
	});
});

describe("knowledgeApi", () => {
	it("list -> GET /knowledge", async () => {
		await knowledgeApi.list();
		expect(apiFetch).toHaveBeenCalledWith("/knowledge");
	});

	it("ingest posts {title, content} with default file_type omitted", async () => {
		await knowledgeApi.ingest({ title: "doc", content: "hi" });
		const [path, opts] = apiFetch.mock.calls[0];
		expect(path).toBe("/knowledge");
		expect(opts.method).toBe("POST");
		expect(JSON.parse(opts.body)).toEqual({ title: "doc", content: "hi" });
	});

	it("search defaults top_k to 5", async () => {
		await knowledgeApi.search("foo");
		const [path] = apiFetch.mock.calls[0];
		expect(path).toBe("/knowledge/search?q=foo&top_k=5");
	});

	it("search honours an explicit top_k", async () => {
		await knowledgeApi.search("bar", 20);
		expect(apiFetch).toHaveBeenCalledWith("/knowledge/search?q=bar&top_k=20");
	});

	it("delete -> DELETE /knowledge/:id", async () => {
		await knowledgeApi.delete("k1");
		expect(apiFetch).toHaveBeenCalledWith("/knowledge/k1", {
			method: "DELETE",
		});
	});
});

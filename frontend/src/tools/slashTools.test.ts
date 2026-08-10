import { describe, expect, it } from "vitest";
import { SLASH_TOOLS, matchSlashTools } from "./slashTools";

describe("Slash tool registry", () => {
	it("lists callable LLM tools for a bare slash", () => {
		expect(matchSlashTools("/")).toEqual(SLASH_TOOLS);
		expect(matchSlashTools("/").map((tool) => tool.name)).toContain(
			"/web_search",
		);
		expect(matchSlashTools("/").map((tool) => tool.name)).toContain(
			"/web_fetch",
		);
	});

	it("filters tools by command prefix and closes after arguments begin", () => {
		expect(matchSlashTools("/web").map((tool) => tool.name)).toEqual([
			"/web_search",
			"/web_fetch",
		]);
		expect(matchSlashTools("/web_search query")).toEqual([]);
		expect(matchSlashTools("/web_fetch https://example.com")).toEqual([]);
	});

	it("contains metadata only, without local application command handlers", () => {
		for (const tool of SLASH_TOOLS) {
			expect(tool).not.toHaveProperty("run");
		}
		expect(SLASH_TOOLS.map((tool) => tool.name)).not.toContain("/settings");
	});
});

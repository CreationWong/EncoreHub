import { describe, expect, it } from "vitest";
import {
	DEFAULT_WEB_SEARCH_SETTINGS,
	normalizeWebSearchSettings,
} from "./webSearch";

describe("web search settings", () => {
	it("normalizes structured providers and clamps result counts", () => {
		const settings = normalizeWebSearchSettings({
			enabled: true,
			provider: "openserp",
			max_results: 50,
			searxng: { endpoint: " http://127.0.0.1:8888 " },
			openserp: {
				endpoint: " http://localhost:7000 ",
				engine: "bing",
				engines: "google,bing",
			},
			browser: { mode: "virtual" },
			custom: { endpoint: "https://legacy.example" },
		});
		expect(settings).toEqual({
			enabled: true,
			provider: "openserp",
			max_results: 10,
			searxng: { endpoint: "http://127.0.0.1:8888" },
			openserp: {
				endpoint: "http://localhost:7000",
				engine: "bing",
				engines: "google,bing",
			},
		});
		expect(settings).not.toHaveProperty("browser");
		expect(settings).not.toHaveProperty("custom");
	});

	it("migrates removed providers to DuckDuckGo", () => {
		const settings = normalizeWebSearchSettings({
			provider: "bing",
			max_results: 0,
		});
		expect(settings).toEqual(DEFAULT_WEB_SEARCH_SETTINGS);
		expect(settings.searxng).not.toBe(DEFAULT_WEB_SEARCH_SETTINGS.searxng);
		expect(settings.openserp).not.toBe(DEFAULT_WEB_SEARCH_SETTINGS.openserp);
	});

	it("preserves the explicit DuckDuckGo HTML provider", () => {
		const settings = normalizeWebSearchSettings({
			enabled: true,
			provider: "duckduckgo_html",
			max_results: 7,
		});
		expect(settings.provider).toBe("duckduckgo_html");
		expect(settings.max_results).toBe(7);
	});
});

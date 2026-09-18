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
			exa: { mode: "free" },
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
		expect(settings.exa).not.toBe(DEFAULT_WEB_SEARCH_SETTINGS.exa);
	});

	it("keeps Exa API-key mode without storing the key in settings", () => {
		const settings = normalizeWebSearchSettings({
			provider: "exa",
			exa: { mode: "api_key", api_key: "should-not-persist" },
		});
		expect(settings.provider).toBe("exa");
		expect(settings.exa).toEqual({ mode: "api_key" });
		expect(settings).not.toHaveProperty("api_key");
	});

	it("migrates the legacy DuckDuckGo HTML provider to combined DuckDuckGo", () => {
		const settings = normalizeWebSearchSettings({
			enabled: true,
			provider: "duckduckgo_html",
			max_results: 7,
		});
		expect(settings.provider).toBe("duckduckgo");
		expect(settings.max_results).toBe(7);
	});
});

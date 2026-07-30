import { describe, expect, it } from "vitest";
import {
	DEFAULT_WEB_SEARCH_SETTINGS,
	normalizeWebSearchSettings,
} from "./webSearch";

describe("web search settings", () => {
	it("normalizes persisted configuration and clamps result counts", () => {
		expect(
			normalizeWebSearchSettings({
				enabled: true,
				provider: "custom",
				max_results: 50,
				custom: {
					endpoint: "https://search.example.com/api",
					results_path: "data.items",
				},
			}),
		).toMatchObject({
			enabled: true,
			provider: "custom",
			max_results: 10,
			custom: {
				endpoint: "https://search.example.com/api",
				results_path: "data.items",
				title_path: "title",
			},
		});
	});

	it("falls back to safe defaults for unknown providers", () => {
		const settings = normalizeWebSearchSettings({
			provider: "unknown",
			max_results: 0,
		});

		expect(settings).toEqual(DEFAULT_WEB_SEARCH_SETTINGS);
		expect(settings.custom).not.toBe(DEFAULT_WEB_SEARCH_SETTINGS.custom);
	});
});

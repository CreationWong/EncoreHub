import { apiFetch } from "./api";

export type SearchProvider = "duckduckgo" | "bing" | "google" | "custom";

export interface CustomSearchSettings {
	name: string;
	endpoint: string;
	query_parameter: string;
	limit_parameter: string;
	api_key_header: string;
	api_key_prefix: string;
	results_path: string;
	title_path: string;
	url_path: string;
	snippet_path: string;
}

export interface WebSearchSettings {
	enabled: boolean;
	provider: SearchProvider;
	max_results: number;
	google_cse_id: string;
	custom: CustomSearchSettings;
}

export interface WebSearchResult {
	title: string;
	url: string;
	snippet: string;
}

export interface WebSearchResponse {
	results: WebSearchResult[];
	provider: string;
	query: string;
}

export const SEARCH_SECRET_IDS = {
	bing: "system.search.bing",
	google: "system.search.google",
	custom: "system.search.custom",
} as const;

export const DEFAULT_WEB_SEARCH_SETTINGS: WebSearchSettings = {
	enabled: false,
	provider: "duckduckgo",
	max_results: 5,
	google_cse_id: "",
	custom: {
		name: "Custom search",
		endpoint: "",
		query_parameter: "q",
		limit_parameter: "count",
		api_key_header: "",
		api_key_prefix: "Bearer ",
		results_path: "results",
		title_path: "title",
		url_path: "url",
		snippet_path: "snippet",
	},
};

const SEARCH_PROVIDERS: readonly SearchProvider[] = [
	"duckduckgo",
	"bing",
	"google",
	"custom",
];

function stringValue(value: unknown, fallback: string): string {
	return typeof value === "string" ? value : fallback;
}

export function normalizeWebSearchSettings(
	value: unknown,
	fallback: WebSearchSettings = DEFAULT_WEB_SEARCH_SETTINGS,
): WebSearchSettings {
	if (!value || typeof value !== "object") {
		return { ...fallback, custom: { ...fallback.custom } };
	}
	const stored = value as Partial<WebSearchSettings>;
	const provider = SEARCH_PROVIDERS.includes(stored.provider as SearchProvider)
		? (stored.provider as SearchProvider)
		: fallback.provider;
	const storedMaxResults = Number(stored.max_results);
	const maxResults =
		Number.isInteger(storedMaxResults) && storedMaxResults >= 1
			? Math.min(10, storedMaxResults)
			: fallback.max_results;
	const custom: Partial<CustomSearchSettings> =
		stored.custom && typeof stored.custom === "object" ? stored.custom : {};

	return {
		enabled:
			typeof stored.enabled === "boolean" ? stored.enabled : fallback.enabled,
		provider,
		max_results: maxResults,
		google_cse_id: stringValue(stored.google_cse_id, fallback.google_cse_id),
		custom: {
			name: stringValue(custom.name, fallback.custom.name),
			endpoint: stringValue(custom.endpoint, fallback.custom.endpoint),
			query_parameter: stringValue(
				custom.query_parameter,
				fallback.custom.query_parameter,
			),
			limit_parameter: stringValue(
				custom.limit_parameter,
				fallback.custom.limit_parameter,
			),
			api_key_header: stringValue(
				custom.api_key_header,
				fallback.custom.api_key_header,
			),
			api_key_prefix: stringValue(
				custom.api_key_prefix,
				fallback.custom.api_key_prefix,
			),
			results_path: stringValue(
				custom.results_path,
				fallback.custom.results_path,
			),
			title_path: stringValue(custom.title_path, fallback.custom.title_path),
			url_path: stringValue(custom.url_path, fallback.custom.url_path),
			snippet_path: stringValue(
				custom.snippet_path,
				fallback.custom.snippet_path,
			),
		},
	};
}

export const webSearchApi = {
	getSettings(): Promise<unknown> {
		return apiFetch<unknown>("/config/web_search_settings");
	},

	saveSettings(settings: WebSearchSettings): Promise<void> {
		return apiFetch<void>("/config/web_search_settings", {
			method: "PUT",
			body: JSON.stringify(settings),
		});
	},

	test(
		provider: SearchProvider,
		maxResults: number,
	): Promise<WebSearchResponse> {
		return apiFetch<WebSearchResponse>("/search", {
			method: "POST",
			body: JSON.stringify({
				query: "EncoreHub",
				provider,
				max_results: maxResults,
			}),
		});
	},
};

import { apiFetch } from "./api";

export type SearchProvider = "duckduckgo" | "searxng" | "openserp";
export type OpenSERPEngine =
	| "mega"
	| "google"
	| "bing"
	| "duckduckgo"
	| "baidu"
	| "yandex"
	| "ecosia";

export interface SearXNGSearchSettings {
	endpoint: string;
}

export interface OpenSERPSearchSettings {
	endpoint: string;
	engine: OpenSERPEngine;
	engines: string;
}

export interface WebSearchSettings {
	enabled: boolean;
	provider: SearchProvider;
	max_results: number;
	searxng: SearXNGSearchSettings;
	openserp: OpenSERPSearchSettings;
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

export const DEFAULT_WEB_SEARCH_SETTINGS: WebSearchSettings = {
	enabled: false,
	provider: "duckduckgo",
	max_results: 5,
	searxng: { endpoint: "" },
	openserp: { endpoint: "", engine: "mega", engines: "" },
};

const SEARCH_PROVIDERS: readonly SearchProvider[] = [
	"duckduckgo",
	"searxng",
	"openserp",
];
const OPENSERP_ENGINES: readonly OpenSERPEngine[] = [
	"mega",
	"google",
	"bing",
	"duckduckgo",
	"baidu",
	"yandex",
	"ecosia",
];

function stringValue(value: unknown, fallback: string): string {
	return typeof value === "string" ? value : fallback;
}

export function normalizeWebSearchSettings(
	value: unknown,
	fallback: WebSearchSettings = DEFAULT_WEB_SEARCH_SETTINGS,
): WebSearchSettings {
	if (!value || typeof value !== "object") {
		return {
			...fallback,
			searxng: { ...fallback.searxng },
			openserp: { ...fallback.openserp },
		};
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
	const searxng: Partial<SearXNGSearchSettings> =
		stored.searxng && typeof stored.searxng === "object" ? stored.searxng : {};
	const openserp: Partial<OpenSERPSearchSettings> =
		stored.openserp && typeof stored.openserp === "object"
			? stored.openserp
			: {};
	const engine = OPENSERP_ENGINES.includes(openserp.engine as OpenSERPEngine)
		? (openserp.engine as OpenSERPEngine)
		: fallback.openserp.engine;

	return {
		enabled:
			typeof stored.enabled === "boolean" ? stored.enabled : fallback.enabled,
		provider,
		max_results: maxResults,
		searxng: {
			endpoint: stringValue(searxng.endpoint, fallback.searxng.endpoint).trim(),
		},
		openserp: {
			endpoint: stringValue(
				openserp.endpoint,
				fallback.openserp.endpoint,
			).trim(),
			engine,
			engines: stringValue(openserp.engines, fallback.openserp.engines).trim(),
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

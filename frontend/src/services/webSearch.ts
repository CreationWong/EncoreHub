// Engine-backed web search settings and the /search test helper.
//
// Provider-specific secrets (such as an Exa API key) are stored in the vault,
// not in this JSON document.

import { apiFetch } from "./api";

/** Structured search backends the Gateway can execute. */
export type SearchProvider = "duckduckgo" | "searxng" | "openserp" | "exa";
/** Exa access path: hosted free MCP, or REST with a vaulted key. */
export type ExaSearchMode = "free" | "api_key";
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

/** Persisted Exa mode. The API key itself is never stored here. */
export interface ExaSearchSettings {
	mode: ExaSearchMode;
}

export interface WebSearchSettings {
	enabled: boolean;
	provider: SearchProvider;
	max_results: number;
	searxng: SearXNGSearchSettings;
	openserp: OpenSERPSearchSettings;
	exa: ExaSearchSettings;
}

export interface WebSearchResult {
	title: string;
	url: string;
	snippet: string;
	kind?: "web" | "featured_answer";
}

export interface WebSearchResponse {
	results: WebSearchResult[];
	provider: string;
	query: string;
	warnings?: string[];
}

export const DEFAULT_WEB_SEARCH_SETTINGS: WebSearchSettings = {
	enabled: false,
	provider: "duckduckgo",
	max_results: 5,
	searxng: { endpoint: "" },
	openserp: { endpoint: "", engine: "mega", engines: "" },
	exa: { mode: "free" },
};

/** Engine secrets row for a user-supplied Exa REST key. */
export const EXA_SECRET_ID = "web_search_exa";

const SEARCH_PROVIDERS: readonly SearchProvider[] = [
	"duckduckgo",
	"searxng",
	"openserp",
	"exa",
];
const EXA_MODES: readonly ExaSearchMode[] = ["free", "api_key"];
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
			exa: { ...fallback.exa },
		};
	}
	const stored = value as Partial<WebSearchSettings>;
	const storedProvider = stored.provider as string;
	const provider =
		storedProvider === "duckduckgo_html"
			? "duckduckgo"
			: SEARCH_PROVIDERS.includes(storedProvider as SearchProvider)
				? (storedProvider as SearchProvider)
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
	const exa: Partial<ExaSearchSettings> =
		stored.exa && typeof stored.exa === "object" ? stored.exa : {};
	const engine = OPENSERP_ENGINES.includes(openserp.engine as OpenSERPEngine)
		? (openserp.engine as OpenSERPEngine)
		: fallback.openserp.engine;
	const exaMode = EXA_MODES.includes(exa.mode as ExaSearchMode)
		? (exa.mode as ExaSearchMode)
		: fallback.exa.mode;

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
		exa: { mode: exaMode },
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

import { apiFetch } from "./api";

/** Wire protocol the gateway uses to talk to a provider. */
export type ProviderProtocol = "openai" | "openai-responses" | "anthropic";
export type ProviderRoutingStrategy = "round_robin" | "failover";
export type ProviderModelType = "chat" | "embedding";
export type ProviderModelCapability =
	| "vision"
	| "web"
	| "reasoning"
	| "tools"
	| "rerank"
	| "embedding";

export interface ProviderEndpoint {
	id: string;
	name?: string;
	base_url: string;
	enabled: boolean;
}

export interface ProviderPriceCondition {
	unit?: string;
	gte?: number;
	lt?: number;
}

export interface ProviderModelPrice {
	value: number;
	unit?: string;
	currency?: string;
	conditions?: Record<string, ProviderPriceCondition>;
}

export type ProviderModelPricing = Record<string, ProviderModelPrice[]>;

export interface ProviderModelConfig {
	/** Exact model value sent in provider API requests. */
	id: string;
	/** Optional local note/alias used only for EncoreHub display. */
	name?: string;
	description?: string;
	group?: string;
	owned_by?: string;
	capabilities?: ProviderModelCapability[];
	/** Utility models are isolated from every conversation model selector. */
	type?: ProviderModelType;
	/** Default output size for embedding calls; omitted to use provider default. */
	dimensions?: number;
	/** Maximum model context size used to bound user input. */
	context_window?: number;
	max_output_tokens?: number;
	input_modalities?: string[];
	output_modalities?: string[];
	api_endpoints?: string[];
	documentation_url?: string;
	source_url?: string;
	pricing?: ProviderModelPricing;
	streaming: boolean;
	currency?: string;
	input_price?: number;
	output_price?: number;
}

/** Resolve legacy `embedding` capability records as embedding-only models. */
export function providerModelType(
	profile: ProviderProfile,
	modelId: string,
): ProviderModelType {
	const config = profile.model_configs?.find((model) => model.id === modelId);
	return config?.type === "embedding" ||
		config?.capabilities?.includes("embedding")
		? "embedding"
		: "chat";
}

/** Return only models that may be used to create or continue conversations. */
export function providerChatModels(profile: ProviderProfile): string[] {
	return profile.models.filter(
		(modelId) => providerModelType(profile, modelId) === "chat",
	);
}

/**
 * A provider profile as persisted by the gateway/engine. Mirrors the Go
 * `provider.ProviderProfile`. Never contains an API key — keys are supplied
 * per-request via the X-Provider-Key header and stored separately.
 */
export interface ProviderProfile {
	id: string;
	name: string;
	protocol: ProviderProtocol;
	/** Empty for the builtin OpenAI profile (SDK default endpoint). */
	base_url: string;
	models: string[];
	/** Ordered endpoint pool. Omitted on profiles saved by older clients. */
	endpoints?: ProviderEndpoint[];
	routing_strategy?: ProviderRoutingStrategy;
	/** Selection policy for the separately encrypted API-key pool. */
	key_routing_strategy?: ProviderRoutingStrategy;
	/** Optional display/capability metadata keyed by model id. */
	model_configs?: ProviderModelConfig[];
	enabled: boolean;
	/** Builtin profiles are editable but cannot be deleted. */
	builtin: boolean;
}

interface ProvidersResponse {
	providers: ProviderProfile[];
}

export interface DiscoveredModel {
	id: string;
	name: string;
	provider: string;
	owned_by?: string;
	description?: string;
	capabilities?: string[];
	context_limit?: number;
	max_output_tokens?: number;
	input_modalities?: string[];
	output_modalities?: string[];
	api_endpoints?: string[];
	documentation_url?: string;
	source_url?: string;
	pricing?: ProviderModelPricing;
}

export interface ModelDiscoveryEndpointResult {
	endpoint_id: string;
	status: "ok" | "error" | "skipped";
	model_count: number;
	error_category?: string;
}

export interface ModelDiscoveryResponse {
	provider: string;
	discovery_supported: boolean;
	success_count: number;
	models: DiscoveredModel[];
	endpoint_results: ModelDiscoveryEndpointResult[];
}

export interface ProviderKeyValidationResult {
	key_id: string;
	status: "valid" | "invalid" | "error" | "skipped";
	endpoint_id?: string;
	error_category?: string;
}

export interface ProviderEndpointValidationResult {
	endpoint_id: string;
	status: "valid" | "reachable" | "unreachable" | "skipped";
	latency_ms: number;
	error_category?: string;
}

export interface ProviderKeyValidationResponse {
	provider: string;
	valid: boolean;
	success_count: number;
	key_results: ProviderKeyValidationResult[];
	endpoint_results: ProviderEndpointValidationResult[];
}

export const providersApi = {
	/** List all provider profiles (builtin-first). */
	list(): Promise<ProvidersResponse> {
		return apiFetch<ProvidersResponse>("/providers");
	},

	/**
	 * Replace the entire profile list. The gateway validates, persists to the
	 * engine, and rebuilds its live adapter registry. Returns the canonical
	 * list after the update.
	 */
	update(providers: ProviderProfile[]): Promise<ProvidersResponse> {
		return apiFetch<ProvidersResponse>("/providers", {
			method: "PUT",
			body: JSON.stringify({ providers }),
		});
	},

	/** Validate request-local keys and draft endpoints without persisting either. */
	validateKey(
		providerId: string,
		protocol: ProviderProtocol,
		endpoints: ProviderEndpoint[],
		apiKeyPool: string,
	): Promise<ProviderKeyValidationResponse> {
		return apiFetch<ProviderKeyValidationResponse>(
			`/providers/${encodeURIComponent(providerId)}/validate-key`,
			{
				method: "POST",
				headers: { "X-Provider-Key": apiKeyPool },
				body: JSON.stringify({ protocol, endpoints }),
			},
		);
	},

	/** Probe draft endpoint settings without persisting the profile or key. */
	discoverModels(
		providerId: string,
		protocol: ProviderProtocol,
		endpoints: ProviderEndpoint[],
		apiKeyPool: string,
		keyRoutingStrategy: ProviderRoutingStrategy,
	): Promise<ModelDiscoveryResponse> {
		return apiFetch<ModelDiscoveryResponse>(
			`/providers/${encodeURIComponent(providerId)}/models/discover`,
			{
				method: "POST",
				headers: { "X-Provider-Key": apiKeyPool },
				body: JSON.stringify({
					protocol,
					endpoints,
					key_routing_strategy: keyRoutingStrategy,
				}),
			},
		);
	},
};

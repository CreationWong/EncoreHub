import type {
	ProviderEndpoint,
	ProviderModelConfig,
	ProviderProfile,
	ProviderProtocol,
} from "../../services/providers";

const DEFAULT_BASE_URLS: Record<ProviderProtocol, string> = {
	openai: "https://api.openai.com/v1",
	"openai-responses": "https://api.openai.com/v1",
	anthropic: "https://api.anthropic.com/v1",
};

export function normalizeBaseUrl(value: string): string {
	return value.trim().replace(/\/+$/, "");
}

export function isValidBaseUrl(value: string): boolean {
	try {
		const parsed = new URL(normalizeBaseUrl(value));
		return (
			(parsed.protocol === "http:" || parsed.protocol === "https:") &&
			Boolean(parsed.host) &&
			!parsed.username &&
			!parsed.password &&
			!parsed.search &&
			!parsed.hash
		);
	} catch {
		return false;
	}
}

function appendPath(baseUrl: string, suffix: string): string {
	const normalized = normalizeBaseUrl(baseUrl);
	return normalized.endsWith(`/${suffix}`)
		? normalized
		: `${normalized}/${suffix}`;
}

export function providerApiBaseUrl(
	protocol: ProviderProtocol,
	baseUrl: string,
): string {
	const normalized = normalizeBaseUrl(baseUrl);
	try {
		const parsed = new URL(normalized);
		const pathSegments = parsed.pathname.split("/").filter(Boolean);
		if (pathSegments.includes("v1")) {
			return normalized;
		}
		const pathProtocol = protocol === "openai-responses" ? "openai" : protocol;
		if (pathSegments.at(-1) === pathProtocol) {
			return `${normalized}/v1`;
		}
		return `${normalized}/${pathProtocol}/v1`;
	} catch {
		return normalized;
	}
}

export function chatRequestPreview(
	protocol: ProviderProtocol,
	baseUrl: string,
): string {
	return appendPath(
		providerApiBaseUrl(protocol, baseUrl),
		protocol === "anthropic"
			? "messages"
			: protocol === "openai-responses"
				? "responses"
				: "chat/completions",
	);
}

export function modelDiscoveryPreview(
	protocol: ProviderProtocol,
	baseUrl: string,
): string {
	return appendPath(providerApiBaseUrl(protocol, baseUrl), "models");
}

export function defaultBaseUrl(protocol: ProviderProtocol): string {
	return DEFAULT_BASE_URLS[protocol];
}

export function profileEndpoints(profile: ProviderProfile): ProviderEndpoint[] {
	if (profile.endpoints && profile.endpoints.length > 0) {
		return profile.endpoints.map((endpoint) => ({
			...endpoint,
			base_url: normalizeBaseUrl(endpoint.base_url),
		}));
	}
	return [
		{
			id: "primary",
			name: "Primary",
			base_url: normalizeBaseUrl(
				profile.base_url ||
					(profile.builtin ? defaultBaseUrl(profile.protocol) : ""),
			),
			enabled: true,
		},
	];
}

export function defaultModelConfig(
	id: string,
	name = id,
	group = "Models",
): ProviderModelConfig {
	return {
		id,
		name,
		group,
		capabilities: [],
		type: "chat",
		streaming: true,
		currency: "USD",
		input_price: 0,
		output_price: 0,
	};
}

export function profileModelConfigs(
	profile: ProviderProfile,
): ProviderModelConfig[] {
	const configured = new Map(
		(profile.model_configs ?? []).map((model) => [model.id, model]),
	);
	return profile.models.map((id) => ({
		...defaultModelConfig(id),
		...configured.get(id),
		id,
		capabilities: configured.get(id)?.capabilities ?? [],
	}));
}

export function createEndpoint(index: number): ProviderEndpoint {
	return {
		id: `endpoint-${Date.now().toString(36)}-${index}`,
		name: `Endpoint ${index}`,
		base_url: "",
		enabled: true,
	};
}

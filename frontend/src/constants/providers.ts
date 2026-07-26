import type {
	ProviderModelCapability,
	ProviderProtocol,
} from "../services/providers";

/**
 * Provider profiles are now dynamic — fetched from the gateway and held in
 * `useProviderStore`. This module only retains small presentation helpers.
 */

/** Placeholder/hint for the API key input, by protocol. */
export function keyHintFor(protocol: ProviderProtocol): string {
	switch (protocol) {
		case "anthropic":
			return "sk-ant-...";
		default:
			return "sk-...";
	}
}

export const API_FORMATS: {
	value: ProviderProtocol;
	label: string;
	description: string;
}[] = [
	{
		value: "openai",
		label: "OpenAI Chat Completions",
		description: "OpenAI, DeepSeek, compatible gateways, and local servers",
	},
	{
		value: "anthropic",
		label: "Anthropic Messages",
		description: "Anthropic and gateways implementing the Messages API",
	},
];

export const MODEL_CAPABILITIES: {
	value: ProviderModelCapability;
	label: string;
}[] = [
	{ value: "vision", label: "Vision" },
	{ value: "web", label: "Web" },
	{ value: "reasoning", label: "Reasoning" },
	{ value: "tools", label: "Tools" },
	{ value: "rerank", label: "Rerank" },
	{ value: "embedding", label: "Embedding" },
];

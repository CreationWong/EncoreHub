import type { MessageKey } from "../i18n";
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
	labelKey: MessageKey;
	descriptionKey: MessageKey;
}[] = [
	{
		value: "openai",
		labelKey: "providers.openaiChat",
		descriptionKey: "providers.openaiChatHelp",
	},
	{
		value: "openai-responses",
		labelKey: "providers.openaiResponses",
		descriptionKey: "providers.openaiResponsesHelp",
	},
	{
		value: "anthropic",
		labelKey: "providers.anthropic",
		descriptionKey: "providers.anthropicHelp",
	},
];

export const MODEL_CAPABILITIES: {
	value: ProviderModelCapability;
	label: string;
}[] = [
	{ value: "vision", label: "Vision" },
	{ value: "web", label: "Built-in web search" },
	{ value: "reasoning", label: "Deep thinking" },
	{ value: "tools", label: "Tools" },
	{ value: "rerank", label: "Rerank" },
	{ value: "embedding", label: "Embedding" },
];

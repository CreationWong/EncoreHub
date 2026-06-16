export interface ProviderDef {
	id: string;
	name: string;
	models: string[];
	keyHint?: string;
}

export const PROVIDERS: ProviderDef[] = [
	{
		id: "openai",
		name: "OpenAI",
		models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "o1"],
		keyHint: "sk-...",
	},
	{
		id: "anthropic",
		name: "Anthropic",
		models: [
			"claude-opus-4-8",
			"claude-sonnet-4-6",
			"claude-haiku-4-5-20251001",
		],
		keyHint: "sk-ant-...",
	},
	{
		id: "deepseek",
		name: "DeepSeek",
		models: ["deepseek-chat", "deepseek-reasoner"],
		keyHint: "sk-...",
	},
	{
		id: "google",
		name: "Google",
		models: ["gemini-2.5-flash", "gemini-2.5-pro"],
		keyHint: "AI...",
	},
	{
		id: "ollama",
		name: "Ollama (Local)",
		models: ["llama3.2", "qwen2.5", "codestral", "mistral"],
	},
];

export function getProvider(id: string): ProviderDef | undefined {
	return PROVIDERS.find((p) => p.id === id);
}

export interface SlashTool {
	id: string;
	name: `/${string}`;
	description: string;
}

// This registry describes LLM-callable tools only; execution remains owned by the Gateway.
export const SLASH_TOOLS: readonly SlashTool[] = [
	{
		id: "web_search",
		name: "/web_search",
		description: "Search the web before asking the model",
	},
];

export function matchSlashTools(input: string): SlashTool[] {
	if (!/^\/[^\s]*$/.test(input)) return [];
	const prefix = input.slice(1).toLowerCase();
	return SLASH_TOOLS.filter((tool) => tool.id.toLowerCase().startsWith(prefix));
}

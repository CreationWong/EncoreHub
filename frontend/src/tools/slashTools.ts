export interface SlashTool {
	id: string;
	name: `/${string}`;
	descriptionKey: "slash.web_search" | "slash.web_fetch";
}

// This registry describes LLM-callable tools only; execution remains owned by the Gateway.
export const SLASH_TOOLS: readonly SlashTool[] = [
	{
		id: "web_search",
		name: "/web_search",
		descriptionKey: "slash.web_search",
	},
	{
		id: "web_fetch",
		name: "/web_fetch",
		descriptionKey: "slash.web_fetch",
	},
];

export function matchSlashTools(input: string): SlashTool[] {
	if (!/^\/[^\s]*$/.test(input)) return [];
	const prefix = input.slice(1).toLowerCase();
	return SLASH_TOOLS.filter((tool) => tool.id.toLowerCase().startsWith(prefix));
}

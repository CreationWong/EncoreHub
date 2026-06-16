import type { useConversationStore } from "../stores/conversationStore";
import type { useSettingsStore } from "../stores/settingsStore";

type ConvStore = ReturnType<typeof useConversationStore.getState>;
type SettingsStore = ReturnType<typeof useSettingsStore.getState>;

export interface SlashCommand {
	id: string;
	name: string;
	description: string;
	/**
	 * Run the command. Return a string to insert into the input box, or void to
	 * consume the input (the command handles itself).
	 */
	run: (
		args: string,
		ctx: { conv: ConvStore; settings: SettingsStore },
		// biome-ignore lint/suspicious/noConfusingVoidType: callback may not return
	) => string | void | Promise<string | undefined>;
}

export const SLASH_COMMANDS: SlashCommand[] = [
	{
		id: "new",
		name: "/new",
		description: "Start a new conversation",
		run: async (_args, { conv }) => {
			await conv.newConversation();
		},
	},
	{
		id: "clear",
		name: "/clear",
		description: "Delete the current conversation",
		run: async (_args, { conv }) => {
			if (conv.activeId) {
				await conv.deleteConversation(conv.activeId);
			}
		},
	},
	{
		id: "stop",
		name: "/stop",
		description: "Stop the current generation",
		run: (_args, { conv }) => {
			conv.stopStreaming();
		},
	},
	{
		id: "model",
		name: "/model",
		description: "Open settings to switch model",
		run: (_args, { settings }) => {
			settings.openSettings("providers");
		},
	},
	{
		id: "settings",
		name: "/settings",
		description: "Open settings panel",
		run: (_args, { settings }) => {
			settings.openSettings();
		},
	},
	{
		id: "skills",
		name: "/skills",
		description: "Open skills panel",
		run: (_args, { settings }) => {
			settings.openSettings("skills");
		},
	},
	{
		id: "memory",
		name: "/memory",
		description: "Open memory panel",
		run: (_args, { settings }) => {
			settings.openSettings("memories");
		},
	},
	{
		id: "help",
		name: "/help",
		description: "Show available commands",
		run: () => {
			return SLASH_COMMANDS.map((c) => `${c.name} — ${c.description}`).join(
				"\n",
			);
		},
	},
];

export function matchCommands(prefix: string): SlashCommand[] {
	const trimmed = prefix.replace(/^\//, "").toLowerCase();
	if (!trimmed) return SLASH_COMMANDS;
	return SLASH_COMMANDS.filter(
		(c) =>
			c.id.startsWith(trimmed) ||
			c.name.slice(1).toLowerCase().startsWith(trimmed),
	);
}

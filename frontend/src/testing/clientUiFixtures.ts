import type { StreamToolCall } from "../services/chat";
import type { Conversation, Message } from "../services/conversation";
import type { ProviderProfile } from "../services/providers";
import type { Theme } from "../stores/settingsStore";

export const CLIENT_UI_BASELINE_VIEWPORTS = [
	{ id: "wide", width: 1600, height: 1120 },
	{ id: "desktop", width: 1200, height: 800 },
	{ id: "compact", width: 900, height: 700 },
	{ id: "minimum", width: 680, height: 480 },
] as const;

export const CLIENT_UI_BASELINE_THEMES = [
	"light",
	"dark",
] as const satisfies readonly Theme[];

export const CLIENT_UI_SCENARIO_IDS = [
	"no-conversation",
	"empty-conversation",
	"short",
	"long-markdown",
	"system-message",
	"reasoning",
	"tool-call",
	"streaming",
	"stopped",
	"failed",
	"provider-unavailable",
	"providers-locked",
] as const;

export type ClientUiScenarioId = (typeof CLIENT_UI_SCENARIO_IDS)[number];

export interface ClientUiScenario {
	id: ClientUiScenarioId;
	description: string;
	activeId: string | null;
	messages: Message[];
	streaming: boolean;
	streamingContent: string;
	streamingReasoning: string;
	streamingToolCalls: StreamToolCall[];
	provider: string;
	model: string;
	searchEnabled: boolean;
	settingsOpen: boolean;
	vaultLocked: boolean;
	unavailableProvider?: boolean;
}

const CREATED_AT = "2026-07-24T08:00:00.000Z";
const UPDATED_AT = "2026-07-24T09:30:00.000Z";

export const CLIENT_UI_BASELINE_PROVIDERS: ProviderProfile[] = [
	{
		id: "openai",
		name: "OpenAI",
		protocol: "openai",
		base_url: "",
		models: ["gpt-4.1", "gpt-4.1-mini"],
		enabled: true,
		builtin: true,
	},
	{
		id: "anthropic",
		name: "Anthropic",
		protocol: "anthropic",
		base_url: "https://api.anthropic.com",
		models: ["claude-sonnet-4", "claude-opus-4"],
		enabled: true,
		builtin: true,
	},
	{
		id: "deepseek",
		name: "DeepSeek",
		protocol: "openai",
		base_url: "https://api.deepseek.com",
		models: ["deepseek-chat", "deepseek-reasoner"],
		enabled: true,
		builtin: true,
	},
	{
		id: "long-provider",
		name: "OpenAI-compatible provider with an intentionally long display name",
		protocol: "openai",
		base_url: "http://127.0.0.1:11434/v1",
		models: [
			"reasoning-preview-with-an-intentionally-long-context-name-2026-07-24",
		],
		enabled: true,
		builtin: false,
	},
];

export const CLIENT_UI_BASELINE_CONVERSATIONS: Conversation[] = [
	{
		id: "conv-long",
		title: "检查跨平台客户端在超长中英文混合标题与模型名称下的布局稳定性",
		provider: "long-provider",
		model:
			"reasoning-preview-with-an-intentionally-long-context-name-2026-07-24",
		message_count: 2,
		created_at: CREATED_AT,
		updated_at: UPDATED_AT,
	},
	{
		id: "conv-short",
		title: "Release checklist",
		provider: "deepseek",
		model: "deepseek-chat",
		message_count: 2,
		created_at: "2026-07-24T07:00:00.000Z",
		updated_at: "2026-07-24T09:00:00.000Z",
	},
	{
		id: "conv-reasoning",
		title: "Reasoning state",
		provider: "deepseek",
		model: "deepseek-reasoner",
		message_count: 2,
		created_at: "2026-07-23T07:00:00.000Z",
		updated_at: "2026-07-23T09:00:00.000Z",
	},
	{
		id: "conv-tool",
		title: "Tool execution",
		provider: "openai",
		model: "gpt-4.1",
		message_count: 2,
		created_at: "2026-07-20T07:00:00.000Z",
		updated_at: "2026-07-20T09:00:00.000Z",
	},
	{
		id: "conv-streaming",
		title: "Streaming output",
		provider: "anthropic",
		model: "claude-sonnet-4",
		message_count: 1,
		created_at: "2026-07-12T07:00:00.000Z",
		updated_at: "2026-07-12T09:00:00.000Z",
	},
	{
		id: "conv-empty",
		title: "Empty conversation",
		provider: "deepseek",
		model: "deepseek-chat",
		message_count: 0,
		created_at: "2026-06-24T07:00:00.000Z",
		updated_at: "2026-06-24T09:00:00.000Z",
	},
];

function message(
	id: string,
	role: Message["role"],
	content: string,
	overrides: Partial<Message> = {},
): Message {
	return {
		id,
		role,
		content,
		parent_id: null,
		tool_calls: [],
		status: "completed",
		created_at: CREATED_AT,
		...overrides,
	};
}

const longMarkdown = `# Client UI baseline

这段回复用于检查长文本、CJK 换行、列表、表格和代码块在当前消息宽度下的表现。The same fixture also keeps a deliberately long uninterrupted identifier visible: \`provider_response_metadata_with_a_very_long_unbroken_identifier_2026_07_24\`.

## Current observations

- The message column currently uses a narrow document width.
- Provider and model selection still live at the bottom of the sidebar.
- Token usage is attached to the assistant heading instead of the reply footer.

| Area | Current state | Target state |
|---|---|---|
| Sidebar | Conversations only | Character / Conversation tabs |
| Message | Symmetric row layout | User bubble + assistant document flow |
| Token | Assistant heading | Reply footer, right aligned |

\`\`\`ts
export function buildBaseline(viewport: { width: number; height: number }) {
  return {
    ...viewport,
    stable: viewport.width >= 680,
    capturedAt: "2026-07-24",
  };
}
\`\`\`

> This is synthetic test content. It contains no user conversation data, API key, system prompt, or provider response payload.`;

const commonUser = message(
	"m-user",
	"user",
	"请检查当前客户端布局，并记录在不同窗口尺寸下出现的换行、溢出和控件位移。",
);

const scenarioMap: Record<ClientUiScenarioId, ClientUiScenario> = {
	"no-conversation": {
		id: "no-conversation",
		description: "No active conversation selected",
		activeId: null,
		messages: [],
		streaming: false,
		streamingContent: "",
		streamingReasoning: "",
		streamingToolCalls: [],
		provider: "deepseek",
		model: "deepseek-chat",
		searchEnabled: false,
		settingsOpen: false,
		vaultLocked: false,
	},
	"empty-conversation": {
		id: "empty-conversation",
		description: "Selected conversation with no messages",
		activeId: "conv-empty",
		messages: [],
		streaming: false,
		streamingContent: "",
		streamingReasoning: "",
		streamingToolCalls: [],
		provider: "deepseek",
		model: "deepseek-chat",
		searchEnabled: false,
		settingsOpen: false,
		vaultLocked: false,
	},
	short: {
		id: "short",
		description: "Short completed exchange with an unknown token count",
		activeId: "conv-short",
		messages: [
			message("m-short-user", "user", "Summarize the release status."),
			message("m-short-assistant", "assistant", "All local gates pass.", {
				parent_id: "m-short-user",
				token_count: 0,
			}),
		],
		streaming: false,
		streamingContent: "",
		streamingReasoning: "",
		streamingToolCalls: [],
		provider: "deepseek",
		model: "deepseek-chat",
		searchEnabled: false,
		settingsOpen: false,
		vaultLocked: false,
	},
	"long-markdown": {
		id: "long-markdown",
		description:
			"Long CJK/Latin Markdown, table, code, long names and large token count",
		activeId: "conv-long",
		messages: [
			commonUser,
			message("m-long-assistant", "assistant", longMarkdown, {
				parent_id: commonUser.id,
				token_count: 13126,
			}),
		],
		streaming: false,
		streamingContent: "",
		streamingReasoning: "",
		streamingToolCalls: [],
		provider: "long-provider",
		model:
			"reasoning-preview-with-an-intentionally-long-context-name-2026-07-24",
		searchEnabled: true,
		settingsOpen: false,
		vaultLocked: false,
	},
	"system-message": {
		id: "system-message",
		description: "Persisted system output with structured JSON",
		activeId: "conv-short",
		messages: [
			message(
				"m-system",
				"system",
				'Conversation state:\n```json\n{"activeId":"conv-short","messageCount":2}\n```',
			),
		],
		streaming: false,
		streamingContent: "",
		streamingReasoning: "",
		streamingToolCalls: [],
		provider: "deepseek",
		model: "deepseek-chat",
		searchEnabled: false,
		settingsOpen: false,
		vaultLocked: false,
	},
	reasoning: {
		id: "reasoning",
		description:
			"Completed assistant answer with collapsed reasoning and unknown telemetry",
		activeId: "conv-reasoning",
		messages: [
			commonUser,
			message(
				"m-reasoning-assistant",
				"assistant",
				"The baseline is ready for viewport comparison.",
				{
					parent_id: commonUser.id,
					reasoning:
						"I compared the current component boundaries, identified the scroll container, and checked which values are persisted.",
				},
			),
		],
		streaming: false,
		streamingContent: "",
		streamingReasoning: "",
		streamingToolCalls: [],
		provider: "deepseek",
		model: "deepseek-reasoner",
		searchEnabled: false,
		settingsOpen: false,
		vaultLocked: false,
	},
	"tool-call": {
		id: "tool-call",
		description: "Completed tool execution between prompt and answer",
		activeId: "conv-tool",
		messages: [
			message("m-tool-user", "user", "Find the current build status."),
			message(
				"m-tool-assistant",
				"assistant",
				"The latest local build completed successfully.",
				{
					parent_id: "m-tool-user",
					token_count: 160,
					tool_calls: [
						{
							id: "tool-1",
							name: "inspect_build_status",
							arguments: '{"target":"desktop"}',
							result: '{"status":"passed","artifacts":2}',
							status: "success",
						},
					],
				},
			),
		],
		streaming: false,
		streamingContent: "",
		streamingReasoning: "",
		streamingToolCalls: [],
		provider: "openai",
		model: "gpt-4.1",
		searchEnabled: true,
		settingsOpen: false,
		vaultLocked: false,
	},
	streaming: {
		id: "streaming",
		description:
			"Reasoning, tool and answer fragments while a reply is streaming",
		activeId: "conv-streaming",
		messages: [
			message(
				"m-stream-user",
				"user",
				"Inspect the repository and summarize the current UI structure.",
			),
		],
		streaming: true,
		streamingContent:
			"The current application uses a two-column shell. The conversation list and provider switcher share the sidebar, while the chat feed and input occupy the main column.",
		streamingReasoning:
			"I am checking the shell, message flow, input controls, and responsive constraints before recording the baseline.",
		streamingToolCalls: [
			{
				index: 0,
				id: "stream-tool-1",
				name: "inspect_layout",
				arguments: '{"viewport":"1200x800"}',
				result: "Sidebar and main chat region detected.",
				status: "success",
			},
		],
		provider: "anthropic",
		model: "claude-sonnet-4",
		searchEnabled: true,
		settingsOpen: false,
		vaultLocked: false,
	},
	stopped: {
		id: "stopped",
		description: "Persisted partial assistant reply stopped by the user",
		activeId: "conv-short",
		messages: [
			commonUser,
			message(
				"m-stopped-assistant",
				"assistant",
				"I checked the sidebar and began inspecting the message feed, but generation was stopped before the final comparison.",
				{
					parent_id: commonUser.id,
					status: "stopped",
					token_count: 74,
				},
			),
		],
		streaming: false,
		streamingContent: "",
		streamingReasoning: "",
		streamingToolCalls: [],
		provider: "deepseek",
		model: "deepseek-chat",
		searchEnabled: false,
		settingsOpen: false,
		vaultLocked: false,
	},
	failed: {
		id: "failed",
		description: "Persisted partial assistant reply after a provider failure",
		activeId: "conv-short",
		messages: [
			commonUser,
			message(
				"m-failed-assistant",
				"assistant",
				"The baseline inspection could not complete.",
				{
					parent_id: commonUser.id,
					status: "failed",
				},
			),
		],
		streaming: false,
		streamingContent: "",
		streamingReasoning: "",
		streamingToolCalls: [],
		provider: "deepseek",
		model: "deepseek-chat",
		searchEnabled: false,
		settingsOpen: false,
		vaultLocked: false,
	},
	"provider-unavailable": {
		id: "provider-unavailable",
		description:
			"Persisted conversation whose provider profile is no longer available",
		activeId: "conv-long",
		messages: [
			commonUser,
			message(
				"m-unavailable-assistant",
				"assistant",
				"The conversation retains its saved provider and model metadata.",
				{ parent_id: commonUser.id },
			),
		],
		streaming: false,
		streamingContent: "",
		streamingReasoning: "",
		streamingToolCalls: [],
		provider: "long-provider",
		model:
			"reasoning-preview-with-an-intentionally-long-context-name-2026-07-24",
		searchEnabled: false,
		settingsOpen: false,
		vaultLocked: false,
		unavailableProvider: true,
	},
	"providers-locked": {
		id: "providers-locked",
		description:
			"Current three-column provider settings with an encrypted locked key",
		activeId: "conv-short",
		messages: [],
		streaming: false,
		streamingContent: "",
		streamingReasoning: "",
		streamingToolCalls: [],
		provider: "deepseek",
		model: "deepseek-chat",
		searchEnabled: false,
		settingsOpen: true,
		vaultLocked: true,
	},
};

export interface ClientUiBaselineOptions {
	scenarioId: ClientUiScenarioId;
	theme: (typeof CLIENT_UI_BASELINE_THEMES)[number];
	sidebar: "characters" | "conversations" | "closed";
}

export function isClientUiScenarioId(
	value: string | null,
): value is ClientUiScenarioId {
	return CLIENT_UI_SCENARIO_IDS.includes(value as ClientUiScenarioId);
}

export function parseClientUiBaselineOptions(
	search: string,
): ClientUiBaselineOptions {
	const params = new URLSearchParams(search);
	const requestedScenario = params.get("scenario");
	const requestedTheme = params.get("theme");
	const requestedSidebar = params.get("sidebar");

	return {
		scenarioId: isClientUiScenarioId(requestedScenario)
			? requestedScenario
			: "long-markdown",
		theme: requestedTheme === "dark" ? "dark" : "light",
		sidebar:
			requestedSidebar === "characters" || requestedSidebar === "closed"
				? requestedSidebar
				: "conversations",
	};
}

export function getClientUiScenario(id: ClientUiScenarioId): ClientUiScenario {
	const scenario = scenarioMap[id];
	return {
		...scenario,
		messages: scenario.messages.map((item) => ({
			...item,
			tool_calls: item.tool_calls.map((call) => ({ ...call })),
		})),
		streamingToolCalls: scenario.streamingToolCalls.map((call) => ({
			...call,
		})),
	};
}

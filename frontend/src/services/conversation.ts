import { apiFetch } from "./api";
import type { Attachment } from "./attachments";
import type { CharacterSnapshot } from "./characters";

export type ReplyMode = "sequential" | "smart";

/** Human participant identity inside one group conversation. */
export interface ConversationPersona {
	name: string;
	avatar: string;
	description: string;
}

/** Per-group autonomy settings; null max_auto_turns means unlimited. */
export interface GroupChatSettings {
	auto_chat_enabled: boolean;
	max_auto_turns: number | null;
	allow_bot_mentions: boolean;
	paused: boolean;
	user_persona: ConversationPersona;
}

/** One AI member of a group conversation with its frozen character snapshot. */
export interface ConversationParticipant {
	character_id: string;
	character_version: number;
	position: number;
	character_snapshot: CharacterSnapshot;
	provider: string;
	model: string;
}

export interface Conversation {
	id: string;
	title: string;
	provider: string;
	model: string;
	/** Optional only while interoperating with a pre-CUI-10 Gateway. */
	character_id?: string;
	character_version?: number;
	character_snapshot?: CharacterSnapshot;
	/** Group reply routing; absent for single-character conversations. */
	reply_mode?: ReplyMode;
	/** Ordered AI member roster; empty for single-character conversations. */
	participants?: ConversationParticipant[];
	/** Effective group autonomy settings. */
	group_settings?: GroupChatSettings;
	message_count: number;
	created_at: string;
	updated_at: string;
}

export interface Message {
	id: string;
	role: "user" | "assistant" | "system" | "tool";
	content: string;
	/** Model chain-of-thought, shown in a collapsible block. Empty when none. */
	reasoning?: string;
	parent_id: string | null;
	/** Group member that produced this assistant message; null for other roles. */
	sender_character_id?: string | null;
	tool_calls: ToolCall[];
	/** Files bound to the message. Omitted only for local optimistic messages. */
	attachments?: Attachment[];
	/** Total input+output tokens from the provider response. 0 if unknown. */
	token_count?: number;
	/** Raw provider telemetry. Null means unavailable, including legacy records. */
	input_tokens?: number | null;
	output_tokens?: number | null;
	/** Final provider round used as a point-in-time context-window snapshot. */
	context_input_tokens?: number | null;
	context_output_tokens?: number | null;
	duration_ms?: number | null;
	finish_reason?: string | null;
	/** Persisted chat-turn lifecycle state. */
	status: "pending" | "completed" | "failed" | "stopped";
	created_at: string;
}

export interface ToolCall {
	id: string;
	name: string;
	arguments: string;
	/** Tool output once executed. Empty while pending. */
	result?: string;
	/** Execution state. */
	status?: "pending" | "success" | "error";
}

/** Gateway SSE payloads may omit empty tool_calls through Go omitempty. */
export type MessagePayload = Omit<Message, "tool_calls" | "attachments"> & {
	tool_calls?: ToolCall[] | null;
	attachments?: Attachment[] | null;
};

const DSML_TOOL_CALL_MARKERS = [
	["<|DSML|><|tool_calls|>", "</|tool_calls>"],
	["<|DSML|tool_calls>", "<|/DSML|tool_calls>"],
	["<|DSML|tool_calls>", "<|DSML|/tool_calls>"],
	["<|DSML|tool_calls>", "</|DSML|tool_calls>"],
	["<||DSML||tool_calls>", "</||DSML||tool_calls>"],
	["<｜DSML｜tool_calls>", "<｜/DSML｜tool_calls>"],
	["<｜DSML｜tool_calls>", "<｜DSML｜/tool_calls>"],
	["<｜DSML｜tool_calls>", "</｜DSML｜tool_calls>"],
	["<｜｜DSML｜｜tool_calls>", "</｜｜DSML｜｜tool_calls>"],
] as const;

// Complete DSML blocks are provider control data, including legacy messages
// persisted before the Gateway could recover their structured tool calls.
function cleanToolProtocol(content: string): string {
	if (!content.includes("DSML")) return content;

	let cleaned = content;
	while (true) {
		let startIndex = -1;
		let endIndex = -1;
		for (const [start, end] of DSML_TOOL_CALL_MARKERS) {
			const candidateStart = cleaned.indexOf(start);
			if (candidateStart < 0) continue;

			const remainderStart = candidateStart + start.length;
			const relativeEnd = cleaned.indexOf(end, remainderStart);
			if (relativeEnd < 0) continue;

			if (startIndex < 0 || candidateStart < startIndex) {
				startIndex = candidateStart;
				endIndex = relativeEnd + end.length;
			}
		}

		if (startIndex < 0) break;
		const before = cleaned.slice(0, startIndex).trimEnd();
		const after = cleaned.slice(endIndex).trimStart();
		cleaned = before && after ? `${before}\n${after}` : before || after;
	}

	return cleaned.trim();
}

function cleanAttachmentProtocol(content: string): string {
	let cleaned = content;
	for (const pattern of [
		/\n*\[Attachment OCR:[^\]]*\]\r?\n[\s\S]*?\r?\n\[\/Attachment OCR\]\n*/g,
		/\n*\[Attachment:[^\]]*\]\r?\n[\s\S]*?\r?\n\[\/Attachment\]\n*/g,
	]) {
		cleaned = cleaned.replace(pattern, "\n");
	}
	if (/^\s*\[Attachments:[^\]]*\]\s*$/.test(cleaned)) return "";
	return cleaned.trim();
}

export function normalizeMessage(message: MessagePayload): Message {
	const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
	const attachments = Array.isArray(message.attachments)
		? message.attachments
		: [];
	return {
		...message,
		content: cleanAttachmentProtocol(cleanToolProtocol(message.content)),
		tool_calls: toolCalls,
		attachments,
	};
}

type ConversationDetailPayload = Omit<ConversationDetail, "messages"> & {
	messages: MessagePayload[];
};

export interface ConversationDetail extends Conversation {
	messages: Message[];
	summary: string | null;
}

export interface ListResponse {
	conversations: Conversation[];
	total: number;
}

export async function listConversations(): Promise<ListResponse> {
	return apiFetch<ListResponse>("/conversations");
}

export async function createConversation(
	title?: string,
	provider?: string,
	model?: string,
	characterId?: string,
): Promise<Conversation> {
	return apiFetch<Conversation>("/conversations", {
		method: "POST",
		body: JSON.stringify({
			title: title || "New Chat",
			provider: provider || "",
			model: model || "",
			...(characterId ? { character_id: characterId } : {}),
		}),
	});
}

/** Optional per-member provider/model override sent while creating a group. */
export interface GroupMemberSelection {
	character_id: string;
	provider?: string;
	model?: string;
}

/** Create a multi-AI group conversation with its ordered member roster. */
export async function createGroupConversation(
	title: string,
	replyMode: ReplyMode,
	members: GroupMemberSelection[],
): Promise<Conversation> {
	return apiFetch<Conversation>("/conversations", {
		method: "POST",
		body: JSON.stringify({
			title: title || "New Group",
			reply_mode: replyMode,
			participants: members,
		}),
	});
}

/** Persist the conversation's complete group autonomy settings. */
export async function updateConversationGroupSettings(
	id: string,
	groupSettings: GroupChatSettings,
): Promise<Conversation> {
	return apiFetch<Conversation>(`/conversations/${id}`, {
		method: "PATCH",
		body: JSON.stringify({ group_settings: groupSettings }),
	});
}

/** Persist the group reply routing mode (sequential or smart). */
export async function updateConversationReplyMode(
	id: string,
	replyMode: ReplyMode,
): Promise<Conversation> {
	return apiFetch<Conversation>(`/conversations/${id}`, {
		method: "PATCH",
		body: JSON.stringify({ reply_mode: replyMode }),
	});
}

export async function getConversation(id: string): Promise<ConversationDetail> {
	const detail = await apiFetch<ConversationDetailPayload>(
		`/conversations/${id}`,
	);
	return {
		...detail,
		messages: (detail.messages ?? []).map(normalizeMessage),
	};
}

export async function deleteConversation(id: string): Promise<void> {
	await apiFetch<void>(`/conversations/${id}`, { method: "DELETE" });
}

export async function deleteMessage(
	conversationId: string,
	messageId: string,
): Promise<void> {
	await apiFetch<void>(
		`/conversations/${conversationId}/messages/${messageId}`,
		{ method: "DELETE" },
	);
}

export async function renameConversation(
	id: string,
	title: string,
): Promise<Conversation> {
	return apiFetch<Conversation>(`/conversations/${id}`, {
		method: "PATCH",
		body: JSON.stringify({ title }),
	});
}

export async function updateConversationModel(
	id: string,
	provider: string,
	model: string,
): Promise<Conversation> {
	return apiFetch<Conversation>(`/conversations/${id}`, {
		method: "PATCH",
		body: JSON.stringify({ provider, model }),
	});
}

export async function generateTitle(
	id: string,
	providerKey?: string,
	force = false,
): Promise<Conversation> {
	const headers: Record<string, string> = {};
	if (providerKey) headers["X-Provider-Key"] = providerKey;
	return apiFetch<Conversation>(`/conversations/${id}/generate-title`, {
		method: "POST",
		headers,
		body: JSON.stringify({ force }),
	});
}

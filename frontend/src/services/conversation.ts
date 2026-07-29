import { apiFetch } from "./api";
import type { CharacterSnapshot } from "./characters";

export interface Conversation {
	id: string;
	title: string;
	provider: string;
	model: string;
	/** Optional only while interoperating with a pre-CUI-10 Gateway. */
	character_id?: string;
	character_version?: number;
	character_snapshot?: CharacterSnapshot;
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
	tool_calls: ToolCall[];
	/** Total input+output tokens from the provider response. 0 if unknown. */
	token_count?: number;
	/** Raw provider telemetry. Null means unavailable, including legacy records. */
	input_tokens?: number | null;
	output_tokens?: number | null;
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
export type MessagePayload = Omit<Message, "tool_calls"> & {
	tool_calls?: ToolCall[] | null;
};

const DSML_TOOL_CALL_MARKERS = [
	["<|DSML|><|tool_calls|>", "</|tool_calls>"],
	["<|DSML|tool_calls>", "<|/DSML|tool_calls>"],
	["<|DSML|tool_calls>", "<|DSML|/tool_calls>"],
	["<｜DSML｜tool_calls>", "<｜/DSML｜tool_calls>"],
	["<｜DSML｜tool_calls>", "<｜DSML｜/tool_calls>"],
] as const;

function cleanDuplicatedToolProtocol(
	content: string,
	toolCalls: ToolCall[],
): string {
	if (toolCalls.length === 0 || !content.includes("DSML")) return content;

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

export function normalizeMessage(message: MessagePayload): Message {
	const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
	return {
		...message,
		content: cleanDuplicatedToolProtocol(message.content, toolCalls),
		tool_calls: toolCalls,
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

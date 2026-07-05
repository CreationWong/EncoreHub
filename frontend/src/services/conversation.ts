import { apiFetch } from "./api";

export interface Conversation {
	id: string;
	title: string;
	provider: string;
	model: string;
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
): Promise<Conversation> {
	return apiFetch<Conversation>("/conversations", {
		method: "POST",
		body: JSON.stringify({
			title: title || "New Chat",
			provider: provider || "",
			model: model || "",
		}),
	});
}

export async function getConversation(id: string): Promise<ConversationDetail> {
	return apiFetch<ConversationDetail>(`/conversations/${id}`);
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

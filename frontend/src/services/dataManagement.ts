/** User-data management client. Configuration and credentials are excluded. */

import { apiFetch } from "./api";

export interface DataOverview {
	conversations: number;
	messages: number;
	attachments: number;
	attachment_bytes: number;
	memories: number;
	knowledge_documents: number;
	cache_entries: number;
}

export interface UserDataBackup {
	schema: "encorehub.user-data";
	version: number;
	exported_at: string;
	domains?: DataDomain[];
	tables: Record<string, Array<Record<string, unknown>>>;
	blobs: Record<string, string>;
}

export type DataDomain =
	| "characters"
	| "conversations"
	| "memories"
	| "knowledge";

export interface ImportSummary {
	imported_rows: number;
	skipped_rows: number;
	imported_blobs: number;
}

export interface HistoryCleanup {
	conversations: number;
	deleted_blobs: number;
}

export interface CacheCleanup {
	cache_entries: number;
	orphaned_blobs: number;
}

export interface DataConversation {
	id: string;
	title: string;
	message_count: number;
	attachment_count: number;
	updated_at: string;
}

/** All user-data operations pass through the authenticated Gateway. */
export const dataManagementApi = {
	overview: (): Promise<DataOverview> =>
		apiFetch<DataOverview>("/data/overview"),
	conversations: (): Promise<DataConversation[]> =>
		apiFetch<DataConversation[]>("/data/conversations"),
	exportData: (domains?: DataDomain[]): Promise<UserDataBackup> => {
		const query = domains?.length ? `?domains=${domains.join(",")}` : "";
		return apiFetch<UserDataBackup>(`/data/export${query}`);
	},
	importData: (backup: UserDataBackup): Promise<ImportSummary> =>
		apiFetch<ImportSummary>("/data/import", {
			method: "POST",
			body: JSON.stringify(backup),
		}),
	exportConversations: (conversationIds: string[]): Promise<UserDataBackup> =>
		apiFetch<UserDataBackup>("/data/conversations/export", {
			method: "POST",
			body: JSON.stringify({ conversation_ids: conversationIds }),
		}),
	deleteConversations: (conversationIds: string[]): Promise<HistoryCleanup> =>
		apiFetch<HistoryCleanup>("/data/conversations/delete", {
			method: "POST",
			body: JSON.stringify({ conversation_ids: conversationIds }),
		}),
	clearHistory: (): Promise<HistoryCleanup> =>
		apiFetch<HistoryCleanup>("/data/conversations", { method: "DELETE" }),
	clearCache: (): Promise<CacheCleanup> =>
		apiFetch<CacheCleanup>("/data/cache", { method: "DELETE" }),
};

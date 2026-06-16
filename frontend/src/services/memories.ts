import { apiFetch } from "./api";

export interface Memory {
	id: string;
	scope: string;
	memory_type: string;
	conversation_id: string | null;
	content: string;
	importance: number;
	created_at: string;
	last_accessed_at: string;
}

interface MemoryListResponse {
	memories: Memory[];
	total: number;
}

interface MemorySearchResponse {
	results: Memory[];
	query: string;
}

export interface MemorySearchOptions {
	q: string;
	scope?: string;
	top_k?: number;
}

export const memoriesApi = {
	list(scope?: string): Promise<MemoryListResponse> {
		const path = scope
			? `/memories?scope=${encodeURIComponent(scope)}`
			: "/memories";
		return apiFetch<MemoryListResponse>(path);
	},

	search(opts: MemorySearchOptions): Promise<MemorySearchResponse> {
		const params = new URLSearchParams({ q: opts.q });
		if (opts.scope) params.set("scope", opts.scope);
		if (opts.top_k) params.set("top_k", String(opts.top_k));
		return apiFetch<MemorySearchResponse>(`/memories/search?${params}`);
	},

	delete(id: string): Promise<void> {
		return apiFetch<void>(`/memories/${id}`, { method: "DELETE" });
	},
};

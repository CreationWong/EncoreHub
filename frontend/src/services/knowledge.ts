// Typed Gateway client contracts for the local Knowledge base.
//
// The Engine owns chunking and indexing; this client only mirrors the
// browse/search/inspect surface the settings panel renders.

import { apiFetch } from "./api";

export interface KnowledgeDoc {
	id: string;
	title: string;
	file_type: string;
	chunk_count: number;
	size_bytes: number;
	created_at: string;
}

export interface KnowledgeChunk {
	id: string;
	document_id: string;
	content: string;
	chunk_index: number;
	score: number;
}

/** One stored chunk returned by the chunk browser (no search score). */
export interface KnowledgeDocChunk {
	id: string;
	document_id: string;
	content: string;
	chunk_index: number;
	token_count: number;
}

/** Retrieval route that served a Knowledge search request. */
export type KnowledgeBackend =
	| "lance_db"
	| "sqlite_vec"
	| "sqlite_fts"
	| "hybrid";

interface KnowledgeSearchResponse {
	results: KnowledgeChunk[];
	query: string;
	backend: KnowledgeBackend;
}

export interface KnowledgeListOptions {
	q?: string;
	limit?: number;
	offset?: number;
}

export interface IngestPayload {
	title: string;
	content: string;
	file_type?: string;
}

export const knowledgeApi = {
	list(options: KnowledgeListOptions = {}): Promise<KnowledgeDoc[]> {
		const params = new URLSearchParams();
		if (options.q?.trim()) params.set("q", options.q.trim());
		if (options.limit != null) params.set("limit", String(options.limit));
		if (options.offset != null) params.set("offset", String(options.offset));
		const query = params.toString();
		return apiFetch<KnowledgeDoc[]>(
			query ? `/knowledge?${query}` : "/knowledge",
		);
	},

	/** List every stored chunk of one document, ordered by chunk index. */
	chunks(id: string): Promise<KnowledgeDocChunk[]> {
		return apiFetch<KnowledgeDocChunk[]>(
			`/knowledge/${encodeURIComponent(id)}/chunks`,
		);
	},

	ingest(payload: IngestPayload): Promise<KnowledgeDoc> {
		return apiFetch<KnowledgeDoc>("/knowledge", {
			method: "POST",
			body: JSON.stringify(payload),
		});
	},

	search(q: string, topK = 5): Promise<KnowledgeSearchResponse> {
		const params = new URLSearchParams({ q, top_k: String(topK) });
		return apiFetch<KnowledgeSearchResponse>(`/knowledge/search?${params}`);
	},

	delete(id: string): Promise<void> {
		return apiFetch<void>(`/knowledge/${encodeURIComponent(id)}`, {
			method: "DELETE",
		});
	},
};

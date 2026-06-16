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

interface KnowledgeListResponse {
	documents: KnowledgeDoc[];
	total: number;
}

interface KnowledgeSearchResponse {
	results: KnowledgeChunk[];
	query: string;
}

export interface IngestPayload {
	title: string;
	content: string;
	file_type?: string;
}

export const knowledgeApi = {
	list(): Promise<KnowledgeListResponse> {
		return apiFetch<KnowledgeListResponse>("/knowledge");
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
		return apiFetch<void>(`/knowledge/${id}`, { method: "DELETE" });
	},
};

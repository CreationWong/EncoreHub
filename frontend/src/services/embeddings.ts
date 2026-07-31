import { apiFetch } from "./api";

export interface CreateEmbeddingsInput {
	provider: string;
	model: string;
	input: string | string[];
	dimensions?: number;
	apiKey: string;
}

export interface EmbeddingVector {
	object: "embedding" | string;
	index: number;
	embedding: number[];
}

export interface EmbeddingsResponse {
	object: "list" | string;
	data: EmbeddingVector[];
	model: string;
	usage: {
		prompt_tokens: number;
		total_tokens: number;
	};
}

/** Standalone feature API; this module has no dependency on conversation state. */
export const embeddingsApi = {
	create(request: CreateEmbeddingsInput): Promise<EmbeddingsResponse> {
		return apiFetch<EmbeddingsResponse>(
			`/providers/${encodeURIComponent(request.provider)}/embeddings`,
			{
				method: "POST",
				headers: { "X-Provider-Key": request.apiKey },
				body: JSON.stringify({
					model: request.model,
					input: request.input,
					dimensions: request.dimensions,
					encoding_format: "float",
				}),
			},
		);
	},
};

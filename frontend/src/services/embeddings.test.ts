import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.fn();
vi.mock("./api", () => ({
	apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

import { embeddingsApi } from "./embeddings";

beforeEach(() => apiFetch.mockReset().mockResolvedValue(undefined));

describe("embeddings service", () => {
	it("calls the standalone provider endpoint without conversation data", async () => {
		await embeddingsApi.create({
			provider: "custom/openai",
			model: "text-embedding-3-small",
			input: ["one", "two"],
			dimensions: 256,
			apiKey: "secret-pool",
		});

		expect(apiFetch).toHaveBeenCalledWith(
			"/providers/custom%2Fopenai/embeddings",
			expect.objectContaining({
				method: "POST",
				headers: { "X-Provider-Key": "secret-pool" },
			}),
		);
		expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({
			model: "text-embedding-3-small",
			input: ["one", "two"],
			dimensions: 256,
			encoding_format: "float",
		});
	});
});

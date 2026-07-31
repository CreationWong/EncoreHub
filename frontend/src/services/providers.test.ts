import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.fn();
vi.mock("./api", () => ({
	apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

import {
	providerChatModels,
	providerModelType,
	providersApi,
} from "./providers";

beforeEach(() => apiFetch.mockReset().mockResolvedValue(undefined));

describe("providers service", () => {
	it("keeps embedding models out of the chat model set", () => {
		const profile = {
			id: "openai",
			name: "OpenAI",
			protocol: "openai" as const,
			base_url: "",
			models: ["gpt-4o-mini", "text-embedding-3-small", "legacy-vector"],
			model_configs: [
				{
					id: "text-embedding-3-small",
					type: "embedding" as const,
					streaming: false,
				},
				{
					id: "legacy-vector",
					capabilities: ["embedding" as const],
					streaming: false,
				},
			],
			enabled: true,
			builtin: true,
		};

		expect(providerModelType(profile, "legacy-vector")).toBe("embedding");
		expect(providerChatModels(profile)).toEqual(["gpt-4o-mini"]);
	});

	it("validates temporary keys and draft endpoints without profile data", async () => {
		await providersApi.validateKey(
			"custom/provider",
			"anthropic",
			[
				{
					id: "primary",
					name: "Primary",
					base_url: "https://api.example.com/v1",
					enabled: true,
				},
			],
			"temporary-key-pool",
		);

		expect(apiFetch).toHaveBeenCalledWith(
			"/providers/custom%2Fprovider/validate-key",
			expect.objectContaining({
				method: "POST",
				headers: { "X-Provider-Key": "temporary-key-pool" },
			}),
		);
		const options = apiFetch.mock.calls[0][1];
		expect(JSON.parse(options.body)).toEqual({
			protocol: "anthropic",
			endpoints: [
				{
					id: "primary",
					name: "Primary",
					base_url: "https://api.example.com/v1",
					enabled: true,
				},
			],
		});
	});

	it("discovers models with draft endpoints and a secret header", async () => {
		await providersApi.discoverModels(
			"custom/provider",
			"openai",
			[
				{
					id: "primary",
					name: "Primary",
					base_url: "https://api.example.com/v1",
					enabled: true,
				},
			],
			"test-key",
			"round_robin",
		);

		expect(apiFetch).toHaveBeenCalledWith(
			"/providers/custom%2Fprovider/models/discover",
			expect.objectContaining({
				method: "POST",
				headers: { "X-Provider-Key": "test-key" },
			}),
		);
		const options = apiFetch.mock.calls[0][1];
		expect(JSON.parse(options.body)).toEqual({
			protocol: "openai",
			key_routing_strategy: "round_robin",
			endpoints: [
				{
					id: "primary",
					name: "Primary",
					base_url: "https://api.example.com/v1",
					enabled: true,
				},
			],
		});
	});
});

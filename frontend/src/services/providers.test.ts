import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.fn();
vi.mock("./api", () => ({
	apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

import { providersApi } from "./providers";

beforeEach(() => apiFetch.mockReset().mockResolvedValue(undefined));

describe("providers service", () => {
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

import { describe, expect, it } from "vitest";
import type { ProviderModelConfig } from "../../services/providers";
import { buildProviderModelDiscoveryDiff } from "./providerDiscovery";

const localModel = (id: string, name = id): ProviderModelConfig => ({
	id,
	name,
	group: "Local",
	capabilities: [],
	streaming: true,
	currency: "USD",
	input_price: 0,
	output_price: 0,
});

describe("provider model discovery diff", () => {
	it("preserves retained metadata and stages remote additions and removals", () => {
		const retained = localModel("model-a", "Local alias");
		const removed = localModel("model-old");
		const diff = buildProviderModelDiscoveryDiff(
			[retained, removed],
			[
				{ id: "model-a", name: "Remote name", provider: "custom" },
				{ id: "model-new", name: "Remote New", provider: "custom" },
			],
			true,
		);

		expect(diff.additions.map((model) => model.id)).toEqual(["model-new"]);
		expect(diff.retained).toEqual([expect.objectContaining(retained)]);
		expect(diff.removals).toEqual([removed]);
		expect(diff.nextModels).toEqual([
			expect.objectContaining(retained),
			expect.objectContaining({ id: "model-new", name: "Remote New" }),
		]);
	});

	it("requires model selection for large or multi-owner discovery results", () => {
		const multiOwner = buildProviderModelDiscoveryDiff(
			[],
			[
				{ id: "model-a", name: "A", provider: "custom", owned_by: "alpha" },
				{ id: "model-b", name: "B", provider: "custom", owned_by: "beta" },
			],
			true,
		);
		expect(multiOwner.selectionRequired).toBe(true);
		expect(multiOwner.owners).toEqual(["alpha", "beta"]);

		const large = buildProviderModelDiscoveryDiff(
			[],
			Array.from({ length: 10 }, (_, index) => ({
				id: `model-${index}`,
				name: `Model ${index}`,
				provider: "custom",
				owned_by: "alpha",
			})),
			true,
		);
		expect(large.selectionRequired).toBe(true);
	});

	it("maps discovery and saved catalog metadata into provider model configs", () => {
		const diff = buildProviderModelDiscoveryDiff(
			[],
			[
				{
					id: "openai/gpt-test",
					name: "GPT Test",
					provider: "custom",
					owned_by: "openai",
					context_limit: 128000,
					api_endpoints: ["/v1/chat/completions"],
					pricing: {
						prompt: [{ value: 1.5, unit: "perMTokens", currency: "USD" }],
					},
				},
			],
			true,
			() => ({
				id: "openai/gpt-test",
				documentationUrl: "https://docs.example.com/gpt-test",
				capabilities: ["reasoning"],
			}),
		);

		expect(diff.nextModels[0]).toMatchObject({
			id: "openai/gpt-test",
			owned_by: "openai",
			context_window: 128000,
			api_endpoints: ["/v1/chat/completions"],
			documentation_url: "https://docs.example.com/gpt-test",
			capabilities: ["reasoning"],
			input_price: 1.5,
		});
	});

	it("withholds removals when discovery is only partially successful", () => {
		const current = [localModel("model-a"), localModel("local-only")];
		const diff = buildProviderModelDiscoveryDiff(
			current,
			[
				{ id: "model-a", name: "Model A", provider: "custom" },
				{ id: "model-new", name: "Model New", provider: "custom" },
			],
			false,
		);

		expect(diff.removals).toEqual([]);
		expect(diff.removalsWithheld).toBe(true);
		expect(diff.nextModels.map((model) => model.id)).toEqual([
			"model-a",
			"local-only",
			"model-new",
		]);
	});
});

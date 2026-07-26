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
		expect(diff.retained).toEqual([retained]);
		expect(diff.removals).toEqual([removed]);
		expect(diff.nextModels).toEqual([
			retained,
			expect.objectContaining({ id: "model-new", name: "Remote New" }),
		]);
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

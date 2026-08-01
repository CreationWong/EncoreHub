import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	DEFAULT_MODEL_METADATA_PROVIDER,
	modelMetadataApi,
} from "../services/modelMetadata";
import {
	modelMetadataForId,
	useModelMetadataStore,
} from "./modelMetadataStore";

describe("model metadata provider store", () => {
	beforeEach(() => {
		localStorage.clear();
		vi.spyOn(modelMetadataApi, "save").mockResolvedValue(undefined);
		vi.spyOn(modelMetadataApi, "load").mockResolvedValue(null);
		useModelMetadataStore.setState({
			providers: [{ ...DEFAULT_MODEL_METADATA_PROVIDER, mapping: {} }],
			recordsByProvider: {},
			loadingProviderIds: [],
			loaded: true,
			loading: false,
			error: null,
		});
	});

	it("persists provider edits and mapping changes in the engine config", async () => {
		const store = useModelMetadataStore.getState();
		await store.setMapping("models-dev", { id: "model_id" });
		await store.setEnabled("models-dev", false);

		expect(useModelMetadataStore.getState().providers[0]).toMatchObject({
			enabled: false,
			mapping: { id: "model_id" },
		});
		expect(modelMetadataApi.save).toHaveBeenLastCalledWith(
			expect.objectContaining({
				providers: [
					expect.objectContaining({
						enabled: false,
						mapping: { id: "model_id" },
					}),
				],
			}),
		);
	});

	it("adds and removes custom providers", async () => {
		const custom = {
			...DEFAULT_MODEL_METADATA_PROVIDER,
			id: "custom",
			name: "Custom",
		};
		await useModelMetadataStore.getState().upsert(custom);
		expect(useModelMetadataStore.getState().providers).toHaveLength(2);

		await useModelMetadataStore.getState().remove("custom");
		expect(useModelMetadataStore.getState().providers).toHaveLength(1);
	});

	it("prefers exact IDs and falls back to a unique qualified-ID suffix", () => {
		const provider = {
			...DEFAULT_MODEL_METADATA_PROVIDER,
			mapping: {},
		};
		const state = {
			providers: [provider],
			recordsByProvider: {
				"models-dev": [
					{ id: "model-a", contextWindow: 32000 },
					{ id: "vendor/model-a", contextWindow: 64000 },
					{ id: "model-a-mini", contextWindow: 8000 },
					{ id: "openai/gpt-4o", contextWindow: 128000 },
				],
			},
		};

		expect(modelMetadataForId(state, "model-a")?.contextWindow).toBe(32000);
		expect(modelMetadataForId(state, "gpt-4o")?.contextWindow).toBe(128000);
		expect(modelMetadataForId(state, "model")).toBeUndefined();
		expect(
			modelMetadataForId(
				{ ...state, providers: [{ ...provider, enabled: false }] },
				"model-a",
			),
		).toBeUndefined();
	});

	it("does not guess when multiple qualified IDs share the same suffix", () => {
		const state = {
			providers: [
				{
					...DEFAULT_MODEL_METADATA_PROVIDER,
					mapping: {},
				},
			],
			recordsByProvider: {
				"models-dev": [
					{ id: "vendor-a/shared-model", contextWindow: 32000 },
					{ id: "vendor-b/shared-model", contextWindow: 64000 },
				],
			},
		};

		expect(modelMetadataForId(state, "shared-model")).toBeUndefined();
	});
});

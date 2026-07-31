import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_MODEL_METADATA_PROVIDER } from "../services/modelMetadata";
import {
	modelMetadataForId,
	useModelMetadataStore,
} from "./modelMetadataStore";

describe("model metadata provider store", () => {
	beforeEach(() => {
		localStorage.clear();
		useModelMetadataStore.setState({
			providers: [{ ...DEFAULT_MODEL_METADATA_PROVIDER, mapping: {} }],
			recordsByProvider: {},
			loadingProviderIds: [],
		});
	});

	it("persists provider edits and mapping changes", () => {
		const store = useModelMetadataStore.getState();
		store.setMapping("models-dev", { id: "model_id" });
		store.setEnabled("models-dev", false);

		expect(useModelMetadataStore.getState().providers[0]).toMatchObject({
			enabled: false,
			mapping: { id: "model_id" },
		});
		expect(
			localStorage.getItem("encorehub-model-metadata-providers"),
		).toContain("model_id");
	});

	it("adds and removes custom providers", () => {
		const custom = {
			...DEFAULT_MODEL_METADATA_PROVIDER,
			id: "custom",
			name: "Custom",
		};
		useModelMetadataStore.getState().upsert(custom);
		expect(useModelMetadataStore.getState().providers).toHaveLength(2);

		useModelMetadataStore.getState().remove("custom");
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

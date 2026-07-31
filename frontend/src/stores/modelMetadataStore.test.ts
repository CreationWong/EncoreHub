import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_MODEL_METADATA_PROVIDER } from "../services/modelMetadata";
import { useModelMetadataStore } from "./modelMetadataStore";

describe("model metadata provider store", () => {
	beforeEach(() => {
		localStorage.clear();
		useModelMetadataStore.setState({
			providers: [{ ...DEFAULT_MODEL_METADATA_PROVIDER, mapping: {} }],
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
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	DEFAULT_MODEL_METADATA_PROVIDER,
	MODEL_METADATA_REFRESH_TTL_MS,
	modelMetadataApi,
} from "../services/modelMetadata";
import {
	isModelMetadataStale,
	modelMetadataForId,
	useModelMetadataStore,
} from "./modelMetadataStore";

const fetchMock = vi.fn();

describe("model metadata provider store", () => {
	beforeEach(() => {
		localStorage.clear();
		fetchMock.mockReset();
		vi.stubGlobal("fetch", fetchMock);
		vi.spyOn(modelMetadataApi, "save").mockResolvedValue(undefined);
		vi.spyOn(modelMetadataApi, "load").mockResolvedValue(null);
		useModelMetadataStore.setState({
			providers: [{ ...DEFAULT_MODEL_METADATA_PROVIDER, mapping: {} }],
			recordsByProvider: {},
			updatedAt: {},
			autoUpdate: true,
			loadingProviderIds: [],
			loaded: true,
			loading: false,
			error: null,
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
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

	it("stamps the refresh time when provider records are fetched", async () => {
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => ({ "demo/model": { id: "demo/model" } }),
		});

		await useModelMetadataStore.getState().refreshProvider("models-dev");

		const stamped = useModelMetadataStore.getState().updatedAt["models-dev"];
		expect(Number.isNaN(Date.parse(stamped))).toBe(false);
		expect(modelMetadataApi.save).toHaveBeenLastCalledWith(
			expect.objectContaining({ updated_at: { "models-dev": stamped } }),
		);
	});

	it("refreshes missing, stale, and invalidated catalogs on startup", async () => {
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => ({ "demo/model": { id: "demo/model" } }),
		});

		await useModelMetadataStore.getState().refreshStale();
		expect(fetchMock).toHaveBeenCalledTimes(1);

		fetchMock.mockClear();
		useModelMetadataStore.setState({
			recordsByProvider: { "models-dev": [{ id: "cached" }] },
			updatedAt: { "models-dev": new Date().toISOString() },
		});
		await useModelMetadataStore.getState().refreshStale();
		expect(fetchMock).not.toHaveBeenCalled();

		useModelMetadataStore.setState({
			updatedAt: {
				"models-dev": new Date(
					Date.now() - MODEL_METADATA_REFRESH_TTL_MS - 1,
				).toISOString(),
			},
		});
		await useModelMetadataStore.getState().refreshStale();
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("skips the startup refresh when auto-update is disabled", async () => {
		fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
		useModelMetadataStore.setState({ autoUpdate: false });

		await useModelMetadataStore.getState().refreshStale();

		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("treats missing or malformed refresh timestamps as stale", () => {
		const now = Date.now();
		expect(isModelMetadataStale(undefined, now)).toBe(true);
		expect(isModelMetadataStale("not-a-date", now)).toBe(true);
		expect(isModelMetadataStale(new Date(now).toISOString(), now)).toBe(false);
		expect(
			isModelMetadataStale(
				new Date(now - MODEL_METADATA_REFRESH_TTL_MS + 1000).toISOString(),
				now,
			),
		).toBe(false);
	});
});

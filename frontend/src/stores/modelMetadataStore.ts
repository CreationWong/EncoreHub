import { create } from "zustand";
import {
	DEFAULT_MODEL_METADATA_PROVIDER,
	type ModelMetadataMapping,
	type ModelMetadataProvider,
	type NormalizedModelMetadata,
	fetchModelMetadata,
} from "../services/modelMetadata";

const STORAGE_KEY = "encorehub-model-metadata-providers";

export interface ModelMetadataState {
	providers: ModelMetadataProvider[];
	recordsByProvider: Record<string, NormalizedModelMetadata[]>;
	loadingProviderIds: string[];
	upsert: (provider: ModelMetadataProvider) => void;
	remove: (id: string) => void;
	setEnabled: (id: string, enabled: boolean) => void;
	setMapping: (id: string, mapping: ModelMetadataMapping) => void;
	setRecords: (id: string, records: NormalizedModelMetadata[]) => void;
	refreshProvider: (id: string) => Promise<NormalizedModelMetadata[]>;
	refreshEnabled: () => Promise<void>;
}

function cloneProvider(provider: ModelMetadataProvider): ModelMetadataProvider {
	return { ...provider, mapping: { ...provider.mapping } };
}

function defaultProviders(): ModelMetadataProvider[] {
	return [cloneProvider(DEFAULT_MODEL_METADATA_PROVIDER)];
}

function loadProviders(): ModelMetadataProvider[] {
	if (typeof window === "undefined") return defaultProviders();
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return defaultProviders();
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) return defaultProviders();
		const providers = parsed.flatMap((item): ModelMetadataProvider[] => {
			if (!item || typeof item !== "object") return [];
			const candidate = item as Partial<ModelMetadataProvider>;
			if (
				typeof candidate.id !== "string" ||
				typeof candidate.name !== "string" ||
				typeof candidate.url !== "string"
			) {
				return [];
			}
			return [
				{
					id: candidate.id,
					name: candidate.name,
					url: candidate.url,
					enabled: candidate.enabled !== false,
					format: candidate.format === "array" ? "array" : "object",
					mapping: { ...(candidate.mapping ?? {}) },
				},
			];
		});
		return providers.length > 0 ? providers : defaultProviders();
	} catch {
		return defaultProviders();
	}
}

function persistProviders(providers: ModelMetadataProvider[]) {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(providers));
	} catch {
		/* Settings persistence must not block the metadata editor. */
	}
}

export const useModelMetadataStore = create<ModelMetadataState>((set, get) => ({
	providers: loadProviders(),
	recordsByProvider: {},
	loadingProviderIds: [],
	upsert: (provider) => {
		const next = get().providers.filter((item) => item.id !== provider.id);
		const providers = [...next, cloneProvider(provider)];
		set({ providers });
		persistProviders(providers);
	},
	remove: (id) => {
		const providers = get().providers.filter((item) => item.id !== id);
		const recordsByProvider = { ...get().recordsByProvider };
		delete recordsByProvider[id];
		set({ providers, recordsByProvider });
		persistProviders(providers);
	},
	setEnabled: (id, enabled) => {
		const providers = get().providers.map((item) =>
			item.id === id ? { ...item, enabled } : item,
		);
		set({ providers });
		persistProviders(providers);
	},
	setMapping: (id, mapping) => {
		const providers = get().providers.map((item) =>
			item.id === id ? { ...item, mapping: { ...mapping } } : item,
		);
		set({ providers });
		persistProviders(providers);
	},
	setRecords: (id, records) =>
		set((state) => ({
			recordsByProvider: { ...state.recordsByProvider, [id]: records },
		})),
	refreshProvider: async (id) => {
		const provider = get().providers.find((item) => item.id === id);
		if (!provider?.enabled) return [];
		set((state) => ({
			loadingProviderIds: state.loadingProviderIds.includes(id)
				? state.loadingProviderIds
				: [...state.loadingProviderIds, id],
		}));
		try {
			const result = await fetchModelMetadata(provider);
			get().setRecords(id, result.records);
			return result.records;
		} finally {
			set((state) => ({
				loadingProviderIds: state.loadingProviderIds.filter(
					(providerId) => providerId !== id,
				),
			}));
		}
	},
	refreshEnabled: async () => {
		const pending = get()
			.providers.filter(
				(provider) => provider.enabled && !get().recordsByProvider[provider.id],
			)
			.map((provider) => get().refreshProvider(provider.id));
		await Promise.allSettled(pending);
	},
}));

export function modelMetadataForId(
	state: Pick<ModelMetadataState, "providers" | "recordsByProvider">,
	modelId: string,
): NormalizedModelMetadata | undefined {
	const requestedId = modelId.trim();
	if (!requestedId) return undefined;

	const suffixMatches = new Map<string, NormalizedModelMetadata>();
	for (const provider of state.providers) {
		if (!provider.enabled) continue;
		for (const record of state.recordsByProvider[provider.id] ?? []) {
			if (record.id === requestedId) return record;
			// Catalogs such as models.dev qualify IDs as "provider/model" while
			// provider APIs commonly expose only the trailing model ID.
			if (record.id.endsWith(`/${requestedId}`)) {
				suffixMatches.set(record.id, suffixMatches.get(record.id) ?? record);
			}
		}
	}

	return suffixMatches.size === 1
		? suffixMatches.values().next().value
		: undefined;
}

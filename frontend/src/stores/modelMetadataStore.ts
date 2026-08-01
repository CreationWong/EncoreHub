import { create } from "zustand";
import {
	DEFAULT_MODEL_METADATA_PROVIDER,
	type ModelMetadataDatabase,
	type ModelMetadataMapping,
	type ModelMetadataProvider,
	type NormalizedModelMetadata,
	fetchModelMetadata,
	modelMetadataApi,
} from "../services/modelMetadata";

const LEGACY_STORAGE_KEY = "encorehub-model-metadata-providers";

export interface ModelMetadataState {
	providers: ModelMetadataProvider[];
	recordsByProvider: Record<string, NormalizedModelMetadata[]>;
	loadingProviderIds: string[];
	loaded: boolean;
	loading: boolean;
	error: string | null;
	load: () => Promise<void>;
	upsert: (
		provider: ModelMetadataProvider,
		previousId?: string,
	) => Promise<void>;
	remove: (id: string) => Promise<void>;
	setEnabled: (id: string, enabled: boolean) => Promise<void>;
	setMapping: (id: string, mapping: ModelMetadataMapping) => Promise<void>;
	setRecords: (id: string, records: NormalizedModelMetadata[]) => Promise<void>;
	refreshProvider: (id: string) => Promise<NormalizedModelMetadata[]>;
	refreshEnabled: () => Promise<void>;
}

function cloneProvider(provider: ModelMetadataProvider): ModelMetadataProvider {
	return { ...provider, mapping: { ...provider.mapping } };
}

function defaultProviders(): ModelMetadataProvider[] {
	return [cloneProvider(DEFAULT_MODEL_METADATA_PROVIDER)];
}

function normalizeProvider(value: unknown): ModelMetadataProvider | null {
	if (!value || typeof value !== "object") return null;
	const candidate = value as Partial<ModelMetadataProvider>;
	if (
		typeof candidate.id !== "string" ||
		typeof candidate.name !== "string" ||
		typeof candidate.url !== "string"
	) {
		return null;
	}
	return {
		id: candidate.id,
		name: candidate.name,
		url: candidate.url,
		enabled: candidate.enabled !== false,
		format: candidate.format === "array" ? "array" : "object",
		dataPath: typeof candidate.dataPath === "string" ? candidate.dataPath : "",
		preset: candidate.preset ?? "custom",
		mapping: { ...(candidate.mapping ?? {}) },
	};
}

function legacyProviders(): ModelMetadataProvider[] {
	if (typeof window === "undefined") return defaultProviders();
	try {
		const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
		if (!raw) return defaultProviders();
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) return defaultProviders();
		const providers = parsed.flatMap((item) => {
			const provider = normalizeProvider(item);
			return provider ? [provider] : [];
		});
		return providers.length > 0 ? providers : defaultProviders();
	} catch {
		return defaultProviders();
	}
}

function normalizeDatabase(value: unknown): ModelMetadataDatabase | null {
	if (!value || typeof value !== "object") return null;
	const candidate = value as Partial<ModelMetadataDatabase>;
	if (!Array.isArray(candidate.providers)) return null;
	const providers = candidate.providers.flatMap((item) => {
		const provider = normalizeProvider(item);
		return provider ? [provider] : [];
	});
	const recordsByProvider =
		candidate.records_by_provider &&
		typeof candidate.records_by_provider === "object"
			? candidate.records_by_provider
			: {};
	return {
		version: 1,
		providers: providers.length > 0 ? providers : defaultProviders(),
		records_by_provider: recordsByProvider,
	};
}

function snapshot(
	state: Pick<ModelMetadataState, "providers" | "recordsByProvider">,
): ModelMetadataDatabase {
	return {
		version: 1,
		providers: state.providers.map(cloneProvider),
		records_by_provider: state.recordsByProvider,
	};
}

async function persist(get: () => ModelMetadataState): Promise<void> {
	await modelMetadataApi.save(snapshot(get()));
}

export const useModelMetadataStore = create<ModelMetadataState>((set, get) => ({
	providers: defaultProviders(),
	recordsByProvider: {},
	loadingProviderIds: [],
	loaded: false,
	loading: false,
	error: null,
	load: async () => {
		if (get().loaded || get().loading) return;
		set({ loading: true, error: null });
		try {
			const stored = normalizeDatabase(await modelMetadataApi.load());
			if (stored) {
				set({
					providers: stored.providers,
					recordsByProvider: stored.records_by_provider,
					loaded: true,
					loading: false,
				});
				return;
			}
			const providers = legacyProviders();
			set({ providers, recordsByProvider: {}, loaded: true, loading: false });
			await persist(get);
			try {
				localStorage.removeItem(LEGACY_STORAGE_KEY);
			} catch {
				/* The database copy is authoritative even if legacy cleanup is blocked. */
			}
		} catch (reason) {
			set({
				loaded: true,
				loading: false,
				error:
					reason instanceof Error
						? reason.message
						: "Failed to load model metadata",
			});
		}
	},
	upsert: async (provider, previousId) => {
		const sourceId = previousId ?? provider.id;
		const providers = [
			...get().providers.filter(
				(item) => item.id !== sourceId && item.id !== provider.id,
			),
			cloneProvider(provider),
		];
		const recordsByProvider = { ...get().recordsByProvider };
		if (sourceId !== provider.id && recordsByProvider[sourceId]) {
			recordsByProvider[provider.id] = recordsByProvider[sourceId];
			delete recordsByProvider[sourceId];
		}
		set({ providers, recordsByProvider, error: null });
		await persist(get);
	},
	remove: async (id) => {
		const providers = get().providers.filter((item) => item.id !== id);
		const recordsByProvider = { ...get().recordsByProvider };
		delete recordsByProvider[id];
		set({ providers, recordsByProvider, error: null });
		await persist(get);
	},
	setEnabled: async (id, enabled) => {
		const providers = get().providers.map((item) =>
			item.id === id ? { ...item, enabled } : item,
		);
		set({ providers, error: null });
		await persist(get);
	},
	setMapping: async (id, mapping) => {
		const providers = get().providers.map((item) =>
			item.id === id ? { ...item, mapping: { ...mapping } } : item,
		);
		set({ providers, error: null });
		await persist(get);
	},
	setRecords: async (id, records) => {
		set((state) => ({
			recordsByProvider: {
				...state.recordsByProvider,
				[id]: records.map((record) => ({ ...record })),
			},
			error: null,
		}));
		await persist(get);
	},
	refreshProvider: async (id) => {
		if (!get().loaded) await get().load();
		const provider = get().providers.find((item) => item.id === id);
		if (!provider?.enabled) return [];
		set((state) => ({
			loadingProviderIds: state.loadingProviderIds.includes(id)
				? state.loadingProviderIds
				: [...state.loadingProviderIds, id],
		}));
		try {
			const result = await fetchModelMetadata(provider);
			await get().setRecords(id, result.records);
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
		if (!get().loaded) await get().load();
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
			if (record.id.endsWith(`/${requestedId}`)) {
				suffixMatches.set(record.id, suffixMatches.get(record.id) ?? record);
			}
		}
	}

	return suffixMatches.size === 1
		? suffixMatches.values().next().value
		: undefined;
}

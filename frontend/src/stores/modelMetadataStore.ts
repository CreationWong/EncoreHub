import { create } from "zustand";
import {
	DEFAULT_MODEL_METADATA_PROVIDER,
	type ModelMetadataMapping,
	type ModelMetadataProvider,
} from "../services/modelMetadata";

const STORAGE_KEY = "encorehub-model-metadata-providers";

interface ModelMetadataState {
	providers: ModelMetadataProvider[];
	upsert: (provider: ModelMetadataProvider) => void;
	remove: (id: string) => void;
	setEnabled: (id: string, enabled: boolean) => void;
	setMapping: (id: string, mapping: ModelMetadataMapping) => void;
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
	upsert: (provider) => {
		const next = get().providers.filter((item) => item.id !== provider.id);
		const providers = [...next, cloneProvider(provider)];
		set({ providers });
		persistProviders(providers);
	},
	remove: (id) => {
		const providers = get().providers.filter((item) => item.id !== id);
		set({ providers });
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
}));

import { create } from "zustand";
import { type ProviderProfile, providersApi } from "../services/providers";

interface ProviderState {
	profiles: ProviderProfile[];
	loading: boolean;
	loaded: boolean;
	error: string | null;

	/** Fetch the profile list from the gateway. Safe to call repeatedly. */
	load: () => Promise<void>;
	/**
	 * Persist a full replacement list, then adopt the gateway's canonical
	 * response. Throws on validation/persistence failure so callers can surface
	 * the message.
	 */
	save: (next: ProviderProfile[]) => Promise<void>;
	/** Insert or replace a single profile by id, then persist. */
	upsert: (profile: ProviderProfile) => Promise<void>;
	/** Remove a profile by id, then persist. Builtins are rejected by gateway. */
	remove: (id: string) => Promise<void>;
}

export const useProviderStore = create<ProviderState>((set, get) => ({
	profiles: [],
	loading: false,
	loaded: false,
	error: null,

	load: async () => {
		set({ loading: true, error: null });
		try {
			const res = await providersApi.list();
			set({ profiles: res.providers, loaded: true, loading: false });
		} catch (e) {
			set({
				loading: false,
				error: e instanceof Error ? e.message : "Failed to load providers",
			});
		}
	},

	save: async (next: ProviderProfile[]) => {
		const res = await providersApi.update(next);
		set({ profiles: res.providers, loaded: true, error: null });
	},

	upsert: async (profile: ProviderProfile) => {
		const current = get().profiles;
		const idx = current.findIndex((p) => p.id === profile.id);
		const next =
			idx >= 0
				? current.map((p) => (p.id === profile.id ? profile : p))
				: [...current, profile];
		await get().save(next);
	},

	remove: async (id: string) => {
		const next = get().profiles.filter((p) => p.id !== id);
		await get().save(next);
	},
}));

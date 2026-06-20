import { create } from "zustand";
import { secretsApi } from "../services/secrets";

interface SecretsState {
	/** Whether the secrets DB is encrypted. */
	encrypted: boolean;
	/** Whether the session is currently unlocked (master key cached in engine). */
	unlocked: boolean;
	loaded: boolean;
	loading: boolean;

	/** Refresh encryption/unlock state from the engine. */
	refresh: () => Promise<void>;
	/** Enable encryption with a new master password; seeds existing session keys. */
	enable: (password: string, keys?: Record<string, string>) => Promise<void>;
	/** Disable encryption (decrypts keys back to plaintext). */
	disable: (password: string) => Promise<void>;
	/** Unlock for this session. Throws on wrong password. */
	unlock: (password: string) => Promise<void>;
	/** Re-lock (drop cached master key). */
	lock: () => Promise<void>;
	/** Change the master password, re-encrypting all keys. */
	resetPassword: (oldPassword: string, newPassword: string) => Promise<void>;
	/** Wipe all keys + crypto metadata (forgotten-password recovery). */
	clear: () => Promise<void>;
}

export const useSecretsStore = create<SecretsState>((set, get) => ({
	encrypted: false,
	unlocked: false,
	loaded: false,
	loading: false,

	refresh: async () => {
		set({ loading: true });
		try {
			const s = await secretsApi.status();
			set({
				encrypted: s.encrypted,
				unlocked: s.unlocked,
				loaded: true,
				loading: false,
			});
		} catch {
			// Engine not ready / unreachable — leave defaults, don't block UI.
			set({ loading: false });
		}
	},

	enable: async (password, keys = {}) => {
		await secretsApi.enable(password, keys);
		await get().refresh();
	},

	disable: async (password) => {
		await secretsApi.disable(password);
		await get().refresh();
	},

	unlock: async (password) => {
		await secretsApi.unlock(password);
		await get().refresh();
	},

	lock: async () => {
		await secretsApi.lock();
		await get().refresh();
	},

	resetPassword: async (oldPassword, newPassword) => {
		await secretsApi.resetPassword(oldPassword, newPassword);
		await get().refresh();
	},

	clear: async () => {
		await secretsApi.clear();
		await get().refresh();
	},
}));

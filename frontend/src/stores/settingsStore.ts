import { create } from "zustand";
import { secretsApi } from "../services/secrets";

export type Theme = "system" | "dark" | "light";
export type SidebarMode = "characters" | "conversations";
export type SettingsTab =
	| "providers"
	| "skills"
	| "knowledge"
	| "memories"
	| "appearance"
	| "security"
	| "developer";

export type SearchProvider = "duckduckgo" | "bing" | "google";

interface SettingsState {
	theme: Theme;
	provider: string;
	model: string;
	apiKeys: Record<string, string>;
	sidebarOpen: boolean;
	sidebarWidth: number;
	sidebarMode: SidebarMode;
	settingsOpen: boolean;
	settingsTab: SettingsTab;
	devMode: boolean;
	searchEnabled: boolean;
	searchProvider: SearchProvider;

	setTheme: (theme: Theme) => void;
	setProvider: (provider: string, model?: string) => void;
	setModel: (model: string) => void;
	setApiKey: (provider: string, key: string) => void;
	clearApiKey: (provider: string) => Promise<void>;
	/** Pull saved API keys from the engine (call once on startup). */
	loadKeys: () => Promise<void>;
	toggleSidebar: () => void;
	setSidebarWidth: (width: number) => void;
	setSidebarMode: (mode: SidebarMode) => void;
	openSettings: (tab?: SettingsTab) => void;
	closeSettings: () => void;
	setDevMode: (on: boolean) => void;
	setSearchEnabled: (on: boolean) => void;
	setSearchProvider: (p: SearchProvider) => void;
}

function getSystemTheme(): "dark" | "light" {
	if (typeof window === "undefined") return "dark";
	return window.matchMedia("(prefers-color-scheme: dark)").matches
		? "dark"
		: "light";
}

function applyTheme(theme: Theme) {
	const root = document.documentElement;
	const isDark =
		theme === "dark" || (theme === "system" && getSystemTheme() === "dark");
	root.classList.toggle("dark", isDark);
}

// Sidebar width is drag-resizable and persisted. Clamp to a sane range so a
// stray drag can't make it unusably narrow or eat the whole window.
export const SIDEBAR_MIN_WIDTH = 260;
export const SIDEBAR_MAX_WIDTH = 380;
const SIDEBAR_DEFAULT_WIDTH = 300;

function clampSidebarWidth(w: number): number {
	if (Number.isNaN(w)) return SIDEBAR_DEFAULT_WIDTH;
	return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, w));
}

function loadSidebarWidth(): number {
	if (typeof window === "undefined") return SIDEBAR_DEFAULT_WIDTH;
	const raw = localStorage.getItem("encorehub-sidebar-width");
	return raw
		? clampSidebarWidth(Number.parseInt(raw, 10))
		: SIDEBAR_DEFAULT_WIDTH;
}

function loadSidebarMode(): SidebarMode {
	if (typeof window === "undefined") return "conversations";
	return localStorage.getItem("encorehub-sidebar-mode") === "characters"
		? "characters"
		: "conversations";
}

// API keys are always persisted to the engine DB (plaintext or encrypted
// depending on the Security setting). On startup we pull them back via the
// secrets API. The Zustand `apiKeys` field is a fast in-memory cache — the
// engine is the source of truth.
//
// The engine may still be warming up when this is first called (the gateway
// health check only confirms the gateway is up; the engine in-process axum
// server starts on a separate tokio task). Retry with backoff so a transient
// 502 doesn't silently leave keys empty for the whole session.
async function loadKeysFromEngine(): Promise<Record<string, string>> {
	for (let attempt = 0; attempt < 5; attempt++) {
		try {
			const { provider_ids } = await secretsApi.list();
			const keys: Record<string, string> = {};
			for (const pid of provider_ids) {
				try {
					const { key } = await secretsApi.getKey(pid);
					keys[pid] = key;
				} catch {
					// 423 Locked or 404 — skip silently, this provider's key isn't
					// available until the user unlocks the vault.
				}
			}
			return keys;
		} catch {
			// Engine not reachable yet — wait and retry.
			if (attempt < 4) {
				await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
			}
		}
	}
	return {};
}

/**
 * One-shot migration: old localStorage keys ("encorehub-api-keys") → engine
 * secrets DB. Before the secrets API was wired, a hidden localStorage flag
 * (`encorehub-persist-keys === "1"`) opted devs into insecure persistence.
 * Migrate those keys now so they aren't silently lost.
 */
function migrateLegacyKeys(): Record<string, string> {
	if (typeof window === "undefined") return {};
	try {
		const raw = localStorage.getItem("encorehub-api-keys");
		if (!raw) return {};
		const parsed = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null) return {};
		const keys: Record<string, string> = {};
		for (const [k, v] of Object.entries(parsed)) {
			if (typeof v === "string" && v.length > 0) keys[k] = v;
		}
		// Remove from localStorage once migrated.
		localStorage.removeItem("encorehub-api-keys");
		return keys;
	} catch {
		return {};
	}
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
	theme:
		(typeof window !== "undefined"
			? (localStorage.getItem("encorehub-theme") as Theme | null)
			: null) ?? "dark",
	provider:
		typeof window !== "undefined"
			? (localStorage.getItem("encorehub-provider") ?? "")
			: "",
	model:
		typeof window !== "undefined"
			? (localStorage.getItem("encorehub-model") ?? "")
			: "",
	// Keys start empty; loadKeys() populates them from the engine once it's ready.
	apiKeys: {},
	sidebarOpen: true,
	sidebarWidth: loadSidebarWidth(),
	sidebarMode: loadSidebarMode(),
	settingsOpen: false,
	settingsTab: "providers",
	devMode:
		typeof window !== "undefined"
			? localStorage.getItem("encorehub-dev-mode") === "1"
			: false,
	searchEnabled:
		typeof window !== "undefined"
			? localStorage.getItem("encorehub-search-enabled") === "1"
			: false,
	searchProvider:
		(typeof window !== "undefined"
			? (localStorage.getItem(
					"encorehub-search-provider",
				) as SearchProvider | null)
			: null) ?? "duckduckgo",

	setTheme: (theme: Theme) => {
		set({ theme });
		applyTheme(theme);
		try {
			localStorage.setItem("encorehub-theme", theme);
		} catch {
			/* ignore */
		}
	},

	setProvider: (provider: string, model?: string) => {
		const next = { provider, model: model ?? get().model };
		set(next);
		try {
			localStorage.setItem("encorehub-provider", provider);
			if (model) localStorage.setItem("encorehub-model", model);
		} catch {
			/* ignore */
		}
	},

	setModel: (model: string) => {
		set({ model });
		try {
			localStorage.setItem("encorehub-model", model);
		} catch {
			/* ignore */
		}
	},

	setApiKey: (provider: string, key: string) => {
		// Update the in-memory cache immediately so the UI is responsive.
		set((s) => {
			const next = { ...s.apiKeys, [provider]: key };
			return { apiKeys: next };
		});
		// Persist to engine DB in the background. If the engine is unreachable
		// or the vault is locked, the key lives in memory for this session.
		secretsApi.putKey(provider, key).catch(() => {
			/* key stays in session memory; no toast to avoid noise */
		});
	},

	clearApiKey: async (provider: string) => {
		set((s) => {
			const next = { ...s.apiKeys };
			delete next[provider];
			return { apiKeys: next };
		});
		try {
			await secretsApi.deleteKey(provider);
		} catch {
			/* engine unreachable — key is already cleared from memory */
		}
	},

	loadKeys: async () => {
		const keys = await loadKeysFromEngine();

		// If engine had no keys, try migrating from old localStorage store.
		const migrated = Object.keys(keys).length === 0 ? migrateLegacyKeys() : {};
		for (const [pid, key] of Object.entries(migrated)) {
			keys[pid] = key;
			// Push migrated keys to the engine so they're persisted going forward.
			secretsApi.putKey(pid, key).catch(() => {});
		}

		set((s) => ({
			apiKeys: { ...keys, ...s.apiKeys }, // merge: engine keys + session keys
		}));
	},

	toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
	setSidebarWidth: (width: number) => {
		const clamped = clampSidebarWidth(width);
		set({ sidebarWidth: clamped });
		try {
			localStorage.setItem("encorehub-sidebar-width", String(clamped));
		} catch {
			/* ignore */
		}
	},
	setSidebarMode: (mode: SidebarMode) => {
		set({ sidebarMode: mode });
		try {
			localStorage.setItem("encorehub-sidebar-mode", mode);
		} catch {
			/* ignore */
		}
	},
	openSettings: (tab?: SettingsTab) =>
		set({ settingsOpen: true, settingsTab: tab ?? get().settingsTab }),
	closeSettings: () => set({ settingsOpen: false }),

	setDevMode: (on: boolean) => {
		set({ devMode: on });
		try {
			localStorage.setItem("encorehub-dev-mode", on ? "1" : "0");
		} catch {
			/* ignore */
		}
	},

	setSearchEnabled: (on: boolean) => {
		set({ searchEnabled: on });
		try {
			localStorage.setItem("encorehub-search-enabled", on ? "1" : "0");
		} catch {
			/* ignore */
		}
	},

	setSearchProvider: (p: SearchProvider) => {
		set({ searchProvider: p });
		try {
			localStorage.setItem("encorehub-search-provider", p);
		} catch {
			/* ignore */
		}
	},
}));

if (typeof window !== "undefined") {
	const saved = localStorage.getItem("encorehub-theme") as Theme | null;
	applyTheme(saved || "dark");
}

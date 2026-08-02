import { create } from "zustand";
import { secretsApi } from "../services/secrets";
import {
	type CustomSearchSettings,
	DEFAULT_WEB_SEARCH_SETTINGS,
	type SearchProvider,
	type WebSearchSettings,
	normalizeWebSearchSettings,
	webSearchApi,
} from "../services/webSearch";
import { useWorkspaceStore } from "./workspaceStore";

export type { SearchProvider } from "../services/webSearch";

export type Theme = "system" | "dark" | "light";
export type SidebarMode = "characters" | "conversations";
export type GlobalContextMenuItemId = "new-chat" | "settings";

export interface GlobalContextMenuItemPreference {
	id: GlobalContextMenuItemId;
	visible: boolean;
}

export const DEFAULT_GLOBAL_CONTEXT_MENU_ITEMS: readonly GlobalContextMenuItemPreference[] =
	[
		{ id: "new-chat", visible: true },
		{ id: "settings", visible: true },
	];
export type SettingsTab =
	| "providers"
	| "model-metadata"
	| "skills"
	| "knowledge"
	| "memories"
	| "search"
	| "appearance"
	| "context-menu"
	| "security"
	| "about"
	| "developer"
	| "processes"
	| "logs"
	| "database"
	| "usage";

export const DEVELOPER_SETTINGS_TABS: readonly SettingsTab[] = [
	"developer",
	"processes",
	"logs",
	"database",
];

export function isDeveloperSettingsTab(tab: SettingsTab): boolean {
	return DEVELOPER_SETTINGS_TABS.includes(tab);
}

interface SettingsState {
	theme: Theme;
	provider: string;
	model: string;
	apiKeys: Record<string, string>;
	sidebarOpen: boolean;
	sidebarWidth: number;
	sidebarMode: SidebarMode;
	settingsTab: SettingsTab;
	devMode: boolean;
	fullCommunicationLogs: boolean;
	trafficLightWindowControls: boolean;
	globalContextMenuEnabled: boolean;
	globalContextMenuItems: GlobalContextMenuItemPreference[];
	searchEnabled: boolean;
	searchProvider: SearchProvider;
	searchMaxResults: number;
	googleSearchEngineId: string;
	customSearchSettings: CustomSearchSettings;
	searchSettingsLoaded: boolean;
	deepThinking: boolean;

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
	setFullCommunicationLogs: (on: boolean) => void;
	setTrafficLightWindowControls: (on: boolean) => void;
	setGlobalContextMenuEnabled: (on: boolean) => void;
	setGlobalContextMenuItemVisible: (
		id: GlobalContextMenuItemId,
		visible: boolean,
	) => void;
	moveGlobalContextMenuItem: (
		id: GlobalContextMenuItemId,
		targetId: GlobalContextMenuItemId,
	) => void;
	setSearchEnabled: (on: boolean) => void;
	setSearchProvider: (p: SearchProvider) => void;
	loadWebSearchSettings: () => Promise<void>;
	saveWebSearchSettings: (settings: WebSearchSettings) => Promise<void>;
	setDeepThinking: (on: boolean) => void;
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

const GLOBAL_CONTEXT_MENU_ENABLED_KEY = "encorehub-global-context-menu-enabled";
const GLOBAL_CONTEXT_MENU_ITEMS_KEY = "encorehub-global-context-menu-items";

function defaultGlobalContextMenuItems(): GlobalContextMenuItemPreference[] {
	return DEFAULT_GLOBAL_CONTEXT_MENU_ITEMS.map((item) => ({ ...item }));
}

function normalizeGlobalContextMenuItems(
	value: unknown,
): GlobalContextMenuItemPreference[] {
	if (!Array.isArray(value)) return defaultGlobalContextMenuItems();
	const defaults = new Map(
		DEFAULT_GLOBAL_CONTEXT_MENU_ITEMS.map((item) => [item.id, item]),
	);
	const seen = new Set<GlobalContextMenuItemId>();
	const normalized: GlobalContextMenuItemPreference[] = [];
	for (const candidate of value) {
		if (!candidate || typeof candidate !== "object") continue;
		const id = (candidate as { id?: unknown }).id;
		if (
			typeof id !== "string" ||
			!defaults.has(id as GlobalContextMenuItemId)
		) {
			continue;
		}
		const typedId = id as GlobalContextMenuItemId;
		if (seen.has(typedId)) continue;
		seen.add(typedId);
		normalized.push({
			id: typedId,
			visible:
				typeof (candidate as { visible?: unknown }).visible === "boolean"
					? (candidate as { visible: boolean }).visible
					: (defaults.get(typedId)?.visible ?? true),
		});
	}
	for (const item of DEFAULT_GLOBAL_CONTEXT_MENU_ITEMS) {
		if (!seen.has(item.id)) normalized.push({ ...item });
	}
	return normalized;
}

function loadGlobalContextMenuItems(): GlobalContextMenuItemPreference[] {
	if (typeof window === "undefined") return defaultGlobalContextMenuItems();
	try {
		const raw = localStorage.getItem(GLOBAL_CONTEXT_MENU_ITEMS_KEY);
		return raw
			? normalizeGlobalContextMenuItems(JSON.parse(raw))
			: defaultGlobalContextMenuItems();
	} catch {
		return defaultGlobalContextMenuItems();
	}
}

function persistGlobalContextMenuItems(
	items: GlobalContextMenuItemPreference[],
): void {
	try {
		localStorage.setItem(GLOBAL_CONTEXT_MENU_ITEMS_KEY, JSON.stringify(items));
	} catch {
		/* ignore */
	}
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
				if (pid.startsWith("system.search.")) continue;
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
	settingsTab: "providers",
	devMode:
		typeof window !== "undefined"
			? localStorage.getItem("encorehub-dev-mode") === "1"
			: false,
	fullCommunicationLogs:
		typeof window !== "undefined"
			? localStorage.getItem("encorehub-dev-mode") === "1" &&
				localStorage.getItem("encorehub-full-communication-logs") === "1"
			: false,
	trafficLightWindowControls:
		typeof window !== "undefined"
			? localStorage.getItem("encorehub-traffic-light-window-controls") === "1"
			: false,
	globalContextMenuEnabled:
		typeof window !== "undefined"
			? localStorage.getItem(GLOBAL_CONTEXT_MENU_ENABLED_KEY) !== "0"
			: true,
	globalContextMenuItems: loadGlobalContextMenuItems(),
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
	searchMaxResults: DEFAULT_WEB_SEARCH_SETTINGS.max_results,
	googleSearchEngineId: DEFAULT_WEB_SEARCH_SETTINGS.google_cse_id,
	customSearchSettings: { ...DEFAULT_WEB_SEARCH_SETTINGS.custom },
	searchSettingsLoaded: false,
	deepThinking:
		typeof window !== "undefined"
			? localStorage.getItem("encorehub-deep-thinking") === "1"
			: false,

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
	openSettings: (tab?: SettingsTab) => {
		set({ settingsTab: tab ?? get().settingsTab });
		useWorkspaceStore.getState().openTab("settings");
	},
	closeSettings: () => useWorkspaceStore.getState().closeTab("settings"),

	setDevMode: (on: boolean) => {
		set((state) => ({
			devMode: on,
			fullCommunicationLogs: on ? state.fullCommunicationLogs : false,
			settingsTab:
				!on && isDeveloperSettingsTab(state.settingsTab)
					? "about"
					: state.settingsTab,
		}));
		try {
			localStorage.setItem("encorehub-dev-mode", on ? "1" : "0");
			if (!on) {
				localStorage.setItem("encorehub-full-communication-logs", "0");
			}
		} catch {
			/* ignore */
		}
	},

	setFullCommunicationLogs: (on: boolean) => {
		const enabled = on && get().devMode;
		set({ fullCommunicationLogs: enabled });
		try {
			localStorage.setItem(
				"encorehub-full-communication-logs",
				enabled ? "1" : "0",
			);
		} catch {
			/* ignore */
		}
	},

	setTrafficLightWindowControls: (on: boolean) => {
		set({ trafficLightWindowControls: on });
		try {
			localStorage.setItem(
				"encorehub-traffic-light-window-controls",
				on ? "1" : "0",
			);
		} catch {
			/* ignore */
		}
	},

	setGlobalContextMenuEnabled: (on: boolean) => {
		set({ globalContextMenuEnabled: on });
		try {
			localStorage.setItem(GLOBAL_CONTEXT_MENU_ENABLED_KEY, on ? "1" : "0");
		} catch {
			/* ignore */
		}
	},

	setGlobalContextMenuItemVisible: (id, visible) => {
		const items = get().globalContextMenuItems.map((item) =>
			item.id === id ? { ...item, visible } : item,
		);
		set({ globalContextMenuItems: items });
		persistGlobalContextMenuItems(items);
	},

	moveGlobalContextMenuItem: (id, targetId) => {
		if (id === targetId) return;
		const current = get().globalContextMenuItems;
		const sourceIndex = current.findIndex((item) => item.id === id);
		const targetIndex = current.findIndex((item) => item.id === targetId);
		if (sourceIndex < 0 || targetIndex < 0) return;
		const items = [...current];
		const [moving] = items.splice(sourceIndex, 1);
		if (!moving) return;
		items.splice(targetIndex, 0, moving);
		set({ globalContextMenuItems: items });
		persistGlobalContextMenuItems(items);
	},

	setSearchEnabled: (on: boolean) => {
		set({ searchEnabled: on });
		try {
			localStorage.setItem("encorehub-search-enabled", on ? "1" : "0");
		} catch {
			/* ignore */
		}
		const state = get();
		void webSearchApi
			.saveSettings(webSearchSettingsFromState(state))
			.catch(() => undefined);
	},

	setSearchProvider: (p: SearchProvider) => {
		set({ searchProvider: p });
		try {
			localStorage.setItem("encorehub-search-provider", p);
		} catch {
			/* ignore */
		}
		const state = get();
		void webSearchApi
			.saveSettings(webSearchSettingsFromState(state))
			.catch(() => undefined);
	},

	loadWebSearchSettings: async () => {
		const state = get();
		const fallback = webSearchSettingsFromState(state);
		try {
			const stored = await webSearchApi.getSettings();
			const settings = normalizeWebSearchSettings(stored, fallback);
			set(webSearchState(settings));
			persistSearchSelection(settings);
			if (stored == null) {
				await webSearchApi.saveSettings(settings);
			}
		} catch {
			set({ searchSettingsLoaded: true });
		}
	},

	saveWebSearchSettings: async (settings: WebSearchSettings) => {
		const normalized = normalizeWebSearchSettings(settings);
		await webSearchApi.saveSettings(normalized);
		set(webSearchState(normalized));
		persistSearchSelection(normalized);
	},

	setDeepThinking: (on: boolean) => {
		set({ deepThinking: on });
		try {
			localStorage.setItem("encorehub-deep-thinking", on ? "1" : "0");
		} catch {
			/* ignore */
		}
	},
}));

function webSearchSettingsFromState(state: SettingsState): WebSearchSettings {
	return {
		enabled: state.searchEnabled,
		provider: state.searchProvider,
		max_results: state.searchMaxResults,
		google_cse_id: state.googleSearchEngineId,
		custom: { ...state.customSearchSettings },
	};
}

function webSearchState(settings: WebSearchSettings) {
	return {
		searchEnabled: settings.enabled,
		searchProvider: settings.provider,
		searchMaxResults: settings.max_results,
		googleSearchEngineId: settings.google_cse_id,
		customSearchSettings: { ...settings.custom },
		searchSettingsLoaded: true,
	};
}

function persistSearchSelection(settings: WebSearchSettings) {
	try {
		localStorage.setItem(
			"encorehub-search-enabled",
			settings.enabled ? "1" : "0",
		);
		localStorage.setItem("encorehub-search-provider", settings.provider);
	} catch {
		/* ignore */
	}
}

if (typeof window !== "undefined") {
	const saved = localStorage.getItem("encorehub-theme") as Theme | null;
	applyTheme(saved || "dark");
}

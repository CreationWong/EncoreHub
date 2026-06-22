import { create } from "zustand";

export type Theme = "system" | "dark" | "light";
export type SettingsTab =
	| "providers"
	| "skills"
	| "knowledge"
	| "memories"
	| "appearance"
	| "security"
	| "developer";

interface SettingsState {
	theme: Theme;
	provider: string;
	model: string;
	apiKeys: Record<string, string>;
	sidebarOpen: boolean;
	sidebarWidth: number;
	settingsOpen: boolean;
	settingsTab: SettingsTab;
	devMode: boolean;

	setTheme: (theme: Theme) => void;
	setProvider: (provider: string, model?: string) => void;
	setModel: (model: string) => void;
	setApiKey: (provider: string, key: string) => void;
	clearApiKey: (provider: string) => void;
	toggleSidebar: () => void;
	setSidebarWidth: (width: number) => void;
	openSettings: (tab?: SettingsTab) => void;
	closeSettings: () => void;
	setDevMode: (on: boolean) => void;
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

const KEY_STORAGE = "encorehub-api-keys";

// Sidebar width is drag-resizable and persisted. Clamp to a sane range so a
// stray drag can't make it unusably narrow or eat the whole window.
export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 480;
const SIDEBAR_DEFAULT_WIDTH = 256; // matches the old fixed w-64

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

// API keys are intentionally session-only by default. localStorage is exposed
// to any XSS in our renderer; for true persistence we should integrate
// Tauri's stronghold/keyring plugin. Set localStorage.setItem(
// "encorehub-persist-keys", "1") in DevTools to opt in for desktop dev.
function persistKeysAllowed(): boolean {
	if (typeof window === "undefined") return false;
	try {
		return localStorage.getItem("encorehub-persist-keys") === "1";
	} catch {
		return false;
	}
}

function loadKeys(): Record<string, string> {
	if (!persistKeysAllowed()) return {};
	try {
		const raw = localStorage.getItem(KEY_STORAGE);
		return raw ? JSON.parse(raw) : {};
	} catch {
		return {};
	}
}

function saveKeys(keys: Record<string, string>) {
	if (!persistKeysAllowed()) return;
	try {
		localStorage.setItem(KEY_STORAGE, JSON.stringify(keys));
	} catch {
		/* ignore quota / privacy mode */
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
	apiKeys: loadKeys(),
	sidebarOpen: true,
	sidebarWidth: loadSidebarWidth(),
	settingsOpen: false,
	settingsTab: "providers",
	devMode:
		typeof window !== "undefined"
			? localStorage.getItem("encorehub-dev-mode") === "1"
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
		set((s) => {
			const next = { ...s.apiKeys, [provider]: key };
			saveKeys(next);
			return { apiKeys: next };
		});
	},

	clearApiKey: (provider: string) => {
		set((s) => {
			const next = { ...s.apiKeys };
			delete next[provider];
			saveKeys(next);
			return { apiKeys: next };
		});
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
}));

if (typeof window !== "undefined") {
	const saved = localStorage.getItem("encorehub-theme") as Theme | null;
	applyTheme(saved || "dark");
}

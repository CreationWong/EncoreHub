import { create } from "zustand";

export type Theme = "system" | "dark" | "light";

interface SettingsState {
  theme: Theme;
  provider: string;
  model: string;
  apiKeys: Record<string, string>;
  sidebarOpen: boolean;

  setTheme: (theme: Theme) => void;
  setProvider: (provider: string, model?: string) => void;
  setApiKey: (provider: string, key: string) => void;
  toggleSidebar: () => void;
}

function getSystemTheme(): "dark" | "light" {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  const isDark = theme === "dark" || (theme === "system" && getSystemTheme() === "dark");
  root.classList.toggle("dark", isDark);
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  theme: "dark",
  provider: "",
  model: "",
  apiKeys: {},
  sidebarOpen: true,

  setTheme: (theme: Theme) => {
    set({ theme });
    applyTheme(theme);
    localStorage.setItem("encorehub-theme", theme);
  },

  setProvider: (provider: string, model?: string) => {
    set({ provider, model: model || get().model });
    localStorage.setItem("encorehub-provider", provider);
    if (model) localStorage.setItem("encorehub-model", model);
  },

  setApiKey: (provider: string, key: string) => {
    set((s) => ({
      apiKeys: { ...s.apiKeys, [provider]: key },
    }));
  },

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
}));

// Initialize theme on load
if (typeof window !== "undefined") {
  const saved = localStorage.getItem("encorehub-theme") as Theme | null;
  applyTheme(saved || "dark");
}

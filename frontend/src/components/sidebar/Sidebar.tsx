import { Moon, PanelLeft, Settings, Sun } from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import ConversationList from "./ConversationList";
import ProviderSwitcher from "./ProviderSwitcher";

// Cycle dark <-> light. We deliberately don't include "system" here —
// it's behind Settings if the user wants OS-driven theming.
function nextTheme(current: string): "dark" | "light" {
	return current === "dark" ? "light" : "dark";
}

export default function Sidebar() {
	const sidebarOpen = useSettingsStore((s) => s.sidebarOpen);
	const toggleSidebar = useSettingsStore((s) => s.toggleSidebar);
	const openSettings = useSettingsStore((s) => s.openSettings);
	const theme = useSettingsStore((s) => s.theme);
	const setTheme = useSettingsStore((s) => s.setTheme);

	const isDark =
		theme === "dark" ||
		(theme === "system" &&
			typeof window !== "undefined" &&
			window.matchMedia?.("(prefers-color-scheme: dark)").matches);
	const ThemeIcon = isDark ? Sun : Moon;
	const themeLabel = isDark ? "Switch to light" : "Switch to dark";

	if (!sidebarOpen) {
		return (
			<aside className="flex w-12 shrink-0 flex-col items-center gap-2 border-r border-border bg-surface-alt py-3">
				<button
					type="button"
					onClick={toggleSidebar}
					className="rounded-lg p-2 text-text-muted hover:bg-surface-hover hover:text-text-primary"
					aria-label="Open sidebar"
					title="Open sidebar"
				>
					<PanelLeft className="h-4 w-4" />
				</button>
				<div className="flex-1" />
				<button
					type="button"
					onClick={() => setTheme(nextTheme(theme))}
					className="rounded-lg p-2 text-text-muted hover:bg-surface-hover hover:text-text-primary"
					aria-label={themeLabel}
					title={themeLabel}
				>
					<ThemeIcon className="h-4 w-4" />
				</button>
				<button
					type="button"
					onClick={() => openSettings()}
					className="rounded-lg p-2 text-text-muted hover:bg-surface-hover hover:text-text-primary"
					aria-label="Settings"
					title="Settings (Ctrl+,)"
				>
					<Settings className="h-4 w-4" />
				</button>
			</aside>
		);
	}

	return (
		<aside className="flex w-64 shrink-0 flex-col border-r border-border bg-surface-alt">
			<ConversationList />
			<ProviderSwitcher />
			<div className="flex items-stretch border-t border-border">
				<button
					type="button"
					onClick={() => openSettings()}
					className="flex flex-1 items-center gap-2 px-4 py-2.5 text-xs text-text-secondary hover:bg-surface-hover"
					title="Settings (Ctrl+,)"
				>
					<Settings className="h-3.5 w-3.5" />
					<span>Settings</span>
					<kbd className="ml-auto rounded bg-surface px-1.5 py-0.5 text-[10px] text-text-muted">
						Ctrl ,
					</kbd>
				</button>
				<button
					type="button"
					onClick={() => setTheme(nextTheme(theme))}
					className="border-l border-border px-3 text-text-muted hover:bg-surface-hover hover:text-text-primary"
					aria-label={themeLabel}
					title={themeLabel}
				>
					<ThemeIcon className="h-3.5 w-3.5" />
				</button>
			</div>
		</aside>
	);
}

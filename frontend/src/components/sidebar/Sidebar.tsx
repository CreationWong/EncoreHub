import { PanelLeft, Settings } from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import ConversationList from "./ConversationList";
import ProviderSwitcher from "./ProviderSwitcher";

export default function Sidebar() {
	const sidebarOpen = useSettingsStore((s) => s.sidebarOpen);
	const toggleSidebar = useSettingsStore((s) => s.toggleSidebar);
	const openSettings = useSettingsStore((s) => s.openSettings);

	if (!sidebarOpen) {
		return (
			<aside className="flex w-12 shrink-0 flex-col items-center gap-2 border-r border-border bg-surface-alt py-3">
				<button
					type="button"
					onClick={toggleSidebar}
					className="rounded-lg p-2 text-text-muted hover:bg-surface-hover hover:text-text-primary"
					title="Open sidebar"
				>
					<PanelLeft className="h-4 w-4" />
				</button>
				<div className="flex-1" />
				<button
					type="button"
					onClick={() => openSettings()}
					className="rounded-lg p-2 text-text-muted hover:bg-surface-hover hover:text-text-primary"
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
			<button
				type="button"
				onClick={() => openSettings()}
				className="flex items-center gap-2 border-t border-border px-4 py-2.5 text-xs text-text-secondary hover:bg-surface-hover"
				title="Settings (Ctrl+,)"
			>
				<Settings className="h-3.5 w-3.5" />
				<span>Settings</span>
				<kbd className="ml-auto rounded bg-surface px-1.5 py-0.5 text-[10px] text-text-muted">
					Ctrl ,
				</kbd>
			</button>
		</aside>
	);
}

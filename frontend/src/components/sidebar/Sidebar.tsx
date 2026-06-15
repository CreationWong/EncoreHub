import { useSettingsStore } from "../../stores/settingsStore";
import ConversationList from "./ConversationList";
import ProviderSwitcher from "./ProviderSwitcher";
import { Settings } from "lucide-react";

export default function Sidebar() {
  const sidebarOpen = useSettingsStore((s) => s.sidebarOpen);
  const toggleSidebar = useSettingsStore((s) => s.toggleSidebar);

  if (!sidebarOpen) {
    return (
      <aside className="w-12 border-r border-border flex flex-col items-center py-3 gap-3 bg-surface-alt shrink-0">
        <button
          type="button"
          onClick={toggleSidebar}
          className="p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-hover"
          title="Open sidebar"
        >
          <Settings className="h-4 w-4" />
        </button>
      </aside>
    );
  }

  return (
    <aside className="w-64 border-r border-border flex flex-col bg-surface-alt shrink-0">
      <ConversationList />
      <ProviderSwitcher />
    </aside>
  );
}

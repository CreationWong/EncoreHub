import { useConversationStore } from "../../stores/conversationStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { MessageSquare, Trash2, Plus, PanelLeftClose, PanelLeft } from "lucide-react";
import { useEffect } from "react";

export default function ConversationList() {
  const conversations = useConversationStore((s) => s.conversations);
  const activeId = useConversationStore((s) => s.activeId);
  const loadList = useConversationStore((s) => s.loadList);
  const selectConversation = useConversationStore((s) => s.selectConversation);
  const newConversation = useConversationStore((s) => s.newConversation);
  const deleteConversation = useConversationStore((s) => s.deleteConversation);
  const sidebarOpen = useSettingsStore((s) => s.sidebarOpen);
  const toggleSidebar = useSettingsStore((s) => s.toggleSidebar);

  useEffect(() => {
    loadList();
  }, [loadList]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-border">
        <button
          type="button"
          onClick={newConversation}
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-text-primary hover:bg-surface-hover transition-colors flex-1"
        >
          <Plus className="h-4 w-4" />
          <span>New Chat</span>
        </button>
        <button
          type="button"
          onClick={toggleSidebar}
          className="ml-1 p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
        >
          {sidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {conversations.length === 0 && (
          <p className="text-xs text-text-muted text-center py-8">
            No conversations yet.
            <br />
            Click "New Chat" to start.
          </p>
        )}

        {conversations.map((conv) => (
          <div
            key={conv.id}
            className={`group flex items-center rounded-lg px-3 py-2 cursor-pointer transition-colors ${
              activeId === conv.id
                ? "bg-accent/10 text-accent"
                : "text-text-secondary hover:bg-surface-hover"
            }`}
          >
            <button
              type="button"
              className="flex items-center gap-2 min-w-0 flex-1 text-left"
              onClick={() => selectConversation(conv.id)}
            >
              <MessageSquare className="h-4 w-4 shrink-0" />
              <span className="text-sm truncate">{conv.title}</span>
            </button>
            <button
              type="button"
              className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-surface-hover text-text-muted hover:text-red-400 transition-all"
              onClick={(e) => {
                e.stopPropagation();
                deleteConversation(conv.id);
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

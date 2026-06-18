import {
	MessageSquare,
	PanelLeft,
	PanelLeftClose,
	Plus,
	Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useConversationStore } from "../../stores/conversationStore";
import { useSettingsStore } from "../../stores/settingsStore";

export default function ConversationList() {
	const conversations = useConversationStore((s) => s.conversations);
	const activeId = useConversationStore((s) => s.activeId);
	const loadList = useConversationStore((s) => s.loadList);
	const selectConversation = useConversationStore((s) => s.selectConversation);
	const newConversation = useConversationStore((s) => s.newConversation);
	const deleteConversation = useConversationStore((s) => s.deleteConversation);
	const renameConversation = useConversationStore((s) => s.renameConversation);
	const sidebarOpen = useSettingsStore((s) => s.sidebarOpen);
	const toggleSidebar = useSettingsStore((s) => s.toggleSidebar);

	const [editingId, setEditingId] = useState<string | null>(null);
	const [draftTitle, setDraftTitle] = useState("");

	useEffect(() => {
		loadList();
	}, [loadList]);

	const commitRename = () => {
		if (editingId && draftTitle.trim()) {
			renameConversation(editingId, draftTitle);
		}
		setEditingId(null);
	};

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
					aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
					className="ml-1 p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
				>
					{sidebarOpen ? (
						<PanelLeftClose className="h-4 w-4" />
					) : (
						<PanelLeft className="h-4 w-4" />
					)}
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
						{editingId === conv.id ? (
							<input
								value={draftTitle}
								onChange={(e) => setDraftTitle(e.target.value)}
								onBlur={commitRename}
								onKeyDown={(e) => {
									if (e.key === "Enter") {
										e.preventDefault();
										commitRename();
									} else if (e.key === "Escape") {
										e.preventDefault();
										setEditingId(null);
									}
								}}
								className="flex-1 min-w-0 rounded border border-border bg-surface px-2 py-1 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
								// biome-ignore lint/a11y/noAutofocus: opening edit mode requires focus
								autoFocus
							/>
						) : (
							<button
								type="button"
								className="flex items-center gap-2 min-w-0 flex-1 text-left"
								onClick={() => selectConversation(conv.id)}
								onDoubleClick={(e) => {
									e.stopPropagation();
									setEditingId(conv.id);
									setDraftTitle(conv.title);
								}}
								title="Double-click to rename"
							>
								<MessageSquare className="h-4 w-4 shrink-0" />
								<span className="text-sm truncate">{conv.title}</span>
							</button>
						)}
						<button
							type="button"
							aria-label="Delete conversation"
							className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-surface-hover text-text-muted hover:text-danger transition-all"
							onClick={(e) => {
								e.stopPropagation();
								if (
									window.confirm(
										`Delete "${conv.title}"? This cannot be undone.`,
									)
								) {
									deleteConversation(conv.id);
								}
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

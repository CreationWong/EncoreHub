import {
	Loader2,
	MessageSquareText,
	PanelLeft,
	PanelLeftClose,
} from "lucide-react";
import { useConversationStore } from "../../stores/conversationStore";
import { useSettingsStore } from "../../stores/settingsStore";
import ProviderSwitcher from "../sidebar/ProviderSwitcher";

function messageCountLabel(count: number) {
	return `${count} ${count === 1 ? "message" : "messages"}`;
}

export default function ContextHeader() {
	const activeId = useConversationStore((state) => state.activeId);
	const conversations = useConversationStore((state) => state.conversations);
	const messages = useConversationStore((state) => state.messages);
	const loading = useConversationStore((state) => state.loading);
	const streaming = useConversationStore((state) => state.streaming);
	const sidebarOpen = useSettingsStore((state) => state.sidebarOpen);
	const toggleSidebar = useSettingsStore((state) => state.toggleSidebar);
	const conversation = conversations.find((item) => item.id === activeId);
	const title =
		conversation?.title ?? (activeId ? "Conversation" : "New conversation");
	const status = loading
		? "Loading messages"
		: streaming
			? "Generating"
			: activeId
				? messageCountLabel(messages.length)
				: "Not started";

	return (
		<header
			aria-label="Conversation context"
			className="flex h-16 shrink-0 items-center border-b border-border bg-workspace px-3"
		>
			<button
				type="button"
				onClick={toggleSidebar}
				aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
				title={sidebarOpen ? "Close sidebar" : "Open sidebar"}
				className="mr-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-control hover:text-text-primary"
			>
				{sidebarOpen ? (
					<PanelLeftClose className="h-4 w-4" />
				) : (
					<PanelLeft className="h-4 w-4" />
				)}
			</button>
			<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-control text-text-secondary">
				<MessageSquareText className="h-4 w-4" />
			</div>
			<div className="ml-3 min-w-0 flex-1">
				<h1
					className="truncate text-sm font-semibold text-text-primary"
					title={title}
				>
					{title}
				</h1>
				<div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-text-muted">
					{loading && <Loader2 className="h-3 w-3 animate-spin" />}
					{streaming && !loading && (
						<span className="h-1.5 w-1.5 rounded-full bg-accent" />
					)}
					<span>{status}</span>
				</div>
			</div>
			<div className="ml-3 min-w-0 max-w-[45%] shrink-0">
				<ProviderSwitcher />
			</div>
		</header>
	);
}

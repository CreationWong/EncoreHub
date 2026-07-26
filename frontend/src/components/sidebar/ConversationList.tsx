import {
	AlertCircle,
	MessageSquare,
	MoreHorizontal,
	Pencil,
	Plus,
	RefreshCw,
	Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Conversation } from "../../services/conversation";
import { confirm } from "../../stores/confirmStore";
import { useConversationStore } from "../../stores/conversationStore";
import { groupConversations } from "./conversationGroups";

const HOVER_PREFETCH_DELAY_MS = 1_000;
const UNUSED_PREFETCH_TTL_MS = 10_000;

interface ConversationActionsProps {
	conversation: Conversation;
	active: boolean;
	onRename: () => void;
}

function ConversationActions({
	conversation,
	active,
	onRename,
}: ConversationActionsProps) {
	const deleteConversation = useConversationStore(
		(state) => state.deleteConversation,
	);
	const generateTitle = useConversationStore((state) => state.generateTitle);
	const [open, setOpen] = useState(false);
	const [openAbove, setOpenAbove] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		if (!open) return;
		const closeOutside = (event: PointerEvent) => {
			if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
		};
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			setOpen(false);
			triggerRef.current?.focus();
		};
		document.addEventListener("pointerdown", closeOutside);
		window.addEventListener("keydown", closeOnEscape);
		return () => {
			document.removeEventListener("pointerdown", closeOutside);
			window.removeEventListener("keydown", closeOnEscape);
		};
	}, [open]);

	const remove = async () => {
		setOpen(false);
		const accepted = await confirm.ask(
			"Delete Conversation",
			`Delete "${conversation.title}"? This cannot be undone.`,
			true,
		);
		if (accepted) await deleteConversation(conversation.id);
	};

	return (
		<div ref={rootRef} className="relative shrink-0">
			<button
				ref={triggerRef}
				type="button"
				onClick={() => {
					if (!open) {
						const rect = triggerRef.current?.getBoundingClientRect();
						setOpenAbove(
							Boolean(rect && window.innerHeight - rect.bottom < 170),
						);
					}
					setOpen((value) => !value);
				}}
				aria-label={`Actions for ${conversation.title}`}
				aria-haspopup="menu"
				aria-expanded={open}
				title="Conversation actions"
				className={`flex h-7 w-7 items-center justify-center rounded text-text-muted transition-opacity hover:bg-control hover:text-text-primary focus:opacity-100 ${
					active || open ? "opacity-100" : "opacity-0 group-hover:opacity-100"
				}`}
			>
				<MoreHorizontal className="h-4 w-4" />
			</button>

			{open && (
				<div
					role="menu"
					aria-label={`Actions for ${conversation.title}`}
					className={`absolute right-0 z-40 w-44 rounded-md border border-border bg-workspace p-1 shadow-lg ${
						openAbove ? "bottom-full mb-1" : "top-full mt-1"
					}`}
				>
					<button
						type="button"
						role="menuitem"
						onClick={() => {
							setOpen(false);
							onRename();
						}}
						className="flex h-8 w-full items-center gap-2 rounded px-2 text-sm text-text-secondary hover:bg-control hover:text-text-primary"
					>
						<Pencil className="h-3.5 w-3.5" />
						Rename
					</button>
					<button
						type="button"
						role="menuitem"
						onClick={() => {
							setOpen(false);
							void generateTitle(conversation.id, true);
						}}
						className="flex h-8 w-full items-center gap-2 rounded px-2 text-sm text-text-secondary hover:bg-control hover:text-text-primary"
					>
						<RefreshCw className="h-3.5 w-3.5" />
						Regenerate title
					</button>
					<div className="my-1 border-t border-border" />
					<button
						type="button"
						role="menuitem"
						onClick={() => void remove()}
						className="flex h-8 w-full items-center gap-2 rounded px-2 text-sm text-danger hover:bg-danger-bg"
					>
						<Trash2 className="h-3.5 w-3.5" />
						Delete
					</button>
				</div>
			)}
		</div>
	);
}

function LoadingList() {
	return (
		<output aria-label="Loading conversations" className="block space-y-2 p-2">
			{[0, 1, 2, 3].map((item) => (
				<span
					key={item}
					className="block h-12 animate-pulse rounded-md bg-control"
				/>
			))}
		</output>
	);
}

export default function ConversationList() {
	const conversations = useConversationStore((state) => state.conversations);
	const activeId = useConversationStore((state) => state.activeId);
	const listLoading = useConversationStore((state) => state.listLoading);
	const listError = useConversationStore((state) => state.listError);
	const loadList = useConversationStore((state) => state.loadList);
	const selectConversation = useConversationStore(
		(state) => state.selectConversation,
	);
	const prefetchConversation = useConversationStore(
		(state) => state.prefetchConversation,
	);
	const releaseConversationPrefetch = useConversationStore(
		(state) => state.releaseConversationPrefetch,
	);
	const newConversation = useConversationStore(
		(state) => state.newConversation,
	);
	const renameConversation = useConversationStore(
		(state) => state.renameConversation,
	);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [draftTitle, setDraftTitle] = useState("");
	const hoverTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
	const evictionTimers = useRef(
		new Map<string, ReturnType<typeof setTimeout>>(),
	);
	const groups = groupConversations(conversations);

	const clearTimer = (
		timers: Map<string, ReturnType<typeof setTimeout>>,
		id: string,
	) => {
		const timer = timers.get(id);
		if (timer !== undefined) clearTimeout(timer);
		timers.delete(id);
	};

	const clearPrefetchTimers = (id: string) => {
		clearTimer(hoverTimers.current, id);
		clearTimer(evictionTimers.current, id);
	};

	const startPrefetch = (id: string) => {
		if (activeId === id || hoverTimers.current.has(id)) return;
		clearTimer(evictionTimers.current, id);
		hoverTimers.current.set(
			id,
			setTimeout(() => {
				hoverTimers.current.delete(id);
				void prefetchConversation(id);
				evictionTimers.current.set(
					id,
					setTimeout(() => {
						evictionTimers.current.delete(id);
						releaseConversationPrefetch(id);
					}, UNUSED_PREFETCH_TTL_MS),
				);
			}, HOVER_PREFETCH_DELAY_MS),
		);
	};

	const releasePrefetch = (id: string) => {
		clearPrefetchTimers(id);
		releaseConversationPrefetch(id);
	};

	const selectPrefetchedConversation = (id: string) => {
		clearPrefetchTimers(id);
		void selectConversation(id);
	};

	useEffect(
		() => () => {
			for (const timer of hoverTimers.current.values()) clearTimeout(timer);
			for (const [id, timer] of evictionTimers.current) {
				clearTimeout(timer);
				releaseConversationPrefetch(id);
			}
			hoverTimers.current.clear();
			evictionTimers.current.clear();
		},
		[releaseConversationPrefetch],
	);

	const beginRename = (conversation: Conversation) => {
		setEditingId(conversation.id);
		setDraftTitle(conversation.title);
	};

	const commitRename = (conversation: Conversation) => {
		const title = draftTitle.trim();
		if (title && title !== conversation.title) {
			void renameConversation(conversation.id, title);
		}
		setEditingId(null);
	};

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="shrink-0 border-b border-border p-2">
				<button
					type="button"
					onClick={() => void newConversation()}
					className="flex h-10 w-full items-center gap-2 rounded-md px-2.5 text-sm font-medium text-text-primary hover:bg-control"
				>
					<Plus className="h-4 w-4" />
					<span>New chat</span>
				</button>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto">
				{listLoading && conversations.length === 0 && <LoadingList />}
				{listError && conversations.length === 0 && !listLoading && (
					<div className="flex flex-col items-center px-5 py-10 text-center">
						<AlertCircle className="h-5 w-5 text-text-muted" />
						<p className="mt-2 text-xs text-text-muted">
							Unable to load conversations.
						</p>
						<button
							type="button"
							onClick={() => void loadList()}
							className="mt-3 flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs text-text-secondary hover:bg-control hover:text-text-primary"
						>
							<RefreshCw className="h-3.5 w-3.5" />
							Retry
						</button>
					</div>
				)}
				{!listLoading && !listError && conversations.length === 0 && (
					<p className="px-5 py-10 text-center text-xs text-text-muted">
						No conversations yet.
					</p>
				)}

				{groups.map((group) => (
					<section
						key={group.id}
						aria-labelledby={`conversation-group-${group.id}`}
					>
						<h2
							id={`conversation-group-${group.id}`}
							className="px-3 pb-1 pt-3 text-[11px] font-medium text-text-muted"
						>
							{group.label}
						</h2>
						<div className="space-y-0.5 px-2">
							{group.conversations.map((conversation) => {
								const active = activeId === conversation.id;
								return (
									<div
										key={conversation.id}
										className={`group relative flex min-h-[54px] items-center rounded-md border px-2 py-1.5 ${
											active
												? "border-border bg-selected"
												: "border-transparent hover:bg-control"
										}`}
									>
										{active && (
											<span className="absolute bottom-2 left-0 top-2 w-0.5 rounded-r bg-accent" />
										)}
										{editingId === conversation.id ? (
											<input
												value={draftTitle}
												onChange={(event) => setDraftTitle(event.target.value)}
												onBlur={() => commitRename(conversation)}
												onKeyDown={(event) => {
													if (event.key === "Enter") {
														event.preventDefault();
														commitRename(conversation);
													} else if (event.key === "Escape") {
														event.preventDefault();
														setEditingId(null);
													}
												}}
												className="min-w-0 flex-1 rounded border border-border bg-workspace px-2 py-1 text-sm text-text-primary"
												// biome-ignore lint/a11y/noAutofocus: explicit rename command transfers focus to the editor
												autoFocus
											/>
										) : (
											<button
												type="button"
												onPointerEnter={() => startPrefetch(conversation.id)}
												onPointerLeave={() => releasePrefetch(conversation.id)}
												onClick={() =>
													selectPrefetchedConversation(conversation.id)
												}
												onDoubleClick={() => beginRename(conversation)}
												aria-current={active ? "page" : undefined}
												className="flex min-w-0 flex-1 items-center gap-2 text-left"
												title={conversation.title}
											>
												<MessageSquare className="h-4 w-4 shrink-0 text-text-muted" />
												<span className="min-w-0 flex-1">
													<span className="block truncate text-sm text-text-primary">
														{conversation.title}
													</span>
													<span className="mt-0.5 block truncate text-[11px] text-text-muted">
														{conversation.model || "Default model"}
													</span>
												</span>
											</button>
										)}
										{editingId !== conversation.id && (
											<ConversationActions
												conversation={conversation}
												active={active}
												onRename={() => beginRename(conversation)}
											/>
										)}
									</div>
								);
							})}
						</div>
					</section>
				))}
				<div className="h-2" />
			</div>
		</div>
	);
}

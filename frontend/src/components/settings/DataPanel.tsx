/** User-facing management for all persistent data except configuration. */

import {
	ArchiveRestore,
	ArrowUpDown,
	DatabaseZap,
	Download,
	FileArchive,
	HardDrive,
	Loader2,
	MessagesSquare,
	RefreshCw,
	Search,
	Trash2,
	Upload,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	type DataConversation,
	type DataDomain,
	type DataOverview,
	type UserDataBackup,
	dataManagementApi,
} from "../../services/dataManagement";
import { useConfirmStore } from "../../stores/confirmStore";
import { useConversationStore } from "../../stores/conversationStore";
import { toast } from "../../stores/toastStore";

const EMPTY_OVERVIEW: DataOverview = {
	conversations: 0,
	messages: 0,
	attachments: 0,
	attachment_bytes: 0,
	memories: 0,
	knowledge_documents: 0,
	cache_entries: 0,
};

const DATA_DOMAINS: Array<{
	id: DataDomain;
	label: string;
	detail: string;
}> = [
	{ id: "characters", label: "Characters", detail: "Profiles and versions" },
	{
		id: "conversations",
		label: "Conversations",
		detail: "Messages, tools, and attachments",
	},
	{ id: "memories", label: "Memories", detail: "Groups and saved memory" },
	{ id: "knowledge", label: "Knowledge", detail: "Documents and chunks" },
];

/** Format storage using stable binary units. */
function formatBytes(value: number): string {
	if (value < 1024) return `${value} B`;
	if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
	return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

/** Format conversation activity as a compact, locale-aware calendar date. */
function formatUpdatedAt(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "Unknown";
	return new Intl.DateTimeFormat("en", {
		month: "short",
		day: "numeric",
		year:
			date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
	}).format(date);
}

type ConversationSort = "newest" | "oldest" | "title" | "messages";

/** Download one JSON artifact and release its temporary object URL. */
function downloadBackup(backup: UserDataBackup): void {
	const blob = new Blob([JSON.stringify(backup, null, 2)], {
		type: "application/json",
	});
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = `encorehub-data-${new Date().toISOString().slice(0, 10)}.json`;
	anchor.click();
	URL.revokeObjectURL(url);
}

/** Dense settings surface for inspecting, moving, and clearing local data. */
export default function DataPanel() {
	const [overview, setOverview] = useState(EMPTY_OVERVIEW);
	const [loading, setLoading] = useState(true);
	const [operation, setOperation] = useState("");
	const [selectedDomains, setSelectedDomains] = useState<DataDomain[]>(
		DATA_DOMAINS.map(({ id }) => id),
	);
	const [conversations, setConversations] = useState<DataConversation[]>([]);
	const [selectedConversations, setSelectedConversations] = useState<string[]>(
		[],
	);
	const [conversationQuery, setConversationQuery] = useState("");
	const [conversationSort, setConversationSort] =
		useState<ConversationSort>("newest");
	const fileInput = useRef<HTMLInputElement>(null);
	const reloadConversations = useConversationStore(
		(state) => state.reloadAfterDataChange,
	);
	const showConfirm = useConfirmStore((state) => state.show);

	const refresh = useCallback(async () => {
		setLoading(true);
		try {
			const [nextOverview, nextConversations] = await Promise.all([
				dataManagementApi.overview(),
				dataManagementApi.conversations(),
			]);
			setOverview(nextOverview);
			setConversations(nextConversations);
			setSelectedConversations((current) =>
				current.filter((id) =>
					nextConversations.some((conversation) => conversation.id === id),
				),
			);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to load data summary",
			);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const run = async (name: string, task: () => Promise<void>) => {
		setOperation(name);
		try {
			await task();
			await refresh();
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Data operation failed",
			);
		} finally {
			setOperation("");
		}
	};

	const exportData = () =>
		run("export", async () => {
			downloadBackup(await dataManagementApi.exportData(selectedDomains));
			toast.success("Data backup exported");
		});

	const importData = (file: File) =>
		run("import", async () => {
			const backup = JSON.parse(await file.text()) as UserDataBackup;
			const result = await dataManagementApi.importData(backup);
			await reloadConversations();
			toast.success(
				`Imported ${result.imported_rows} records; skipped ${result.skipped_rows} existing records`,
			);
		});

	const clearHistory = async () => {
		const answer = await showConfirm({
			title: "Clear all conversation history?",
			message:
				"Every conversation, message, tool call, and conversation attachment will be permanently deleted. Characters, memories, knowledge, and settings are kept.",
			danger: true,
			confirmLabel: "Clear history",
		});
		if (answer !== "confirm") return;
		await run("history", async () => {
			const result = await dataManagementApi.clearHistory();
			await reloadConversations();
			toast.success(`Cleared ${result.conversations} conversations`);
		});
	};

	const clearCache = async () => {
		const answer = await showConfirm({
			title: "Clear regenerable cache?",
			message:
				"Cached search results and orphaned attachment files will be removed. Your conversations, memories, knowledge, credentials, and settings are not affected.",
			confirmLabel: "Clear cache",
		});
		if (answer !== "confirm") return;
		await run("cache", async () => {
			const result = await dataManagementApi.clearCache();
			toast.success(
				`Cleared ${result.cache_entries} cache records and ${result.orphaned_blobs} orphaned files`,
			);
		});
	};

	const exportSelectedConversations = () =>
		run("conversation-export", async () => {
			downloadBackup(
				await dataManagementApi.exportConversations(selectedConversations),
			);
			toast.success(
				`Exported ${selectedConversations.length} selected conversations`,
			);
		});

	const deleteSelectedConversations = async () => {
		const count = selectedConversations.length;
		const answer = await showConfirm({
			title: `Delete ${count} selected conversations?`,
			message:
				"Their messages, tool calls, summaries, and unshared attachments will be permanently deleted as one operation.",
			danger: true,
			confirmLabel: "Delete selected",
		});
		if (answer !== "confirm") return;
		await run("conversation-delete", async () => {
			const result = await dataManagementApi.deleteConversations(
				selectedConversations,
			);
			setSelectedConversations([]);
			await reloadConversations();
			toast.success(`Deleted ${result.conversations} conversations`);
		});
	};

	const busy = operation !== "";
	const visibleConversations = useMemo(() => {
		const query = conversationQuery.trim().toLocaleLowerCase();
		return conversations
			.filter(({ title }) => title.toLocaleLowerCase().includes(query))
			.sort((left, right) => {
				switch (conversationSort) {
					case "oldest":
						return left.updated_at.localeCompare(right.updated_at);
					case "title":
						return left.title.localeCompare(right.title);
					case "messages":
						return right.message_count - left.message_count;
					default:
						return right.updated_at.localeCompare(left.updated_at);
				}
			});
	}, [conversationQuery, conversationSort, conversations]);
	const visibleConversationIds = visibleConversations.map(({ id }) => id);
	const allVisibleSelected =
		visibleConversationIds.length > 0 &&
		visibleConversationIds.every((id) => selectedConversations.includes(id));
	const toggleDomain = (domain: DataDomain) => {
		setSelectedDomains((current) =>
			current.includes(domain)
				? current.filter((candidate) => candidate !== domain)
				: DATA_DOMAINS.map(({ id }) => id).filter(
						(candidate) => current.includes(candidate) || candidate === domain,
					),
		);
	};
	const toggleConversation = (id: string) => {
		setSelectedConversations((current) =>
			current.includes(id)
				? current.filter((candidate) => candidate !== id)
				: [...current, id],
		);
	};
	const toggleVisibleConversations = () => {
		setSelectedConversations((current) =>
			allVisibleSelected
				? current.filter((id) => !visibleConversationIds.includes(id))
				: Array.from(new Set([...current, ...visibleConversationIds])),
		);
	};

	return (
		<div className="h-full min-h-0 overflow-y-auto bg-workspace">
			<div className="mx-auto max-w-6xl px-4 py-5 sm:px-6">
				<header className="flex items-start justify-between gap-4 pb-5">
					<div className="flex items-center gap-3">
						<div className="flex h-10 w-10 items-center justify-center rounded-md bg-info-bg text-info">
							<FileArchive className="h-5 w-5" />
						</div>
						<div>
							<h3 className="text-base font-semibold text-text-primary">
								Local data
							</h3>
							<p className="mt-0.5 text-xs text-text-muted">
								Inspect, move, and remove data stored by EncoreHub.
							</p>
						</div>
					</div>
					<button
						type="button"
						onClick={() => void refresh()}
						disabled={loading || busy}
						aria-label="Refresh data summary"
						title="Refresh data summary"
						className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text-primary disabled:opacity-40"
					>
						<RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
					</button>
				</header>

				<section
					aria-label="Data summary"
					className="grid overflow-hidden rounded-md border border-border bg-surface sm:grid-cols-3"
				>
					<SummaryGroup
						icon={MessagesSquare}
						label="Conversation activity"
						primary={loading ? "-" : overview.conversations.toLocaleString()}
						primaryLabel="conversations"
						secondary={loading ? "-" : overview.messages.toLocaleString()}
						secondaryLabel="messages"
					/>
					<SummaryGroup
						icon={HardDrive}
						label="Attachment storage"
						primary={loading ? "-" : formatBytes(overview.attachment_bytes)}
						primaryLabel="stored"
						secondary={loading ? "-" : overview.attachments.toLocaleString()}
						secondaryLabel="files"
					/>
					<SummaryGroup
						icon={FileArchive}
						label="Saved context"
						primary={loading ? "-" : overview.memories.toLocaleString()}
						primaryLabel="memories"
						secondary={
							loading ? "-" : overview.knowledge_documents.toLocaleString()
						}
						secondaryLabel="knowledge files"
					/>
				</section>

				<div className="grid items-start gap-6 py-6 min-[1040px]:grid-cols-[minmax(0,1fr)_18.5rem]">
					<section
						aria-labelledby="conversation-data-heading"
						className="min-w-0 overflow-hidden rounded-md border border-border bg-surface"
					>
						<div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
							<div className="flex min-w-0 items-center gap-2.5">
								<MessagesSquare className="h-4 w-4 text-accent" />
								<h4
									id="conversation-data-heading"
									className="text-sm font-semibold text-text-primary"
								>
									Conversations
								</h4>
								<span className="rounded bg-surface-alt px-1.5 py-0.5 text-[10px] tabular-nums text-text-muted">
									{conversations.length}
								</span>
							</div>
							<span className="text-xs tabular-nums text-text-muted">
								{selectedConversations.length} selected
							</span>
						</div>

						<div className="flex flex-wrap items-center gap-2 border-y border-border bg-surface-alt/40 px-3 py-2.5">
							<label className="relative min-w-44 flex-1">
								<span className="sr-only">Search conversations</span>
								<Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
								<input
									type="search"
									autoComplete="off"
									value={conversationQuery}
									onChange={(event) => setConversationQuery(event.target.value)}
									placeholder="Search conversations"
									className="h-8 w-full rounded-md border border-border bg-workspace pl-8 pr-3 text-xs text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
								/>
							</label>
							<label className="relative shrink-0">
								<span className="sr-only">Sort conversations</span>
								<ArrowUpDown className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
								<select
									value={conversationSort}
									onChange={(event) =>
										setConversationSort(event.target.value as ConversationSort)
									}
									className="h-8 rounded-md border border-border bg-workspace pl-8 pr-7 text-xs text-text-secondary outline-none focus:border-accent"
								>
									<option value="newest">Newest</option>
									<option value="oldest">Oldest</option>
									<option value="title">Title</option>
									<option value="messages">Most messages</option>
								</select>
							</label>
						</div>

						<div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
							<label className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-1 text-xs text-text-secondary hover:text-text-primary">
								<input
									type="checkbox"
									autoComplete="off"
									aria-label="Toggle all conversations"
									checked={allVisibleSelected}
									onChange={toggleVisibleConversations}
									disabled={busy || visibleConversations.length === 0}
									className="h-3.5 w-3.5 accent-accent disabled:opacity-40"
								/>
								{conversationQuery ? "Select filtered" : "Select all"}
							</label>
							<div className="flex items-center gap-2">
								<button
									type="button"
									aria-label="Export selected conversations"
									onClick={() => void exportSelectedConversations()}
									disabled={busy || selectedConversations.length === 0}
									className="flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium text-text-secondary hover:bg-surface-hover disabled:opacity-40"
								>
									{operation === "conversation-export" ? (
										<Loader2 className="h-3.5 w-3.5 animate-spin" />
									) : (
										<Download className="h-3.5 w-3.5" />
									)}
									Export
								</button>
								<button
									type="button"
									aria-label="Delete selected conversations"
									onClick={() => void deleteSelectedConversations()}
									disabled={busy || selectedConversations.length === 0}
									className="flex h-8 items-center gap-1.5 rounded-md border border-danger-border px-2.5 text-xs font-medium text-danger hover:bg-danger-bg disabled:opacity-40"
								>
									{operation === "conversation-delete" ? (
										<Loader2 className="h-3.5 w-3.5 animate-spin" />
									) : (
										<Trash2 className="h-3.5 w-3.5" />
									)}
									Delete
								</button>
							</div>
						</div>
						<div className="max-h-[32rem] overflow-y-auto">
							{conversations.length === 0 ? (
								<p className="px-4 py-8 text-center text-xs text-text-muted">
									No conversations stored
								</p>
							) : visibleConversations.length === 0 ? (
								<p className="px-4 py-8 text-center text-xs text-text-muted">
									No conversations match this search
								</p>
							) : (
								visibleConversations.map((conversation) => (
									<label
										key={conversation.id}
										className="grid min-h-14 cursor-pointer grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0 hover:bg-surface-hover"
									>
										<input
											type="checkbox"
											autoComplete="off"
											checked={selectedConversations.includes(conversation.id)}
											onChange={() => toggleConversation(conversation.id)}
											className="h-3.5 w-3.5 accent-accent"
										/>
										<span className="min-w-0">
											<span className="block truncate text-sm text-text-primary">
												{conversation.title}
											</span>
											<span className="mt-0.5 block text-[10px] tabular-nums text-text-muted">
												{conversation.message_count} messages
												{conversation.attachment_count > 0 &&
													` · ${conversation.attachment_count} files`}
											</span>
										</span>
										<span className="whitespace-nowrap text-[10px] tabular-nums text-text-muted">
											{formatUpdatedAt(conversation.updated_at)}
										</span>
									</label>
								))
							)}
						</div>
					</section>

					<aside className="space-y-5" aria-label="Data maintenance">
						<section
							aria-labelledby="backup-heading"
							className="overflow-hidden rounded-md border border-border bg-surface"
						>
							<div className="flex items-center gap-2 border-b border-border px-4 py-3">
								<ArchiveRestore className="h-4 w-4 text-accent" />
								<h4
									id="backup-heading"
									className="text-sm font-semibold text-text-primary"
								>
									Backup and transfer
								</h4>
							</div>
							<fieldset className="divide-y divide-border">
								<legend className="sr-only">Backup data domains</legend>
								{DATA_DOMAINS.map(({ id, label, detail }) => (
									<label
										key={id}
										className="flex cursor-pointer items-start gap-2.5 px-4 py-2.5 hover:bg-surface-hover"
									>
										<input
											type="checkbox"
											autoComplete="off"
											checked={selectedDomains.includes(id)}
											onChange={() => toggleDomain(id)}
											className="mt-0.5 h-3.5 w-3.5 accent-accent"
										/>
										<span className="min-w-0">
											<span className="block text-xs font-medium text-text-primary">
												{label}
											</span>
											<span className="block text-[10px] leading-4 text-text-muted">
												{detail}
											</span>
										</span>
									</label>
								))}
							</fieldset>
							<div className="grid grid-cols-2 gap-2 border-t border-border bg-surface-alt/40 p-3">
								<CommandButton
									icon={Download}
									label="Export"
									busy={operation === "export"}
									disabled={busy || selectedDomains.length === 0}
									onClick={() => void exportData()}
								/>
								<CommandButton
									icon={Upload}
									label="Import"
									busy={operation === "import"}
									disabled={busy}
									onClick={() => fileInput.current?.click()}
								/>
							</div>
							<input
								ref={fileInput}
								type="file"
								autoComplete="off"
								accept="application/json,.json"
								className="sr-only"
								onChange={(event) => {
									const file = event.target.files?.[0];
									event.target.value = "";
									if (file) void importData(file);
								}}
							/>
						</section>

						<section
							aria-labelledby="cleanup-heading"
							className="overflow-hidden rounded-md border border-border bg-surface"
						>
							<div className="flex items-center gap-2 border-b border-border px-4 py-3">
								<DatabaseZap className="h-4 w-4 text-warning" />
								<h4
									id="cleanup-heading"
									className="text-sm font-semibold text-text-primary"
								>
									Maintenance
								</h4>
							</div>
							<MaintenanceRow
								icon={DatabaseZap}
								title="Regenerable cache"
								detail={`${overview.cache_entries.toLocaleString()} cached records`}
								label="Clear"
								busy={operation === "cache"}
								disabled={busy}
								onClick={() => void clearCache()}
							/>
							<div className="border-t border-danger-border bg-danger-bg/40">
								<MaintenanceRow
									icon={Trash2}
									title="All conversation history"
									detail={`${overview.conversations.toLocaleString()} conversations`}
									label="Clear"
									danger
									busy={operation === "history"}
									disabled={busy || overview.conversations === 0}
									onClick={() => void clearHistory()}
								/>
							</div>
						</section>
					</aside>
				</div>
			</div>
		</div>
	);
}

interface SummaryGroupProps {
	icon: typeof Download;
	label: string;
	primary: string;
	primaryLabel: string;
	secondary: string;
	secondaryLabel: string;
}

/** One grouped overview metric with a primary and supporting measure. */
function SummaryGroup({
	icon: Icon,
	label,
	primary,
	primaryLabel,
	secondary,
	secondaryLabel,
}: SummaryGroupProps) {
	return (
		<div className="min-w-0 border-b border-border px-4 py-3 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
			<div className="flex items-center gap-2 text-[10px] font-semibold text-text-muted">
				<Icon className="h-3.5 w-3.5" />
				<span>{label}</span>
			</div>
			<div className="mt-2 grid grid-cols-2 gap-3">
				<div className="min-w-0">
					<span className="block whitespace-nowrap text-base font-semibold tabular-nums text-text-primary min-[900px]:text-lg">
						{primary}
					</span>
					<span className="block text-[10px] text-text-muted">
						{primaryLabel}
					</span>
				</div>
				<div className="min-w-0">
					<span className="block whitespace-nowrap text-sm font-medium tabular-nums text-text-secondary">
						{secondary}
					</span>
					<span className="block text-[10px] text-text-muted">
						{secondaryLabel}
					</span>
				</div>
			</div>
		</div>
	);
}

interface CommandButtonProps {
	icon: typeof Download;
	label: string;
	busy: boolean;
	disabled: boolean;
	onClick: () => void;
}

/** Compact transfer command used beneath the selected backup domains. */
function CommandButton({
	icon: Icon,
	label,
	busy,
	disabled,
	onClick,
}: CommandButtonProps) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className="flex h-9 items-center justify-center gap-1.5 rounded-md border border-border bg-workspace px-3 text-xs font-medium text-text-secondary hover:bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
		>
			{busy ? (
				<Loader2 className="h-3.5 w-3.5 animate-spin" />
			) : (
				<Icon className="h-3.5 w-3.5" />
			)}
			{label}
		</button>
	);
}

interface MaintenanceRowProps extends CommandButtonProps {
	title: string;
	detail: string;
	danger?: boolean;
}

/** Maintenance command with its impact visible before the action is invoked. */
function MaintenanceRow({
	icon: Icon,
	title,
	detail,
	label,
	danger,
	busy,
	disabled,
	onClick,
}: MaintenanceRowProps) {
	return (
		<div className="grid grid-cols-[2rem_minmax(0,1fr)_3.75rem] items-center gap-2.5 px-3 py-3">
			<div
				className={`flex h-8 w-8 items-center justify-center rounded-md ${danger ? "text-danger" : "bg-surface-alt text-text-secondary"}`}
			>
				<Icon className="h-4 w-4" />
			</div>
			<div className="min-w-0">
				<p
					className={`truncate text-xs font-medium ${danger ? "text-danger" : "text-text-primary"}`}
				>
					{title}
				</p>
				<p className="mt-0.5 truncate text-[10px] tabular-nums text-text-muted">
					{detail}
				</p>
			</div>
			<button
				type="button"
				aria-label={`${label} ${title.toLocaleLowerCase()}`}
				onClick={onClick}
				disabled={disabled}
				className={`flex h-8 items-center justify-center rounded-md border px-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40 ${danger ? "border-danger-border text-danger hover:bg-danger-bg" : "border-border text-text-secondary hover:bg-surface-hover"}`}
			>
				{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : label}
			</button>
		</div>
	);
}

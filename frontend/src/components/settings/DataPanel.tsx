/** User-facing management for all persistent data except configuration. */

import {
	ArchiveRestore,
	DatabaseZap,
	Download,
	FileArchive,
	Loader2,
	MessagesSquare,
	RefreshCw,
	Trash2,
	Upload,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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
	const stats = [
		["Conversations", overview.conversations],
		["Messages", overview.messages],
		["Attachments", overview.attachments],
		["Attachment storage", formatBytes(overview.attachment_bytes)],
		["Memories", overview.memories],
		["Knowledge files", overview.knowledge_documents],
	];

	return (
		<div className="h-full min-h-0 overflow-y-auto bg-workspace">
			<div className="mx-auto max-w-5xl px-6 py-6">
				<header className="flex items-start justify-between gap-4 border-b border-border pb-5">
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
					className="grid grid-cols-2 border-b border-border py-5 sm:grid-cols-3 lg:grid-cols-6"
				>
					{stats.map(([label, value], index) => (
						<div
							key={label}
							className={`min-w-0 px-3 py-2 ${index > 0 ? "border-l border-border" : ""}`}
						>
							<p className="truncate text-[10px] font-semibold text-text-muted">
								{label}
							</p>
							<p className="mt-1 truncate text-base font-semibold tabular-nums text-text-primary">
								{loading ? "-" : value.toLocaleString()}
							</p>
						</div>
					))}
				</section>

				<div className="grid gap-6 py-6 lg:grid-cols-2">
					<section aria-labelledby="backup-heading">
						<div className="mb-3 flex items-center gap-2">
							<ArchiveRestore className="h-4 w-4 text-accent" />
							<h4
								id="backup-heading"
								className="text-sm font-semibold text-text-primary"
							>
								Backup and transfer
							</h4>
						</div>
						<fieldset className="mb-3 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border">
							<legend className="sr-only">Backup data domains</legend>
							{DATA_DOMAINS.map(({ id, label, detail }) => (
								<label
									key={id}
									className="flex min-w-0 cursor-pointer items-start gap-2 bg-surface px-3 py-2.5 hover:bg-surface-hover"
								>
									<input
										type="checkbox"
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
						<div className="divide-y divide-border rounded-md border border-border bg-surface">
							<ActionRow
								icon={Download}
								title="Export data"
								detail="Create one atomic backup from the selected domains. Required dependency records are included automatically."
								label="Export"
								busy={operation === "export"}
								disabled={busy || selectedDomains.length === 0}
								onClick={() => void exportData()}
							/>
							<ActionRow
								icon={Upload}
								title="Import data"
								detail="Merge an EncoreHub JSON backup. Existing records with the same identifiers are kept."
								label="Import"
								busy={operation === "import"}
								disabled={busy}
								onClick={() => fileInput.current?.click()}
							/>
						</div>
						<input
							ref={fileInput}
							type="file"
							accept="application/json,.json"
							className="sr-only"
							onChange={(event) => {
								const file = event.target.files?.[0];
								event.target.value = "";
								if (file) void importData(file);
							}}
						/>
					</section>

					<section aria-labelledby="cleanup-heading">
						<div className="mb-3 flex items-center gap-2">
							<DatabaseZap className="h-4 w-4 text-warning" />
							<h4
								id="cleanup-heading"
								className="text-sm font-semibold text-text-primary"
							>
								Cleanup
							</h4>
						</div>
						<div className="divide-y divide-border rounded-md border border-border bg-surface">
							<ActionRow
								icon={Trash2}
								title="Clear conversation history"
								detail={`${overview.conversations.toLocaleString()} conversations and their messages, tool calls, and attachments.`}
								label="Clear"
								danger
								busy={operation === "history"}
								disabled={busy || overview.conversations === 0}
								onClick={() => void clearHistory()}
							/>
							<ActionRow
								icon={DatabaseZap}
								title="Clear cache"
								detail={`${overview.cache_entries.toLocaleString()} regenerable search records, plus orphaned attachment files.`}
								label="Clear"
								busy={operation === "cache"}
								disabled={busy}
								onClick={() => void clearCache()}
							/>
						</div>
					</section>
				</div>

				<section aria-labelledby="conversation-data-heading" className="pb-6">
					<div className="mb-3 flex flex-wrap items-center justify-between gap-3">
						<div className="flex items-center gap-2">
							<MessagesSquare className="h-4 w-4 text-accent" />
							<h4
								id="conversation-data-heading"
								className="text-sm font-semibold text-text-primary"
							>
								Conversation data
							</h4>
							<span className="text-xs text-text-muted">
								{selectedConversations.length} selected
							</span>
						</div>
						<div className="flex items-center gap-2">
							<button
								type="button"
								aria-label="Toggle all conversations"
								onClick={() =>
									setSelectedConversations(
										selectedConversations.length === conversations.length
											? []
											: conversations.map(({ id }) => id),
									)
								}
								disabled={busy || conversations.length === 0}
								className="h-8 rounded-md px-2 text-xs text-text-secondary hover:bg-surface-hover disabled:opacity-40"
							>
								{selectedConversations.length === conversations.length &&
								conversations.length > 0
									? "Clear selection"
									: "Select all"}
							</button>
							<button
								type="button"
								aria-label="Export selected conversations"
								onClick={() => void exportSelectedConversations()}
								disabled={busy || selectedConversations.length === 0}
								className="flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium text-text-secondary hover:bg-surface-hover disabled:opacity-40"
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
								className="flex h-8 items-center gap-1.5 rounded-md border border-danger-border px-3 text-xs font-medium text-danger hover:bg-danger-bg disabled:opacity-40"
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
					<div className="max-h-72 overflow-y-auto rounded-md border border-border bg-surface">
						{conversations.length === 0 ? (
							<p className="px-4 py-8 text-center text-xs text-text-muted">
								No conversations stored
							</p>
						) : (
							conversations.map((conversation) => (
								<label
									key={conversation.id}
									className="grid cursor-pointer grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-4 py-3 last:border-b-0 hover:bg-surface-hover"
								>
									<input
										type="checkbox"
										checked={selectedConversations.includes(conversation.id)}
										onChange={() => toggleConversation(conversation.id)}
										className="h-3.5 w-3.5 accent-accent"
									/>
									<span className="min-w-0 truncate text-sm text-text-primary">
										{conversation.title}
									</span>
									<span className="whitespace-nowrap text-[10px] tabular-nums text-text-muted">
										{conversation.message_count} messages
										{conversation.attachment_count > 0 &&
											` · ${conversation.attachment_count} files`}
									</span>
								</label>
							))
						)}
					</div>
				</section>

				<div className="flex items-start gap-3 border-t border-border pt-5 text-xs text-text-muted">
					<MessagesSquare className="mt-0.5 h-4 w-4 shrink-0" />
					<p>
						Provider configuration, API keys, interface preferences, developer
						settings, and runtime logs are outside this data manager.
					</p>
				</div>
			</div>
		</div>
	);
}

interface ActionRowProps {
	icon: typeof Download;
	title: string;
	detail: string;
	label: string;
	danger?: boolean;
	busy: boolean;
	disabled: boolean;
	onClick: () => void;
}

/** Reusable command row with a fixed action column that never shifts. */
function ActionRow({
	icon: Icon,
	title,
	detail,
	label,
	danger,
	busy,
	disabled,
	onClick,
}: ActionRowProps) {
	return (
		<div className="grid min-h-24 grid-cols-[2.25rem_minmax(0,1fr)] items-center gap-3 px-4 py-3 sm:grid-cols-[2.25rem_minmax(0,1fr)_5.5rem]">
			<div
				className={`flex h-8 w-8 items-center justify-center rounded-md ${danger ? "bg-danger-bg text-danger" : "bg-surface-alt text-text-secondary"}`}
			>
				<Icon className="h-4 w-4" />
			</div>
			<div className="min-w-0">
				<p className="text-sm font-medium text-text-primary">{title}</p>
				<p className="mt-1 text-xs leading-5 text-text-muted">{detail}</p>
			</div>
			<button
				type="button"
				onClick={onClick}
				disabled={disabled}
				className={`col-start-2 flex h-8 w-full items-center justify-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 sm:col-auto sm:w-[5.5rem] ${danger ? "border-danger-border text-danger hover:bg-danger-bg" : "border-border text-text-secondary hover:bg-surface-hover hover:text-text-primary"}`}
			>
				{busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
				{label}
			</button>
		</div>
	);
}

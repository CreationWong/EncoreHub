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
	type MessageKey,
	intlLocale,
	t,
	useActiveLocaleId,
	useT,
} from "../../i18n";
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

/** Backup domains; labels resolve through the catalog so locale switches update. */
const DATA_DOMAINS: Array<{
	id: DataDomain;
	labelKey: MessageKey;
	detailKey: MessageKey;
}> = [
	{
		id: "characters",
		labelKey: "data.domainCharacters",
		detailKey: "data.profilesAndVersions",
	},
	{
		id: "conversations",
		labelKey: "data.domainConversations",
		detailKey: "data.messagesToolsAttachments",
	},
	{
		id: "memories",
		labelKey: "data.domainMemories",
		detailKey: "data.groupsAndMemory",
	},
	{
		id: "knowledge",
		labelKey: "data.domainKnowledge",
		detailKey: "data.documentsAndChunks",
	},
];

/** Format storage using stable binary units. */
function formatBytes(value: number): string {
	if (value < 1024) return `${value} B`;
	if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
	return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

/** Format conversation activity as a compact, locale-aware calendar date. */
function formatUpdatedAt(value: string, locale: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return t("common.unknown");
	return new Intl.DateTimeFormat(locale, {
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
	const translate = useT();
	const locale = intlLocale(useActiveLocaleId());
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
				error instanceof Error ? error.message : t("data.loadFailed"),
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
				error instanceof Error ? error.message : t("data.operationFailed"),
			);
		} finally {
			setOperation("");
		}
	};

	const exportData = () =>
		run("export", async () => {
			downloadBackup(await dataManagementApi.exportData(selectedDomains));
			toast.success(t("toast.backupExported"));
		});

	const importData = (file: File) =>
		run("import", async () => {
			const backup = JSON.parse(await file.text()) as UserDataBackup;
			const result = await dataManagementApi.importData(backup);
			await reloadConversations();
			toast.success(
				t("toast.importedRecords", {
					imported: result.imported_rows,
					skipped: result.skipped_rows,
				}),
			);
		});

	const clearHistory = async () => {
		const answer = await showConfirm({
			title: t("data.clearHistoryTitle"),
			message: t("data.clearHistoryMessage"),
			danger: true,
			confirmLabel: t("data.clearHistory"),
		});
		if (answer !== "confirm") return;
		await run("history", async () => {
			const result = await dataManagementApi.clearHistory();
			await reloadConversations();
			toast.success(
				t("toast.clearedConversations", { count: result.conversations }),
			);
		});
	};

	const clearCache = async () => {
		const answer = await showConfirm({
			title: t("data.clearCacheTitle"),
			message: t("data.clearCacheMessage"),
			confirmLabel: t("data.clearCache"),
		});
		if (answer !== "confirm") return;
		await run("cache", async () => {
			const result = await dataManagementApi.clearCache();
			toast.success(
				t("toast.clearedCache", {
					cache: result.cache_entries,
					orphaned: result.orphaned_blobs,
				}),
			);
		});
	};

	const exportSelectedConversations = () =>
		run("conversation-export", async () => {
			downloadBackup(
				await dataManagementApi.exportConversations(selectedConversations),
			);
			toast.success(
				t("toast.exportedSelected", { count: selectedConversations.length }),
			);
		});

	const deleteSelectedConversations = async () => {
		const count = selectedConversations.length;
		const answer = await showConfirm({
			title: t("data.deleteSelectedTitle", { count }),
			message: t("data.deleteSelectedMessage"),
			danger: true,
			confirmLabel: t("data.deleteSelectedLabel"),
		});
		if (answer !== "confirm") return;
		await run("conversation-delete", async () => {
			const result = await dataManagementApi.deleteConversations(
				selectedConversations,
			);
			setSelectedConversations([]);
			await reloadConversations();
			toast.success(
				t("toast.deletedConversations", { count: result.conversations }),
			);
		});
	};

	const busy = operation !== "";
	const visibleConversations = useMemo(() => {
		const query = conversationQuery.trim().toLocaleLowerCase(locale);
		return conversations
			.filter(({ title }) => title.toLocaleLowerCase(locale).includes(query))
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
	}, [conversationQuery, conversationSort, conversations, locale]);
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
	const formatCount = (value: number) => value.toLocaleString(locale);

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
								{translate("data.localData")}
							</h3>
							<p className="mt-0.5 text-xs text-text-muted">
								{translate("data.localDataHelp")}
							</p>
						</div>
					</div>
					<button
						type="button"
						onClick={() => void refresh()}
						disabled={loading || busy}
						aria-label={translate("data.refreshSummary")}
						title={translate("data.refreshSummary")}
						className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text-primary disabled:opacity-40"
					>
						<RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
					</button>
				</header>

				<section
					aria-label={translate("data.summary")}
					className="grid overflow-hidden rounded-md border border-border bg-surface sm:grid-cols-3"
				>
					<SummaryGroup
						icon={MessagesSquare}
						label={translate("data.activity")}
						primary={loading ? "-" : formatCount(overview.conversations)}
						primaryLabel={translate("data.conversations")}
						secondary={loading ? "-" : formatCount(overview.messages)}
						secondaryLabel={translate("data.messages")}
					/>
					<SummaryGroup
						icon={HardDrive}
						label={translate("data.attachmentStorage")}
						primary={loading ? "-" : formatBytes(overview.attachment_bytes)}
						primaryLabel={translate("data.stored")}
						secondary={loading ? "-" : formatCount(overview.attachments)}
						secondaryLabel={translate("data.files")}
					/>
					<SummaryGroup
						icon={FileArchive}
						label={translate("data.savedContext")}
						primary={loading ? "-" : formatCount(overview.memories)}
						primaryLabel={translate("data.memories")}
						secondary={
							loading ? "-" : formatCount(overview.knowledge_documents)
						}
						secondaryLabel={translate("data.knowledgeFiles")}
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
									{translate("data.conversationsHeading")}
								</h4>
								<span className="rounded bg-surface-alt px-1.5 py-0.5 text-[10px] tabular-nums text-text-muted">
									{conversations.length}
								</span>
							</div>
							<span className="text-xs tabular-nums text-text-muted">
								{translate("data.selectedCount", {
									count: selectedConversations.length,
								})}
							</span>
						</div>

						<div className="flex flex-wrap items-center gap-2 border-y border-border bg-surface-alt/40 px-3 py-2.5">
							<label className="relative min-w-44 flex-1">
								<span className="sr-only">
									{translate("data.searchConversations")}
								</span>
								<Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
								<input
									type="search"
									autoComplete="off"
									value={conversationQuery}
									onChange={(event) => setConversationQuery(event.target.value)}
									placeholder={translate("data.searchConversations")}
									className="h-8 w-full rounded-md border border-border bg-workspace pl-8 pr-3 text-xs text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
								/>
							</label>
							<label className="relative shrink-0">
								<span className="sr-only">
									{translate("data.sortConversations")}
								</span>
								<ArrowUpDown className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
								<select
									value={conversationSort}
									onChange={(event) =>
										setConversationSort(event.target.value as ConversationSort)
									}
									className="h-8 rounded-md border border-border bg-workspace pl-8 pr-7 text-xs text-text-secondary outline-none focus:border-accent"
								>
									<option value="newest">{translate("data.newest")}</option>
									<option value="oldest">{translate("data.oldest")}</option>
									<option value="title">{translate("data.title")}</option>
									<option value="messages">
										{translate("data.mostMessages")}
									</option>
								</select>
							</label>
						</div>

						<div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
							<label className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-1 text-xs text-text-secondary hover:text-text-primary">
								<input
									type="checkbox"
									autoComplete="off"
									aria-label={translate("data.toggleAll")}
									checked={allVisibleSelected}
									onChange={toggleVisibleConversations}
									disabled={busy || visibleConversations.length === 0}
									className="h-3.5 w-3.5 accent-accent disabled:opacity-40"
								/>
								{conversationQuery
									? translate("data.selectFiltered")
									: translate("data.selectAll")}
							</label>
							<div className="flex items-center gap-2">
								<button
									type="button"
									aria-label={translate("data.exportSelected")}
									onClick={() => void exportSelectedConversations()}
									disabled={busy || selectedConversations.length === 0}
									className="flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium text-text-secondary hover:bg-surface-hover disabled:opacity-40"
								>
									{operation === "conversation-export" ? (
										<Loader2 className="h-3.5 w-3.5 animate-spin" />
									) : (
										<Download className="h-3.5 w-3.5" />
									)}
									{translate("common.export")}
								</button>
								<button
									type="button"
									aria-label={translate("data.deleteSelected")}
									onClick={() => void deleteSelectedConversations()}
									disabled={busy || selectedConversations.length === 0}
									className="flex h-8 items-center gap-1.5 rounded-md border border-danger-border px-2.5 text-xs font-medium text-danger hover:bg-danger-bg disabled:opacity-40"
								>
									{operation === "conversation-delete" ? (
										<Loader2 className="h-3.5 w-3.5 animate-spin" />
									) : (
										<Trash2 className="h-3.5 w-3.5" />
									)}
									{translate("common.delete")}
								</button>
							</div>
						</div>
						<div className="max-h-[32rem] overflow-y-auto">
							{conversations.length === 0 ? (
								<p className="px-4 py-8 text-center text-xs text-text-muted">
									{translate("data.noConversationsStored")}
								</p>
							) : visibleConversations.length === 0 ? (
								<p className="px-4 py-8 text-center text-xs text-text-muted">
									{translate("data.noConversationsMatch")}
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
												{translate("data.messagesCount", {
													count: conversation.message_count,
												})}
												{conversation.attachment_count > 0 &&
													` · ${translate("data.filesCount", {
														count: conversation.attachment_count,
													})}`}
											</span>
										</span>
										<span className="whitespace-nowrap text-[10px] tabular-nums text-text-muted">
											{formatUpdatedAt(conversation.updated_at, locale)}
										</span>
									</label>
								))
							)}
						</div>
					</section>

					<aside
						className="space-y-5"
						aria-label={translate("data.maintenance")}
					>
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
									{translate("data.backupTransfer")}
								</h4>
							</div>
							<fieldset className="divide-y divide-border">
								<legend className="sr-only">
									{translate("data.backupDomains")}
								</legend>
								{DATA_DOMAINS.map(({ id, labelKey, detailKey }) => (
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
												{translate(labelKey)}
											</span>
											<span className="block text-[10px] leading-4 text-text-muted">
												{translate(detailKey)}
											</span>
										</span>
									</label>
								))}
							</fieldset>
							<div className="grid grid-cols-2 gap-2 border-t border-border bg-surface-alt/40 p-3">
								<CommandButton
									icon={Download}
									label={translate("common.export")}
									busy={operation === "export"}
									disabled={busy || selectedDomains.length === 0}
									onClick={() => void exportData()}
								/>
								<CommandButton
									icon={Upload}
									label={translate("common.import")}
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
									{translate("data.maintenanceHeading")}
								</h4>
							</div>
							<MaintenanceRow
								icon={DatabaseZap}
								title={translate("data.regenerableCache")}
								detail={translate("data.cachedRecords", {
									count: formatCount(overview.cache_entries),
								})}
								label={translate("common.clear")}
								busy={operation === "cache"}
								disabled={busy}
								onClick={() => void clearCache()}
							/>
							<div className="border-t border-danger-border bg-danger-bg/40">
								<MaintenanceRow
									icon={Trash2}
									title={translate("data.allHistory")}
									detail={translate("data.conversationsCount", {
										count: formatCount(overview.conversations),
									})}
									label={translate("common.clear")}
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
	const locale = intlLocale(useActiveLocaleId());
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
				aria-label={`${label} ${title.toLocaleLowerCase(locale)}`}
				onClick={onClick}
				disabled={disabled}
				className={`flex h-8 items-center justify-center rounded-md border px-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40 ${danger ? "border-danger-border text-danger hover:bg-danger-bg" : "border-border text-text-secondary hover:bg-surface-hover"}`}
			>
				{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : label}
			</button>
		</div>
	);
}

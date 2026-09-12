// Knowledge base workspace for ingestion, browsing, and chunk inspection.
//
// Talks only to the Engine-backed Knowledge API. Semantic search and title
// filtering are separate concerns: chunk search ranks indexed vectors, while
// the document filter narrows the browse list by title.

import {
	ChevronDown,
	ChevronRight,
	Database,
	FileText,
	Loader2,
	Quote,
	Search,
	Trash2,
	Upload,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
	type KnowledgeBackend,
	type KnowledgeChunk,
	type KnowledgeDoc,
	type KnowledgeDocChunk,
	knowledgeApi,
} from "../../services/knowledge";
import { confirm } from "../../stores/confirmStore";
import { useConversationStore } from "../../stores/conversationStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { toast } from "../../stores/toastStore";

const BACKEND_LABELS: Record<KnowledgeBackend, string> = {
	lance_db: "LanceDB",
	sqlite_vec: "SQLite-Vec",
};

type DocSort = "recent" | "title" | "size";

const DOC_SORTS: { id: DocSort; label: string }[] = [
	{ id: "recent", label: "Newest" },
	{ id: "title", label: "Title" },
	{ id: "size", label: "Largest" },
];

function fmtBytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDate(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "";
	return new Intl.DateTimeFormat(undefined, {
		month: "short",
		day: "numeric",
		year: "numeric",
	}).format(date);
}

export default function KnowledgePanel() {
	const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
	const [loading, setLoading] = useState(false);
	const [docFilter, setDocFilter] = useState("");
	const [docSort, setDocSort] = useState<DocSort>("recent");

	const [query, setQuery] = useState("");
	const [results, setResults] = useState<KnowledgeChunk[]>([]);
	const [backend, setBackend] = useState<KnowledgeBackend | null>(null);
	const [searching, setSearching] = useState(false);
	const [searched, setSearched] = useState(false);

	const [expandedDocId, setExpandedDocId] = useState<string | null>(null);
	const [chunks, setChunks] = useState<Record<string, KnowledgeDocChunk[]>>({});
	const [loadingChunks, setLoadingChunks] = useState<string | null>(null);

	const [showUpload, setShowUpload] = useState(false);
	const [uploadTitle, setUploadTitle] = useState("");
	const [uploadContent, setUploadContent] = useState("");
	const [uploading, setUploading] = useState(false);

	const appendDraft = useConversationStore((s) => s.appendDraft);
	const closeSettings = useSettingsStore((s) => s.closeSettings);

	const onQuote = (content: string, label: string) => {
		appendDraft(`> [${label}] ${content}`);
		closeSettings();
	};

	const refresh = useCallback(async (filter: string) => {
		setLoading(true);
		try {
			const r = await knowledgeApi.list({ q: filter });
			setDocs(r);
		} catch (err) {
			toast.error(
				err instanceof Error ? err.message : "Failed to load documents",
			);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void refresh("");
	}, [refresh]);

	const docIndex = useMemo(
		() => new Map(docs.map((doc) => [doc.id, doc])),
		[docs],
	);

	const visibleDocs = useMemo(() => {
		const sorted = [...docs];
		if (docSort === "title") {
			sorted.sort((a, b) => a.title.localeCompare(b.title));
		} else if (docSort === "size") {
			sorted.sort((a, b) => b.size_bytes - a.size_bytes);
		}
		return sorted;
	}, [docs, docSort]);

	const onFilterSubmit = () => void refresh(docFilter);

	const onSearch = async () => {
		const q = query.trim();
		if (!q) {
			setResults([]);
			setBackend(null);
			setSearched(false);
			return;
		}
		setSearching(true);
		try {
			const r = await knowledgeApi.search(q, 10);
			setResults(r.results);
			setBackend(r.backend);
			setSearched(true);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Search failed");
		} finally {
			setSearching(false);
		}
	};

	const toggleDoc = async (doc: KnowledgeDoc) => {
		if (expandedDocId === doc.id) {
			setExpandedDocId(null);
			return;
		}
		setExpandedDocId(doc.id);
		if (chunks[doc.id]) return;
		setLoadingChunks(doc.id);
		try {
			const loaded = await knowledgeApi.chunks(doc.id);
			setChunks((current) => ({ ...current, [doc.id]: loaded }));
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to load chunks");
			setExpandedDocId(null);
		} finally {
			setLoadingChunks(null);
		}
	};

	const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;
		try {
			const text = await file.text();
			setUploadTitle((prev) => prev || file.name);
			setUploadContent(text);
			setShowUpload(true);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to read file");
		}
		e.target.value = "";
	};

	const onUpload = async () => {
		const title = uploadTitle.trim();
		const content = uploadContent.trim();
		if (!title || !content) return;
		setUploading(true);
		try {
			await knowledgeApi.ingest({ title, content });
			setUploadTitle("");
			setUploadContent("");
			setShowUpload(false);
			await refresh(docFilter);
			toast.success("Document ingested");
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Ingest failed");
		} finally {
			setUploading(false);
		}
	};

	const onDelete = async (doc: KnowledgeDoc) => {
		if (
			!(await confirm.ask(
				"Delete document",
				`Delete "${doc.title}" and all of its indexed chunks? This cannot be undone.`,
				true,
			))
		)
			return;
		try {
			await knowledgeApi.delete(doc.id);
			setDocs((current) => current.filter((item) => item.id !== doc.id));
			setChunks((current) => {
				const next = { ...current };
				delete next[doc.id];
				return next;
			});
			if (expandedDocId === doc.id) setExpandedDocId(null);
			toast.success("Document deleted");
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Delete failed");
		}
	};

	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center gap-2">
				<div className="relative min-w-56 flex-1">
					<Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
					<input
						autoComplete="off"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						onKeyDown={(e) => e.key === "Enter" && void onSearch()}
						placeholder="Search chunks (Enter)..."
						aria-label="Search knowledge chunks"
						className="w-full rounded-lg border border-border bg-surface-alt py-2 pl-8 pr-3 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50"
					/>
				</div>
				<button
					type="button"
					onClick={() => setShowUpload((s) => !s)}
					className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface-alt px-3 text-xs text-text-secondary hover:bg-surface-hover hover:text-text-primary"
				>
					<Upload className="h-3.5 w-3.5" />
					Add
				</button>
			</div>

			{showUpload && (
				<div className="space-y-2 rounded-lg border border-border bg-surface-alt/40 p-3">
					<input
						autoComplete="off"
						value={uploadTitle}
						onChange={(e) => setUploadTitle(e.target.value)}
						placeholder="Title"
						aria-label="Document title"
						className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50"
					/>
					<textarea
						autoComplete="off"
						value={uploadContent}
						onChange={(e) => setUploadContent(e.target.value)}
						placeholder="Paste document content (text). Will be chunked & indexed."
						aria-label="Document content"
						rows={6}
						className="w-full resize-y rounded-md border border-border bg-surface px-2 py-1.5 font-mono text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50"
					/>
					<div className="flex items-center justify-between gap-2">
						<label className="cursor-pointer text-xs text-text-muted hover:text-text-primary">
							<input
								autoComplete="off"
								type="file"
								accept=".txt,.md,.markdown,text/plain,text/markdown"
								onChange={onPickFile}
								className="hidden"
							/>
							<span className="rounded-md border border-border px-2 py-1">
								Load .txt/.md...
							</span>
						</label>
						<div className="flex gap-2">
							<button
								type="button"
								onClick={() => setShowUpload(false)}
								className="rounded-md px-3 py-1 text-xs text-text-muted hover:text-text-primary"
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={() => void onUpload()}
								disabled={
									uploading || !uploadTitle.trim() || !uploadContent.trim()
								}
								className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1 text-xs text-white hover:bg-accent-hover disabled:opacity-40"
							>
								{uploading && <Loader2 className="h-3 w-3 animate-spin" />}
								Ingest
							</button>
						</div>
					</div>
				</div>
			)}

			{searching && (
				<div className="flex items-center gap-2 text-xs text-text-muted">
					<Loader2 className="h-3 w-3 animate-spin" /> Searching...
				</div>
			)}

			{searched && !searching && (
				<section className="space-y-2">
					<div className="flex items-center justify-between gap-2">
						<h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
							Search results ({results.length})
						</h3>
						{backend && (
							<span className="flex items-center gap-1 text-[10px] text-text-muted">
								<Database className="h-3 w-3" />
								{BACKEND_LABELS[backend]}
							</span>
						)}
					</div>
					{results.length === 0 ? (
						<p className="py-4 text-center text-sm text-text-muted">
							No chunks matched this query.
						</p>
					) : (
						<ul className="space-y-2">
							{results.map((r) => (
								<li
									key={r.id}
									className="group rounded-lg border border-border bg-surface-alt/40 p-3 text-sm"
								>
									<div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-text-muted">
										<span className="min-w-0 truncate">
											{docIndex.get(r.document_id)?.title ?? "Unknown document"}
											{" · "}chunk #{r.chunk_index}
										</span>
										<span className="flex shrink-0 items-center gap-2">
											<span>score {r.score.toFixed(3)}</span>
											<button
												type="button"
												onClick={() =>
													onQuote(
														r.content,
														`knowledge chunk #${r.chunk_index}`,
													)
												}
												aria-label="Quote into chat input"
												title="Quote into chat input"
												className="opacity-0 transition-opacity group-hover:opacity-100 hover:text-accent"
											>
												<Quote className="h-3.5 w-3.5" />
											</button>
										</span>
									</div>
									<p className="whitespace-pre-wrap break-words text-text-primary">
										{r.content}
									</p>
								</li>
							))}
						</ul>
					)}
				</section>
			)}

			<section className="space-y-2">
				<div className="flex flex-wrap items-center gap-2">
					<h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
						Documents ({visibleDocs.length})
					</h3>
					<div className="relative ml-auto min-w-40 flex-1 sm:max-w-64">
						<Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
						<input
							autoComplete="off"
							value={docFilter}
							onChange={(e) => setDocFilter(e.target.value)}
							onKeyDown={(e) => e.key === "Enter" && onFilterSubmit()}
							placeholder="Filter by title (Enter)"
							aria-label="Filter documents by title"
							className="w-full rounded-md border border-border bg-surface-alt py-1.5 pl-8 pr-3 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50"
						/>
					</div>
					<div className="flex shrink-0 items-center gap-0.5 rounded-md border border-border bg-surface-alt p-0.5">
						{DOC_SORTS.map((sort) => (
							<button
								key={sort.id}
								type="button"
								aria-pressed={docSort === sort.id}
								onClick={() => setDocSort(sort.id)}
								className={`rounded px-2 py-1 text-[11px] ${
									docSort === sort.id
										? "bg-selected text-text-primary"
										: "text-text-muted hover:text-text-primary"
								}`}
							>
								{sort.label}
							</button>
						))}
					</div>
				</div>

				{loading && docs.length === 0 ? (
					<ul className="space-y-2" aria-hidden="true">
						{[0, 1, 2].map((row) => (
							<li
								key={row}
								className="h-14 animate-pulse rounded-lg border border-border bg-surface-alt/40"
							/>
						))}
					</ul>
				) : visibleDocs.length === 0 ? (
					<p className="py-6 text-center text-sm text-text-muted">
						{docFilter.trim()
							? "No documents match this title."
							: "No documents yet. Click Add to ingest one."}
					</p>
				) : (
					<ul className="space-y-2">
						{visibleDocs.map((d) => {
							const expanded = expandedDocId === d.id;
							return (
								<li
									key={d.id}
									className="overflow-hidden rounded-lg border border-border bg-surface-alt/40"
								>
									<div className="group flex items-center gap-3 px-3 py-2">
										<button
											type="button"
											onClick={() => void toggleDoc(d)}
											aria-expanded={expanded}
											aria-label={`${expanded ? "Collapse" : "Expand"} ${d.title} chunks`}
											className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-control hover:text-text-primary"
										>
											{expanded ? (
												<ChevronDown className="h-4 w-4" />
											) : (
												<ChevronRight className="h-4 w-4" />
											)}
										</button>
										<FileText className="h-4 w-4 shrink-0 text-text-muted" />
										<div className="min-w-0 flex-1">
											<div className="truncate text-sm font-medium text-text-primary">
												{d.title}
											</div>
											<div className="text-[11px] text-text-muted">
												{d.file_type} · {d.chunk_count} chunks ·{" "}
												{fmtBytes(d.size_bytes)}
												{d.created_at ? ` · ${fmtDate(d.created_at)}` : ""}
											</div>
										</div>
										<button
											type="button"
											onClick={() => void onDelete(d)}
											aria-label={`Delete ${d.title}`}
											title="Delete"
											className="opacity-0 transition-opacity group-hover:opacity-100 hover:text-danger focus-visible:opacity-100"
										>
											<Trash2 className="h-3.5 w-3.5" />
										</button>
									</div>
									{expanded && (
										<div className="border-t border-border bg-surface px-3 py-2">
											{loadingChunks === d.id ? (
												<div className="flex items-center gap-2 py-2 text-xs text-text-muted">
													<Loader2 className="h-3 w-3 animate-spin" />
													Loading chunks...
												</div>
											) : (
												<ol className="space-y-2">
													{(chunks[d.id] ?? []).map((chunk) => (
														<li
															key={chunk.id}
															className="rounded-md border border-border/60 bg-surface-alt/30 p-2"
														>
															<div className="mb-1 flex items-center justify-between gap-2 text-[10px] text-text-muted">
																<span>
																	chunk #{chunk.chunk_index} ·{" "}
																	{chunk.token_count} tokens
																</span>
																<button
																	type="button"
																	onClick={() =>
																		onQuote(
																			chunk.content,
																			`knowledge chunk #${chunk.chunk_index}`,
																		)
																	}
																	aria-label="Quote into chat input"
																	title="Quote into chat input"
																	className="hover:text-accent"
																>
																	<Quote className="h-3 w-3" />
																</button>
															</div>
															<p className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-xs text-text-secondary">
																{chunk.content}
															</p>
														</li>
													))}
												</ol>
											)}
										</div>
									)}
								</li>
							);
						})}
					</ul>
				)}
			</section>
		</div>
	);
}

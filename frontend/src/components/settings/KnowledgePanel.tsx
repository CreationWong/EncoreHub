import { FileText, Loader2, Quote, Search, Trash2, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import {
	type KnowledgeChunk,
	type KnowledgeDoc,
	knowledgeApi,
} from "../../services/knowledge";
import { useConversationStore } from "../../stores/conversationStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { toast } from "../../stores/toastStore";

function fmtBytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function KnowledgePanel() {
	const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
	const [loading, setLoading] = useState(false);

	const [query, setQuery] = useState("");
	const [results, setResults] = useState<KnowledgeChunk[]>([]);
	const [searching, setSearching] = useState(false);

	const [showUpload, setShowUpload] = useState(false);
	const [uploadTitle, setUploadTitle] = useState("");
	const [uploadContent, setUploadContent] = useState("");
	const [uploading, setUploading] = useState(false);

	const setDraft = useConversationStore((s) => s.setDraft);
	const closeSettings = useSettingsStore((s) => s.closeSettings);

	const onQuote = (c: KnowledgeChunk) => {
		setDraft(`> [knowledge chunk #${c.chunk_index}] ${c.content}`);
		closeSettings();
	};

	const refresh = async () => {
		setLoading(true);
		try {
			const r = await knowledgeApi.list();
			setDocs(r);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "load failed");
		} finally {
			setLoading(false);
		}
	};

	// biome-ignore lint/correctness/useExhaustiveDependencies: load on mount
	useEffect(() => {
		refresh();
	}, []);

	const onSearch = async () => {
		const q = query.trim();
		if (!q) {
			setResults([]);
			return;
		}
		setSearching(true);
		try {
			const r = await knowledgeApi.search(q, 10);
			setResults(r.results);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "search failed");
		} finally {
			setSearching(false);
		}
	};

	const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;
		try {
			const text = await file.text();
			setUploadTitle((prev) => prev || file.name);
			setUploadContent(text);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "read failed");
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
			await refresh();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "upload failed");
		} finally {
			setUploading(false);
		}
	};

	const onDelete = async (id: string) => {
		try {
			await knowledgeApi.delete(id);
			setDocs((s) => s.filter((d) => d.id !== id));
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "delete failed");
		}
	};

	return (
		<div className="space-y-4">
			<div className="flex gap-2">
				<div className="relative flex-1">
					<Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
					<input
						autoComplete="off"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						onKeyDown={(e) => e.key === "Enter" && onSearch()}
						placeholder="Search chunks (Enter)..."
						className="w-full rounded-lg border border-border bg-surface-alt py-2 pl-8 pr-3 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50"
					/>
				</div>
				<button
					type="button"
					onClick={() => setShowUpload((s) => !s)}
					className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-alt px-3 text-xs text-text-secondary hover:bg-surface-hover hover:text-text-primary"
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
						className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
					/>
					<textarea
						autoComplete="off"
						value={uploadContent}
						onChange={(e) => setUploadContent(e.target.value)}
						placeholder="Paste document content (text). Will be chunked & indexed."
						rows={6}
						className="w-full resize-y rounded-md border border-border bg-surface px-2 py-1.5 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-accent/50"
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
								onClick={onUpload}
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

			{results.length > 0 && (
				<section className="space-y-2">
					<h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
						Search results ({results.length})
					</h3>
					<ul className="space-y-2">
						{results.map((r) => (
							<li
								key={r.id}
								className="group rounded-lg border border-border bg-surface-alt/40 p-3 text-sm"
							>
								<div className="mb-1 flex items-center justify-between text-[11px] text-text-muted">
									<span>chunk #{r.chunk_index}</span>
									<span className="flex items-center gap-2">
										<span>score {r.score.toFixed(3)}</span>
										<button
											type="button"
											onClick={() => onQuote(r)}
											aria-label="Quote into chat input"
											className="opacity-0 transition-opacity group-hover:opacity-100 hover:text-accent"
											title="Quote into chat input"
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
				</section>
			)}

			<section className="space-y-2">
				<h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
					Documents ({docs.length})
				</h3>
				{loading && docs.length === 0 ? (
					<div className="flex items-center justify-center py-8 text-text-muted">
						<Loader2 className="h-4 w-4 animate-spin" />
					</div>
				) : docs.length === 0 ? (
					<p className="py-6 text-center text-sm text-text-muted">
						No documents yet. Click Add to ingest one.
					</p>
				) : (
					<ul className="space-y-2">
						{docs.map((d) => (
							<li
								key={d.id}
								className="group flex items-center gap-3 rounded-lg border border-border bg-surface-alt/40 px-3 py-2"
							>
								<FileText className="h-4 w-4 shrink-0 text-text-muted" />
								<div className="min-w-0 flex-1">
									<div className="truncate text-sm font-medium text-text-primary">
										{d.title}
									</div>
									<div className="text-[11px] text-text-muted">
										{d.file_type} · {d.chunk_count} chunks ·{" "}
										{fmtBytes(d.size_bytes)}
									</div>
								</div>
								<button
									type="button"
									onClick={() => onDelete(d.id)}
									aria-label="Delete document"
									className="opacity-0 transition-opacity group-hover:opacity-100 hover:text-danger"
									title="Delete"
								>
									<Trash2 className="h-3.5 w-3.5" />
								</button>
							</li>
						))}
					</ul>
				)}
			</section>
		</div>
	);
}

import { Loader2, Quote, Search, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { type Memory, memoriesApi } from "../../services/memories";
import { useConversationStore } from "../../stores/conversationStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { toast } from "../../stores/toastStore";

const SCOPES = [
	{ id: "", label: "All" },
	{ id: "global", label: "Global" },
	{ id: "conversation", label: "Conversation" },
];

export default function MemoryPanel() {
	const [items, setItems] = useState<Memory[]>([]);
	const [scope, setScope] = useState("");
	const [query, setQuery] = useState("");
	const [loading, setLoading] = useState(false);

	const setDraft = useConversationStore((s) => s.setDraft);
	const closeSettings = useSettingsStore((s) => s.closeSettings);

	const onQuote = (m: Memory) => {
		setDraft(`> [memory] ${m.content}`);
		closeSettings();
	};

	const load = async (q: string, scopeFilter: string) => {
		setLoading(true);
		try {
			if (q.trim()) {
				const r = await memoriesApi.search({
					q: q.trim(),
					scope: scopeFilter || undefined,
					top_k: 30,
				});
				setItems(r.results);
			} else {
				const r = await memoriesApi.list(scopeFilter || undefined);
				setItems(r.memories);
			}
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "load failed");
		} finally {
			setLoading(false);
		}
	};

	// biome-ignore lint/correctness/useExhaustiveDependencies: load on mount + scope change
	useEffect(() => {
		load(query, scope);
	}, [scope]);

	const onSearchKey = (e: React.KeyboardEvent) => {
		if (e.key === "Enter") load(query, scope);
	};

	const onDelete = async (id: string) => {
		try {
			await memoriesApi.delete(id);
			setItems((s) => s.filter((m) => m.id !== id));
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
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						onKeyDown={onSearchKey}
						placeholder="Search memories (Enter)..."
						className="w-full rounded-lg border border-border bg-surface-alt py-2 pl-8 pr-3 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50"
					/>
				</div>
				<select
					value={scope}
					onChange={(e) => setScope(e.target.value)}
					className="rounded-lg border border-border bg-surface-alt px-2 text-sm text-text-secondary focus:outline-none focus:ring-2 focus:ring-accent/50"
				>
					{SCOPES.map((s) => (
						<option key={s.id} value={s.id}>
							{s.label}
						</option>
					))}
				</select>
			</div>

			{loading && (
				<div className="flex items-center justify-center py-10 text-text-muted">
					<Loader2 className="h-4 w-4 animate-spin" />
				</div>
			)}

			{!loading && items.length === 0 && (
				<p className="py-10 text-center text-sm text-text-muted">
					No memories yet.
				</p>
			)}

			<ul className="space-y-2">
				{items.map((m) => (
					<li
						key={m.id}
						className="group rounded-lg border border-border bg-surface-alt/40 p-3"
					>
						<div className="mb-1 flex items-center justify-between text-[11px] text-text-muted">
							<span className="flex items-center gap-1.5">
								<span className="rounded bg-surface-hover px-1.5 py-0.5 font-mono uppercase">
									{m.scope}
								</span>
								<span>{m.memory_type}</span>
								<span>· importance {m.importance.toFixed(2)}</span>
							</span>
							<span className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
								<button
									type="button"
									onClick={() => onQuote(m)}
									aria-label="Quote into chat input"
									className="text-text-muted hover:text-accent"
									title="Quote into chat input"
								>
									<Quote className="h-3.5 w-3.5" />
								</button>
								<button
									type="button"
									onClick={() => onDelete(m.id)}
									aria-label="Delete memory"
									className="text-text-muted hover:text-danger"
									title="Delete"
								>
									<Trash2 className="h-3.5 w-3.5" />
								</button>
							</span>
						</div>
						<p className="whitespace-pre-wrap break-words text-sm text-text-primary">
							{m.content}
						</p>
					</li>
				))}
			</ul>
		</div>
	);
}

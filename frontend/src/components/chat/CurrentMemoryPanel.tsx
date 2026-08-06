import {
	BrainCircuit,
	ExternalLink,
	Loader2,
	Quote,
	RefreshCw,
	Search,
	Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DEFAULT_CHARACTER_ID } from "../../services/characters";
import {
	type Memory,
	type MemoryGroup,
	memoriesApi,
} from "../../services/memories";
import { confirm } from "../../stores/confirmStore";
import { useConversationStore } from "../../stores/conversationStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { toast } from "../../stores/toastStore";

const STATE_LABELS: Record<Memory["state"], string> = {
	transient: "Transient",
	short_term: "Short-term",
	long_term: "Long-term",
	permanent_candidate: "Candidate",
	permanent: "Permanent",
	forgotten: "Forgotten",
};

function formatDate(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "Unknown date";
	return new Intl.DateTimeFormat(undefined, {
		month: "short",
		day: "numeric",
	}).format(date);
}

export default function CurrentMemoryPanel() {
	const activeId = useConversationStore((state) => state.activeId);
	const conversations = useConversationStore((state) => state.conversations);
	const setDraft = useConversationStore((state) => state.setDraft);
	const openSettings = useSettingsStore((state) => state.openSettings);
	const [memories, setMemories] = useState<Memory[]>([]);
	const [groups, setGroups] = useState<MemoryGroup[]>([]);
	const [query, setQuery] = useState("");
	const [groupId, setGroupId] = useState("");
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const conversation = conversations.find((item) => item.id === activeId);
	const characterId = conversation?.character_id ?? DEFAULT_CHARACTER_ID;

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const [memoryResponse, groupResponse] = await Promise.all([
				memoriesApi.list({ character_id: characterId }),
				memoriesApi.listGroups(),
			]);
			setMemories(memoryResponse.memories);
			setGroups(groupResponse.groups);
		} catch (loadError) {
			setError(
				loadError instanceof Error
					? loadError.message
					: "Failed to load current memories",
			);
		} finally {
			setLoading(false);
		}
	}, [characterId]);

	useEffect(() => {
		void load();
	}, [load]);

	const groupNames = useMemo(
		() => new Map(groups.map((group) => [group.id, group.name])),
		[groups],
	);
	const visibleGroups = useMemo(() => {
		const ids = new Set(memories.map((memory) => memory.group_id));
		return groups.filter((group) => ids.has(group.id));
	}, [groups, memories]);
	const filteredMemories = useMemo(() => {
		const normalizedQuery = query.trim().toLocaleLowerCase();
		return memories.filter(
			(memory) =>
				(!groupId || memory.group_id === groupId) &&
				(!normalizedQuery ||
					memory.content.toLocaleLowerCase().includes(normalizedQuery) ||
					memory.kind.toLocaleLowerCase().includes(normalizedQuery) ||
					(groupNames.get(memory.group_id) ?? "")
						.toLocaleLowerCase()
						.includes(normalizedQuery)),
		);
	}, [groupId, groupNames, memories, query]);

	const deleteMemory = async (memory: Memory) => {
		if (
			!(await confirm.ask(
				"Delete memory",
				"Remove this memory from the current character? This cannot be undone.",
				true,
			))
		)
			return;
		try {
			await memoriesApi.delete(memory.id);
			setMemories((current) => current.filter((item) => item.id !== memory.id));
			toast.success("Memory deleted");
		} catch (deleteError) {
			toast.error(
				deleteError instanceof Error ? deleteError.message : "Delete failed",
			);
		}
	};

	return (
		<div
			role="tabpanel"
			aria-label="Memory"
			className="flex min-h-0 flex-1 flex-col"
		>
			<section className="shrink-0 border-b border-border px-3 py-3">
				<div className="flex items-center justify-between gap-3">
					<div className="min-w-0">
						<h2 className="truncate text-xs font-semibold text-text-primary">
							Current character memory
						</h2>
						<p className="mt-0.5 text-[10px] text-text-muted">
							{memories.length} available{" "}
							{memories.length === 1 ? "memory" : "memories"}
						</p>
					</div>
					<button
						type="button"
						onClick={() => void load()}
						disabled={loading}
						aria-label="Refresh current memories"
						title="Refresh current memories"
						className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-control hover:text-text-primary disabled:opacity-50"
					>
						<RefreshCw
							className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
						/>
					</button>
				</div>

				<div className="relative mt-3">
					<Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
					<input
						type="search"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						aria-label="Search current memories"
						placeholder="Search memories"
						className="h-8 w-full rounded-md border border-border bg-surface pl-8 pr-2 text-xs text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
					/>
				</div>
				<select
					value={groupId}
					onChange={(event) => setGroupId(event.target.value)}
					aria-label="Memory group filter"
					className="mt-2 h-8 w-full rounded-md border border-border bg-surface px-2 text-xs text-text-secondary outline-none focus:border-accent"
				>
					<option value="">All visible groups</option>
					{visibleGroups.map((group) => (
						<option key={group.id} value={group.id}>
							{group.name}
						</option>
					))}
				</select>
			</section>

			<div className="min-h-0 flex-1 overflow-y-auto">
				{loading ? (
					<div
						className="flex h-40 items-center justify-center"
						aria-label="Loading current memories"
					>
						<Loader2 className="h-5 w-5 animate-spin text-text-muted" />
					</div>
				) : error ? (
					<div className="px-4 py-8 text-center">
						<p className="text-xs text-danger">{error}</p>
						<button
							type="button"
							onClick={() => void load()}
							className="mt-3 h-8 rounded-md border border-border px-3 text-xs text-text-secondary hover:bg-control"
						>
							Try again
						</button>
					</div>
				) : filteredMemories.length === 0 ? (
					<div className="flex min-h-48 flex-col items-center justify-center px-8 text-center">
						<BrainCircuit className="h-6 w-6 text-text-muted" />
						<p className="mt-3 text-xs font-medium text-text-primary">
							{memories.length === 0
								? "No memories yet"
								: "No matching memories"}
						</p>
						<p className="mt-1 text-[11px] leading-4 text-text-muted">
							{memories.length === 0
								? "Memories approved for this character will appear here."
								: "Try another search or memory group."}
						</p>
					</div>
				) : (
					<ul className="divide-y divide-border">
						{filteredMemories.map((memory) => (
							<li
								key={memory.id}
								className="group px-3 py-3 hover:bg-surface-hover"
							>
								<div className="flex items-start justify-between gap-2">
									<div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[10px]">
										<span className="max-w-32 truncate font-medium text-text-secondary">
											{groupNames.get(memory.group_id) ?? "Memory group"}
										</span>
										<span className="rounded bg-control px-1.5 py-0.5 text-text-muted">
											{STATE_LABELS[memory.state]}
										</span>
										<span className="capitalize text-text-muted">
											{memory.kind}
										</span>
									</div>
									<div className="flex shrink-0 items-center gap-0.5">
										<button
											type="button"
											onClick={() => setDraft(`> [memory] ${memory.content}`)}
											aria-label="Quote memory"
											title="Quote in message"
											className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-control hover:text-text-primary"
										>
											<Quote className="h-3.5 w-3.5" />
										</button>
										<button
											type="button"
											onClick={() => void deleteMemory(memory)}
											aria-label="Delete memory"
											title="Delete memory"
											className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-danger/10 hover:text-danger"
										>
											<Trash2 className="h-3.5 w-3.5" />
										</button>
									</div>
								</div>
								<p className="mt-2 whitespace-pre-wrap text-[11px] leading-5 text-text-primary">
									{memory.content}
								</p>
								<p className="mt-1.5 text-[10px] text-text-muted">
									Importance {Math.round(memory.importance * 100)}% ·{" "}
									{formatDate(memory.created_at)}
								</p>
							</li>
						))}
					</ul>
				)}
			</div>

			<footer className="shrink-0 border-t border-border p-2">
				<button
					type="button"
					onClick={() => openSettings("memories")}
					className="flex h-9 w-full items-center justify-center gap-2 rounded-md text-xs font-medium text-text-secondary hover:bg-control hover:text-text-primary"
				>
					<ExternalLink className="h-3.5 w-3.5" />
					Manage all memory
				</button>
			</footer>
		</div>
	);
}

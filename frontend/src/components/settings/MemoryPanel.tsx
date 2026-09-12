// Memory settings workspace for role modes, group inheritance, and review.
//
// The Engine is authoritative for memory state and group policy; this panel
// only stages role configuration (saved explicitly) and offers scoped review
// with filters, edits, and archived-group management.

import {
	ArchiveRestore,
	Bot,
	Check,
	Folder,
	Globe2,
	Loader2,
	Pencil,
	Plus,
	Quote,
	Save,
	Search,
	Trash2,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
	type CharacterProfile,
	listCharacters,
} from "../../services/characters";
import {
	type CharacterMemorySettingsResponse,
	type Memory,
	type MemoryGroup,
	type MemoryGroupInheritance,
	type MemoryKind,
	type MemoryMode,
	type MemoryState,
	memoriesApi,
} from "../../services/memories";
import { confirm } from "../../stores/confirmStore";
import { useConversationStore } from "../../stores/conversationStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { toast } from "../../stores/toastStore";

const MODE_OPTIONS: Array<{ id: MemoryMode; label: string }> = [
	{ id: "simple", label: "Simple" },
	{ id: "rag", label: "RAG" },
	{ id: "rag_enhanced", label: "RAG enhanced" },
	{ id: "realistic", label: "Realistic" },
];

const GROUP_TYPE_LABELS: Record<MemoryGroup["group_type"], string> = {
	character: "Character",
	global: "Global",
	custom: "Custom",
};

const STATE_OPTIONS: MemoryState[] = [
	"transient",
	"short_term",
	"long_term",
	"permanent_candidate",
	"permanent",
	"forgotten",
];

const KIND_OPTIONS: MemoryKind[] = [
	"fact",
	"preference",
	"event",
	"instruction",
	"summary",
];

type MemorySort = "recent" | "importance" | "created";

const SORT_OPTIONS: { id: MemorySort; label: string }[] = [
	{ id: "recent", label: "Recent" },
	{ id: "importance", label: "Importance" },
	{ id: "created", label: "Created" },
];

function policySignature(
	value: CharacterMemorySettingsResponse | null,
): string {
	if (!value) return "";
	return JSON.stringify({
		defaultMode: value.settings.default_mode,
		realisticEnabled: value.settings.realistic_enabled,
		inheritedGroups: value.inherited_groups,
	});
}

function fmtDate(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "";
	return new Intl.DateTimeFormat(undefined, {
		month: "short",
		day: "numeric",
	}).format(date);
}

function GroupIcon({ type }: { type: MemoryGroup["group_type"] }) {
	if (type === "global") return <Globe2 className="h-3.5 w-3.5" />;
	if (type === "custom") return <Folder className="h-3.5 w-3.5" />;
	return <Bot className="h-3.5 w-3.5" />;
}

export default function MemoryPanel() {
	const [items, setItems] = useState<Memory[]>([]);
	const [groups, setGroups] = useState<MemoryGroup[]>([]);
	const [characters, setCharacters] = useState<CharacterProfile[]>([]);
	const [selectedGroupId, setSelectedGroupId] = useState("");
	const [policyCharacterId, setPolicyCharacterId] = useState("");
	const [policy, setPolicy] = useState<CharacterMemorySettingsResponse | null>(
		null,
	);
	const [savedPolicySignature, setSavedPolicySignature] = useState("");
	const [query, setQuery] = useState("");
	const [stateFilter, setStateFilter] = useState<MemoryState | "">("");
	const [kindFilter, setKindFilter] = useState<MemoryKind | "">("");
	const [sort, setSort] = useState<MemorySort>("recent");
	const [showArchived, setShowArchived] = useState(false);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
	const [groupNameDraft, setGroupNameDraft] = useState("");
	const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null);
	const [memoryDraft, setMemoryDraft] = useState("");

	const appendDraft = useConversationStore((state) => state.appendDraft);
	const closeSettings = useSettingsStore((state) => state.closeSettings);

	const characterNames = useMemo(
		() =>
			new Map(characters.map((character) => [character.id, character.name])),
		[characters],
	);
	const selectedGroup = groups.find((group) => group.id === selectedGroupId);

	const loadMemories = useCallback(
		async (
			q: string,
			groupId: string,
			state: MemoryState | "",
			kind: MemoryKind | "",
		) => {
			setLoading(true);
			try {
				if (q.trim()) {
					const response = await memoriesApi.search({
						q: q.trim(),
						group_id: groupId || undefined,
						top_k: 30,
					});
					// Search ranks by vector distance, so relational filters are
					// applied client-side to keep both paths consistent.
					setItems(
						response.results.filter(
							(memory) =>
								(!state || memory.state === state) &&
								(!kind || memory.kind === kind),
						),
					);
				} else {
					const response = await memoriesApi.list({
						group_id: groupId || undefined,
						state: state || undefined,
						kind: kind || undefined,
					});
					setItems(response.memories);
				}
			} catch (error) {
				toast.error(
					error instanceof Error ? error.message : "Failed to load memories",
				);
			} finally {
				setLoading(false);
			}
		},
		[],
	);

	const loadGroups = useCallback(async (includeArchived: boolean) => {
		try {
			const response = await memoriesApi.listGroups({ includeArchived });
			setGroups(response.groups);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to load memory groups",
			);
		}
	}, []);

	useEffect(() => {
		let cancelled = false;
		Promise.all([memoriesApi.listGroups(), listCharacters()])
			.then(([groupResponse, characterResponse]) => {
				if (cancelled) return;
				setGroups(groupResponse.groups);
				setCharacters(characterResponse.characters);
				const firstCharacter = characterResponse.characters[0];
				const firstCharacterGroup = groupResponse.groups.find(
					(group) => group.owner_character_id === firstCharacter?.id,
				);
				setPolicyCharacterId(firstCharacter?.id ?? "");
				setSelectedGroupId(
					firstCharacterGroup?.id ?? groupResponse.groups[0]?.id ?? "",
				);
			})
			.catch((error) => {
				if (!cancelled)
					toast.error(
						error instanceof Error
							? error.message
							: "Failed to load memory groups",
					);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	// Reload whenever the selected group or relational filters change.
	useEffect(() => {
		void loadMemories("", selectedGroupId, stateFilter, kindFilter);
	}, [loadMemories, selectedGroupId, stateFilter, kindFilter]);

	useEffect(() => {
		if (!policyCharacterId) {
			setPolicy(null);
			setSavedPolicySignature("");
			return;
		}
		let cancelled = false;
		memoriesApi
			.getCharacterSettings(policyCharacterId)
			.then((response) => {
				if (!cancelled) {
					setPolicy(response);
					setSavedPolicySignature(policySignature(response));
				}
			})
			.catch((error) => {
				if (!cancelled)
					toast.error(
						error instanceof Error
							? error.message
							: "Failed to load character memory settings",
					);
			});
		return () => {
			cancelled = true;
		};
	}, [policyCharacterId]);

	const updatePolicy = (
		update: (
			value: CharacterMemorySettingsResponse,
		) => CharacterMemorySettingsResponse,
	) => setPolicy((current) => (current ? update(current) : current));

	const toggleInheritedGroup = (groupId: string, checked: boolean) => {
		updatePolicy((current) => {
			const inherited = checked
				? [
						...current.inherited_groups,
						{
							character_id: current.settings.character_id,
							group_id: groupId,
							access_mode: "read" as const,
							priority: current.inherited_groups.length,
						},
					]
				: current.inherited_groups.filter(
						(entry) => entry.group_id !== groupId,
					);
			return { ...current, inherited_groups: inherited };
		});
	};

	const setInheritedAccess = (
		groupId: string,
		accessMode: MemoryGroupInheritance["access_mode"],
	) =>
		updatePolicy((current) => ({
			...current,
			inherited_groups: current.inherited_groups.map((entry) =>
				entry.group_id === groupId
					? { ...entry, access_mode: accessMode }
					: entry,
			),
		}));

	const savePolicy = async () => {
		if (!policy) return;
		setSaving(true);
		try {
			const response = await memoriesApi.updateCharacterSettings(
				policy.settings.character_id,
				{
					default_mode: policy.settings.default_mode,
					realistic_enabled: policy.settings.realistic_enabled,
					inherited_groups: policy.inherited_groups,
				},
			);
			setPolicy(response);
			setSavedPolicySignature(policySignature(response));
			toast.success("Character memory settings saved");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to save settings",
			);
		} finally {
			setSaving(false);
		}
	};

	const onDelete = async (memory: Memory) => {
		if (
			!(await confirm.ask(
				"Delete memory",
				`Delete this memory? This cannot be undone.\n\n${memory.content.slice(0, 160)}`,
				true,
			))
		)
			return;
		try {
			await memoriesApi.delete(memory.id);
			setItems((current) => current.filter((item) => item.id !== memory.id));
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Delete failed");
		}
	};

	const saveMemory = async (memory: Memory) => {
		const content = memoryDraft.trim();
		if (!content || content === memory.content) {
			setEditingMemoryId(null);
			return;
		}
		try {
			const updated = await memoriesApi.update(memory.id, { content });
			setItems((current) =>
				current.map((item) => (item.id === updated.id ? updated : item)),
			);
			setEditingMemoryId(null);
			toast.success("Memory updated");
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Update failed");
		}
	};

	const beginCreateGroup = () => {
		setEditingGroupId("new");
		setGroupNameDraft("");
	};

	const beginRenameGroup = (group: MemoryGroup) => {
		setEditingGroupId(group.id);
		setGroupNameDraft(group.name);
	};

	const saveGroup = async () => {
		const name = groupNameDraft.trim();
		if (!name) return;
		try {
			if (editingGroupId === "new") {
				const group = await memoriesApi.createGroup(name);
				setGroups((current) => [...current, group]);
				setSelectedGroupId(group.id);
			} else if (editingGroupId) {
				const group = await memoriesApi.updateGroup(editingGroupId, { name });
				setGroups((current) =>
					current.map((item) => (item.id === group.id ? group : item)),
				);
			}
			setEditingGroupId(null);
			setGroupNameDraft("");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to save group",
			);
		}
	};

	const archiveGroup = async (group: MemoryGroup) => {
		if (!(await confirm.ask("Archive memory group", `Archive ${group.name}?`)))
			return;
		try {
			await memoriesApi.updateGroup(group.id, { archived: true });
			await loadGroups(showArchived);
			if (selectedGroupId === group.id) setSelectedGroupId("");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to archive group",
			);
		}
	};

	const restoreGroup = async (group: MemoryGroup) => {
		try {
			await memoriesApi.updateGroup(group.id, { archived: false });
			await loadGroups(showArchived);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to restore group",
			);
		}
	};

	const deleteGroup = async (group: MemoryGroup) => {
		if (
			!(await confirm.ask(
				"Delete memory group",
				`Delete ${group.name} and all memories in it? This cannot be undone.`,
				true,
			))
		)
			return;
		try {
			await memoriesApi.deleteGroup(group.id, { strategy: "delete_memories" });
			setGroups((current) => current.filter((item) => item.id !== group.id));
			setItems((current) =>
				current.filter((item) => item.group_id !== group.id),
			);
			if (selectedGroupId === group.id) setSelectedGroupId("");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to delete group",
			);
		}
	};

	const sortedItems = useMemo(() => {
		const copy = [...items];
		if (sort === "importance") {
			copy.sort((a, b) => b.importance - a.importance);
		} else if (sort === "created") {
			copy.sort(
				(a, b) =>
					new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
			);
		}
		return copy;
	}, [items, sort]);

	const characterGroups = groups.filter(
		(group) => group.group_type === "character" && !group.archived_at,
	);
	const globalGroups = groups.filter(
		(group) => group.group_type === "global" && !group.archived_at,
	);
	const customGroups = groups.filter(
		(group) => group.group_type === "custom" && !group.archived_at,
	);
	const archivedGroups = groups.filter((group) => group.archived_at);
	const inheritableGroups = groups.filter(
		(group) =>
			!group.archived_at &&
			group.group_type !== "global" &&
			group.owner_character_id !== policyCharacterId,
	);
	const policyDirty = Boolean(
		policy && policySignature(policy) !== savedPolicySignature,
	);

	return (
		<div className="relative flex h-full min-h-0 overflow-hidden bg-surface max-[700px]:flex-col">
			<aside className="flex w-60 shrink-0 flex-col border-r border-border bg-surface-alt max-[900px]:w-48 max-[700px]:max-h-52 max-[700px]:w-full max-[700px]:border-b max-[700px]:border-r-0">
				<div className="min-h-0 flex-1 overflow-y-auto p-2">
					<GroupSection
						label="By character"
						groups={characterGroups}
						selectedId={selectedGroupId}
						onSelect={setSelectedGroupId}
						characterNames={characterNames}
					/>
					<GroupSection
						label="Global"
						groups={globalGroups}
						selectedId={selectedGroupId}
						onSelect={setSelectedGroupId}
						characterNames={characterNames}
					/>
					<GroupSection
						label="Custom"
						groups={customGroups}
						selectedId={selectedGroupId}
						onSelect={setSelectedGroupId}
						characterNames={characterNames}
						editingId={editingGroupId}
						groupNameDraft={groupNameDraft}
						onGroupNameDraftChange={setGroupNameDraft}
						onSaveGroup={() => void saveGroup()}
						onCancelGroup={() => setEditingGroupId(null)}
						onRename={beginRenameGroup}
						onArchive={archiveGroup}
						onDelete={deleteGroup}
					/>
					{editingGroupId === "new" && (
						<GroupNameEditor
							value={groupNameDraft}
							onChange={setGroupNameDraft}
							onSave={() => void saveGroup()}
							onCancel={() => setEditingGroupId(null)}
						/>
					)}
					{(archivedGroups.length > 0 || showArchived) && (
						<div className="mb-4">
							<button
								type="button"
								onClick={() => {
									const next = !showArchived;
									setShowArchived(next);
									void loadGroups(next);
								}}
								aria-pressed={showArchived}
								className="mb-1.5 flex w-full items-center justify-between px-2 text-[10px] font-semibold uppercase text-text-muted hover:text-text-primary"
							>
								<span>Archived ({archivedGroups.length})</span>
								<ArchiveRestore className="h-3 w-3" />
							</button>
							{showArchived &&
								archivedGroups.map((group) => (
									<div
										key={group.id}
										className="mb-1 flex min-h-11 items-center gap-2 rounded-md border border-transparent px-2.5 py-2 text-xs text-text-muted"
									>
										<GroupIcon type={group.group_type} />
										<span className="min-w-0 flex-1 truncate">
											{group.name}
										</span>
										<button
											type="button"
											onClick={() => void restoreGroup(group)}
											aria-label={`Restore ${group.name}`}
											title="Restore group"
											className="hover:text-success"
										>
											<ArchiveRestore className="h-3.5 w-3.5" />
										</button>
										<button
											type="button"
											onClick={() => void deleteGroup(group)}
											aria-label={`Delete ${group.name}`}
											title="Delete group"
											className="hover:text-danger"
										>
											<Trash2 className="h-3.5 w-3.5" />
										</button>
									</div>
								))}
						</div>
					)}
				</div>
				<div className="border-t border-border p-2">
					<button
						type="button"
						onClick={beginCreateGroup}
						title="Create group"
						className="flex h-9 w-full items-center justify-center gap-2 rounded-md border border-border bg-surface text-sm text-text-secondary hover:bg-surface-hover hover:text-text-primary"
					>
						<Plus className="h-4 w-4" />
						Add memory group
					</button>
				</div>
			</aside>

			<main className="flex min-w-0 flex-1 flex-col">
				<section
					className="shrink-0 border-b border-border px-5 py-4"
					aria-label="Character memory settings"
				>
					<h3 className="mb-3 text-sm font-semibold text-text-primary">
						Character memory policy
					</h3>
					<div className="grid gap-4 sm:grid-cols-2">
						<label className="min-w-0">
							<span className="mb-1.5 block text-xs font-medium text-text-secondary">
								Character
							</span>
							<select
								value={policyCharacterId}
								onChange={(event) => setPolicyCharacterId(event.target.value)}
								className="h-9 w-full rounded-md border border-border bg-control px-3 text-sm text-text-primary outline-none focus:border-accent"
							>
								{characters.map((character) => (
									<option key={character.id} value={character.id}>
										{character.name}
									</option>
								))}
							</select>
						</label>
						<label className="min-w-0">
							<span className="mb-1.5 block text-xs font-medium text-text-secondary">
								Default mode
							</span>
							<select
								value={policy?.settings.default_mode ?? "simple"}
								onChange={(event) =>
									updatePolicy((current) => ({
										...current,
										settings: {
											...current.settings,
											default_mode: event.target.value as MemoryMode,
										},
									}))
								}
								className="h-9 w-full rounded-md border border-border bg-control px-3 text-sm text-text-primary outline-none focus:border-accent"
							>
								{MODE_OPTIONS.map((mode) => (
									<option key={mode.id} value={mode.id}>
										{mode.label}
									</option>
								))}
							</select>
						</label>
					</div>
					<div className="mt-3 flex items-center justify-between gap-4 border-t border-border pt-3">
						<div className="min-w-0">
							<p className="text-xs font-medium text-text-primary">
								Realistic memory
							</p>
							<p className="mt-0.5 text-[11px] leading-4 text-text-muted">
								Store new memories as transient instead of long-term. Required
								by the Realistic mode.
							</p>
						</div>
						<button
							type="button"
							role="switch"
							aria-checked={policy?.settings.realistic_enabled ?? false}
							aria-label="Realistic memory"
							onClick={() =>
								updatePolicy((current) => ({
									...current,
									settings: {
										...current.settings,
										realistic_enabled: !current.settings.realistic_enabled,
									},
								}))
							}
							className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
								policy?.settings.realistic_enabled ? "bg-accent" : "bg-control"
							}`}
						>
							<span
								aria-hidden="true"
								className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
									policy?.settings.realistic_enabled
										? "translate-x-5"
										: "translate-x-1"
								}`}
							/>
						</button>
					</div>
					{policy && inheritableGroups.length > 0 && (
						<div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-border pt-3">
							{inheritableGroups.map((group) => {
								const entry = policy.inherited_groups.find(
									(item) => item.group_id === group.id,
								);
								return (
									<div
										key={group.id}
										className="flex h-8 items-center gap-2 text-xs"
									>
										<input
											type="checkbox"
											autoComplete="off"
											checked={Boolean(entry)}
											onChange={(event) =>
												toggleInheritedGroup(group.id, event.target.checked)
											}
										/>
										<span className="max-w-36 truncate text-text-secondary">
											{group.name}
										</span>
										{entry && (
											<select
												aria-label={`${group.name} access`}
												value={entry.access_mode}
												onChange={(event) =>
													setInheritedAccess(
														group.id,
														event.target
															.value as MemoryGroupInheritance["access_mode"],
													)
												}
												className="h-7 rounded-md border border-border bg-control px-2 text-[11px] text-text-primary"
											>
												<option value="read">Read</option>
												<option value="read_write">Read/write</option>
											</select>
										)}
									</div>
								);
							})}
						</div>
					)}
				</section>

				<header className="shrink-0 space-y-2 border-b border-border px-5 py-3">
					<div className="flex items-center gap-3">
						<div className="min-w-0 flex-1">
							<h3 className="truncate text-base font-semibold text-text-primary">
								{selectedGroup?.name ?? "All memories"}
							</h3>
							<p className="text-xs text-text-muted">
								{selectedGroup
									? GROUP_TYPE_LABELS[selectedGroup.group_type]
									: "All groups"}{" "}
								· {sortedItems.length} memories
							</p>
						</div>
						<div className="relative w-64 max-w-[45%] shrink-0">
							<Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
							<input
								autoComplete="off"
								value={query}
								onChange={(event) => setQuery(event.target.value)}
								onKeyDown={(event) => {
									if (event.key === "Enter")
										void loadMemories(
											query,
											selectedGroupId,
											stateFilter,
											kindFilter,
										);
									if (event.key === "Escape" && query) {
										setQuery("");
										void loadMemories(
											"",
											selectedGroupId,
											stateFilter,
											kindFilter,
										);
									}
								}}
								placeholder="Search memories"
								aria-label="Search memories"
								className="h-9 w-full rounded-md border border-border bg-surface pl-9 pr-8 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
							/>
							{query && (
								<button
									type="button"
									onClick={() => {
										setQuery("");
										void loadMemories(
											"",
											selectedGroupId,
											stateFilter,
											kindFilter,
										);
									}}
									aria-label="Clear memory search"
									title="Clear search"
									className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
								>
									<X className="h-3.5 w-3.5" />
								</button>
							)}
						</div>
					</div>
					<div className="flex flex-wrap items-center gap-2 text-xs">
						<label className="flex items-center gap-1.5 text-text-muted">
							State
							<select
								value={stateFilter}
								onChange={(event) =>
									setStateFilter(event.target.value as MemoryState | "")
								}
								aria-label="Filter by state"
								className="h-7 rounded-md border border-border bg-control px-2 text-[11px] text-text-primary"
							>
								<option value="">All</option>
								{STATE_OPTIONS.map((state) => (
									<option key={state} value={state}>
										{state}
									</option>
								))}
							</select>
						</label>
						<label className="flex items-center gap-1.5 text-text-muted">
							Kind
							<select
								value={kindFilter}
								onChange={(event) =>
									setKindFilter(event.target.value as MemoryKind | "")
								}
								aria-label="Filter by kind"
								className="h-7 rounded-md border border-border bg-control px-2 text-[11px] text-text-primary"
							>
								<option value="">All</option>
								{KIND_OPTIONS.map((kind) => (
									<option key={kind} value={kind}>
										{kind}
									</option>
								))}
							</select>
						</label>
						<label className="ml-auto flex items-center gap-1.5 text-text-muted">
							Sort
							<select
								value={sort}
								onChange={(event) => setSort(event.target.value as MemorySort)}
								aria-label="Sort memories"
								className="h-7 rounded-md border border-border bg-control px-2 text-[11px] text-text-primary"
							>
								{SORT_OPTIONS.map((option) => (
									<option key={option.id} value={option.id}>
										{option.label}
									</option>
								))}
							</select>
						</label>
					</div>
				</header>

				<div className="min-h-0 flex-1 overflow-y-auto">
					{loading ? (
						<div className="flex min-h-48 items-center justify-center text-text-muted">
							<Loader2 className="h-4 w-4 animate-spin" />
						</div>
					) : sortedItems.length === 0 ? (
						<p className="flex min-h-48 items-center justify-center text-sm text-text-muted">
							{query.trim() || stateFilter || kindFilter
								? "No memories match the current filters."
								: "No memories in this group."}
						</p>
					) : (
						<ul className="divide-y divide-border">
							{sortedItems.map((memory) => (
								<li
									key={memory.id}
									className="group px-5 py-3 hover:bg-surface-hover/40"
								>
									<div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-text-muted">
										<span className="flex min-w-0 items-center gap-1.5">
											<span className="rounded border border-border px-1.5 py-0.5 uppercase">
												{memory.kind}
											</span>
											<span className="rounded border border-border px-1.5 py-0.5">
												{memory.state}
											</span>
											<span className="truncate">
												{groups.find((group) => group.id === memory.group_id)
													?.name ?? memory.group_id}
											</span>
										</span>
										<span className="flex shrink-0 items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
											<button
												type="button"
												onClick={() => {
													appendDraft(`> [memory] ${memory.content}`);
													closeSettings();
												}}
												aria-label="Quote into chat input"
												title="Quote into chat input"
												className="text-text-muted hover:text-accent"
											>
												<Quote className="h-3.5 w-3.5" />
											</button>
											<button
												type="button"
												onClick={() => {
													setEditingMemoryId(memory.id);
													setMemoryDraft(memory.content);
												}}
												aria-label="Edit memory"
												title="Edit"
												className="text-text-muted hover:text-accent"
											>
												<Pencil className="h-3.5 w-3.5" />
											</button>
											<button
												type="button"
												onClick={() => void onDelete(memory)}
												aria-label="Delete memory"
												title="Delete"
												className="text-text-muted hover:text-danger"
											>
												<Trash2 className="h-3.5 w-3.5" />
											</button>
										</span>
									</div>
									{editingMemoryId === memory.id ? (
										<div className="space-y-1.5">
											<textarea
												autoComplete="off"
												value={memoryDraft}
												onChange={(event) => setMemoryDraft(event.target.value)}
												onKeyDown={(event) => {
													if (event.key === "Enter" && !event.shiftKey) {
														event.preventDefault();
														void saveMemory(memory);
													}
													if (event.key === "Escape") setEditingMemoryId(null);
												}}
												aria-label="Memory content"
												rows={3}
												className="w-full resize-y rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text-primary outline-none focus:border-accent"
											/>
											<div className="flex justify-end gap-2">
												<button
													type="button"
													onClick={() => setEditingMemoryId(null)}
													className="rounded-md px-2 py-1 text-[11px] text-text-muted hover:text-text-primary"
												>
													Cancel
												</button>
												<button
													type="button"
													onClick={() => void saveMemory(memory)}
													className="rounded-md bg-accent px-2 py-1 text-[11px] text-white hover:bg-accent-hover"
												>
													Save memory
												</button>
											</div>
										</div>
									) : (
										<>
											<p className="whitespace-pre-wrap break-words text-sm text-text-primary">
												{memory.content}
											</p>
											<div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-text-muted">
												<span>
													Importance {Math.round(memory.importance * 100)}%
												</span>
												<span>
													Confidence {Math.round(memory.confidence * 100)}%
												</span>
												{memory.created_at && (
													<span>Added {fmtDate(memory.created_at)}</span>
												)}
												{memory.reason && (
													<span
														className="min-w-0 max-w-full truncate"
														title={memory.reason}
													>
														· {memory.reason}
													</span>
												)}
											</div>
										</>
									)}
								</li>
							))}
						</ul>
					)}
				</div>
				<footer className="flex h-14 shrink-0 items-center justify-between gap-3 border-t border-border bg-surface px-5">
					<span className="text-xs text-text-muted">
						{policyDirty ? "Unsaved memory settings" : "All changes saved"}
					</span>
					<button
						type="button"
						onClick={() => void savePolicy()}
						disabled={!policyDirty || saving}
						className="flex h-9 items-center gap-2 rounded-md bg-accent px-4 text-sm font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
					>
						{saving ? (
							<Loader2 className="h-3.5 w-3.5 animate-spin" />
						) : (
							<Save className="h-3.5 w-3.5" />
						)}
						Save changes
					</button>
				</footer>
			</main>
		</div>
	);
}

function GroupSection({
	label,
	groups,
	selectedId,
	onSelect,
	characterNames,
	editingId,
	groupNameDraft,
	onGroupNameDraftChange,
	onSaveGroup,
	onCancelGroup,
	onRename,
	onArchive,
	onDelete,
}: {
	label: string;
	groups: MemoryGroup[];
	selectedId: string;
	onSelect: (id: string) => void;
	characterNames: Map<string, string>;
	editingId?: string | null;
	groupNameDraft?: string;
	onGroupNameDraftChange?: (value: string) => void;
	onSaveGroup?: () => void;
	onCancelGroup?: () => void;
	onRename?: (group: MemoryGroup) => void;
	onArchive?: (group: MemoryGroup) => void;
	onDelete?: (group: MemoryGroup) => void;
}) {
	return (
		<div className="mb-4">
			<div className="mb-1.5 px-2 text-[10px] font-semibold uppercase text-text-muted">
				{label}
			</div>
			{groups.map((group) => (
				<div key={group.id}>
					<div
						className={`group mb-1 flex min-h-11 w-full items-center rounded-md border text-xs transition-colors ${
							selectedId === group.id
								? "border-border bg-surface text-text-primary shadow-sm"
								: "border-transparent text-text-secondary hover:bg-surface-hover hover:text-text-primary"
						}`}
					>
						<button
							type="button"
							onClick={() => onSelect(group.id)}
							className="flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-2 text-left"
						>
							<span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-hover text-text-secondary">
								<GroupIcon type={group.group_type} />
							</span>
							<span className="min-w-0 flex-1">
								<span className="block truncate text-sm font-medium">
									{group.owner_character_id
										? (characterNames.get(group.owner_character_id) ??
											group.name)
										: group.name}
								</span>
								<span className="block text-[10px] capitalize text-text-muted">
									{GROUP_TYPE_LABELS[group.group_type]}
								</span>
							</span>
						</button>
						{onRename && onArchive && onDelete && (
							<span className="mr-1 hidden shrink-0 items-center gap-1 group-hover:flex group-focus-within:flex">
								<button
									type="button"
									onClick={(event) => {
										event.stopPropagation();
										onRename(group);
									}}
									aria-label={`Rename ${group.name}`}
									title="Rename group"
									className="text-text-muted hover:text-accent"
								>
									<Pencil className="h-3 w-3" />
								</button>
								<button
									type="button"
									onClick={(event) => {
										event.stopPropagation();
										onArchive(group);
									}}
									aria-label={`Archive ${group.name}`}
									title="Archive group"
									className="text-text-muted hover:text-warning"
								>
									<Folder className="h-3 w-3" />
								</button>
								<button
									type="button"
									onClick={(event) => {
										event.stopPropagation();
										onDelete(group);
									}}
									aria-label={`Delete ${group.name}`}
									title="Delete group"
									className="text-text-muted hover:text-danger"
								>
									<Trash2 className="h-3 w-3" />
								</button>
							</span>
						)}
					</div>
					{editingId === group.id &&
						onGroupNameDraftChange &&
						onSaveGroup &&
						onCancelGroup && (
							<GroupNameEditor
								value={groupNameDraft ?? ""}
								onChange={onGroupNameDraftChange}
								onSave={onSaveGroup}
								onCancel={onCancelGroup}
							/>
						)}
				</div>
			))}
		</div>
	);
}

/** Compact inline editor used for custom group creation and renaming. */
function GroupNameEditor({
	value,
	onChange,
	onSave,
	onCancel,
}: {
	value: string;
	onChange: (value: string) => void;
	onSave: () => void;
	onCancel: () => void;
}) {
	return (
		<div className="mb-3 flex items-center gap-1 px-1">
			<input
				autoComplete="off"
				value={value}
				onChange={(event) => onChange(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter") onSave();
					if (event.key === "Escape") onCancel();
				}}
				aria-label="Memory group name"
				className="h-8 min-w-0 flex-1 rounded-md border border-border bg-surface px-2 text-xs text-text-primary outline-none focus:border-accent"
			/>
			<button
				type="button"
				onClick={onSave}
				aria-label="Save group name"
				title="Save"
				className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-surface-hover"
			>
				<Check className="h-3.5 w-3.5 text-success" />
			</button>
			<button
				type="button"
				onClick={onCancel}
				aria-label="Cancel group edit"
				title="Cancel"
				className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-surface-hover"
			>
				<X className="h-3.5 w-3.5 text-text-muted" />
			</button>
		</div>
	);
}

// Memory settings workspace for role modes, group inheritance, and memory review.

import {
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
	type MemoryMode,
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
];

const GROUP_TYPE_LABELS: Record<MemoryGroup["group_type"], string> = {
	character: "Character",
	global: "Global",
	custom: "Custom",
};

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
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
	const [groupNameDraft, setGroupNameDraft] = useState("");

	const setDraft = useConversationStore((state) => state.setDraft);
	const closeSettings = useSettingsStore((state) => state.closeSettings);

	const characterNames = useMemo(
		() =>
			new Map(characters.map((character) => [character.id, character.name])),
		[characters],
	);
	const selectedGroup = groups.find((group) => group.id === selectedGroupId);

	const loadMemories = useCallback(async (q: string, groupId: string) => {
		setLoading(true);
		try {
			if (q.trim()) {
				const response = await memoriesApi.search({
					q: q.trim(),
					group_id: groupId || undefined,
					top_k: 30,
				});
				setItems(response.results);
			} else {
				const response = await memoriesApi.list({
					group_id: groupId || undefined,
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

	// biome-ignore lint/correctness/useExhaustiveDependencies: group changes reload the submitted query; typing waits for Enter
	useEffect(() => {
		void loadMemories(query, selectedGroupId);
	}, [loadMemories, selectedGroupId]);

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

	const onDelete = async (id: string) => {
		try {
			await memoriesApi.delete(id);
			setItems((current) => current.filter((memory) => memory.id !== id));
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Delete failed");
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
			setGroups((current) => current.filter((item) => item.id !== group.id));
			if (selectedGroupId === group.id) setSelectedGroupId("");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to archive group",
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

	const characterGroups = groups.filter(
		(group) => group.group_type === "character",
	);
	const globalGroups = groups.filter((group) => group.group_type === "global");
	const customGroups = groups.filter((group) => group.group_type === "custom");
	const inheritableGroups = groups.filter(
		(group) =>
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
					{editingGroupId && editingGroupId !== "new" && (
						<GroupNameEditor
							value={groupNameDraft}
							onChange={setGroupNameDraft}
							onSave={() => void saveGroup()}
							onCancel={() => setEditingGroupId(null)}
						/>
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

				<header className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-3">
					<div className="min-w-0 flex-1">
						<h3 className="truncate text-base font-semibold text-text-primary">
							{selectedGroup?.name ?? "All memories"}
						</h3>
						<p className="text-xs text-text-muted">
							{selectedGroup
								? GROUP_TYPE_LABELS[selectedGroup.group_type]
								: "All groups"}{" "}
							· {items.length} memories
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
									void loadMemories(query, selectedGroupId);
							}}
							placeholder="Search memories"
							aria-label="Search memories"
							className="h-9 w-full rounded-md border border-border bg-surface pl-9 pr-3 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
						/>
					</div>
				</header>

				<div className="min-h-0 flex-1 overflow-y-auto">
					{loading ? (
						<div className="flex min-h-48 items-center justify-center text-text-muted">
							<Loader2 className="h-4 w-4 animate-spin" />
						</div>
					) : items.length === 0 ? (
						<p className="flex min-h-48 items-center justify-center text-sm text-text-muted">
							No memories in this group.
						</p>
					) : (
						<ul className="divide-y divide-border">
							{items.map((memory) => (
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
										<span className="flex shrink-0 items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
											<button
												type="button"
												onClick={() => {
													setDraft(`> [memory] ${memory.content}`);
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
												onClick={() => void onDelete(memory.id)}
												aria-label="Delete memory"
												title="Delete"
												className="text-text-muted hover:text-danger"
											>
												<Trash2 className="h-3.5 w-3.5" />
											</button>
										</span>
									</div>
									<p className="whitespace-pre-wrap break-words text-sm text-text-primary">
										{memory.content}
									</p>
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
	onRename,
	onArchive,
	onDelete,
}: {
	label: string;
	groups: MemoryGroup[];
	selectedId: string;
	onSelect: (id: string) => void;
	characterNames: Map<string, string>;
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
				<div
					key={group.id}
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
									? (characterNames.get(group.owner_character_id) ?? group.name)
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

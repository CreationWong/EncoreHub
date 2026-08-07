import { Loader2, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
	type CharacterMemorySettingsResponse,
	type MemoryGroup,
	type MemoryGroupInheritance,
	type MemoryMode,
	memoriesApi,
} from "../../services/memories";
import { toast } from "../../stores/toastStore";

const MODE_OPTIONS: Array<{ id: MemoryMode; label: string }> = [
	{ id: "simple", label: "Simple" },
	{ id: "rag", label: "RAG" },
	{ id: "rag_enhanced", label: "RAG enhanced" },
];

function settingsSignature(
	settings: CharacterMemorySettingsResponse | null,
): string {
	if (!settings) return "";
	return JSON.stringify({
		defaultMode: settings.settings.default_mode,
		realisticEnabled: settings.settings.realistic_enabled,
		inheritedGroups: settings.inherited_groups,
	});
}

export default function CharacterMemorySettings({
	characterId,
}: {
	characterId: string;
}) {
	const [policy, setPolicy] = useState<CharacterMemorySettingsResponse | null>(
		null,
	);
	const [groups, setGroups] = useState<MemoryGroup[]>([]);
	const [savedSignature, setSavedSignature] = useState("");
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState("");

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		setPolicy(null);
		setError("");
		Promise.all([
			memoriesApi.getCharacterSettings(characterId),
			memoriesApi.listGroups(),
		])
			.then(([settings, groupResponse]) => {
				if (cancelled) return;
				setPolicy(settings);
				setGroups(groupResponse.groups);
				setSavedSignature(settingsSignature(settings));
			})
			.catch((loadError) => {
				if (cancelled) return;
				setError(
					loadError instanceof Error
						? loadError.message
						: "Failed to load memory settings",
				);
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [characterId]);

	const inheritableGroups = useMemo(
		() =>
			groups.filter(
				(group) =>
					group.group_type !== "global" &&
					group.owner_character_id !== characterId,
			),
		[characterId, groups],
	);
	const dirty = Boolean(policy && settingsSignature(policy) !== savedSignature);

	const updatePolicy = (
		update: (
			current: CharacterMemorySettingsResponse,
		) => CharacterMemorySettingsResponse,
	) => setPolicy((current) => (current ? update(current) : current));

	const toggleGroup = (groupId: string, checked: boolean) => {
		updatePolicy((current) => ({
			...current,
			inherited_groups: checked
				? [
						...current.inherited_groups,
						{
							character_id: characterId,
							group_id: groupId,
							access_mode: "read",
							priority: current.inherited_groups.length,
						},
					]
				: current.inherited_groups.filter(
						(entry) => entry.group_id !== groupId,
					),
		}));
	};

	const setGroupAccess = (
		groupId: string,
		accessMode: MemoryGroupInheritance["access_mode"],
	) => {
		updatePolicy((current) => ({
			...current,
			inherited_groups: current.inherited_groups.map((entry) =>
				entry.group_id === groupId
					? { ...entry, access_mode: accessMode }
					: entry,
			),
		}));
	};

	const save = async () => {
		if (!policy || saving || !dirty) return;
		setSaving(true);
		setError("");
		try {
			const saved = await memoriesApi.updateCharacterSettings(characterId, {
				default_mode: policy.settings.default_mode,
				realistic_enabled: policy.settings.realistic_enabled,
				inherited_groups: policy.inherited_groups,
			});
			setPolicy(saved);
			setSavedSignature(settingsSignature(saved));
			toast.success("Character memory settings saved");
		} catch (saveError) {
			setError(
				saveError instanceof Error
					? saveError.message
					: "Failed to save memory settings",
			);
		} finally {
			setSaving(false);
		}
	};

	return (
		<section
			aria-label="Current character memory settings"
			className="border-b border-border px-5 py-5"
		>
			<div className="mb-4 flex items-center justify-between gap-3">
				<h3 className="text-xs font-semibold text-text-primary">Memory</h3>
				<span className="text-[11px] text-text-muted">Current character</span>
			</div>

			{loading ? (
				<output
					aria-label="Loading character memory settings"
					className="flex h-16 items-center justify-center text-text-muted"
				>
					<Loader2 className="h-4 w-4 animate-spin" />
				</output>
			) : policy ? (
				<>
					<div className="flex flex-wrap items-end gap-3">
						<label className="min-w-48 flex-1">
							<span className="mb-1.5 block text-xs font-medium text-text-secondary">
								Default mode
							</span>
							<select
								aria-label="Character memory mode"
								value={policy.settings.default_mode}
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
						<button
							type="button"
							onClick={() => void save()}
							disabled={!dirty || saving}
							className="flex h-9 shrink-0 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-text-secondary hover:bg-control hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
						>
							{saving ? (
								<Loader2 className="h-3.5 w-3.5 animate-spin" />
							) : (
								<Save className="h-3.5 w-3.5" />
							)}
							Save memory settings
						</button>
					</div>

					<fieldset className="mt-4 border-t border-border pt-3">
						<legend className="pr-2 text-xs font-medium text-text-secondary">
							Inherited memory groups
						</legend>
						{inheritableGroups.length === 0 ? (
							<p className="pt-2 text-xs text-text-muted">
								No inheritable groups
							</p>
						) : (
							<div className="mt-1 divide-y divide-border">
								{inheritableGroups.map((group) => {
									const inheritance = policy.inherited_groups.find(
										(entry) => entry.group_id === group.id,
									);
									return (
										<div
											key={group.id}
											className="flex min-h-10 flex-wrap items-center gap-3 py-2"
										>
											<label className="flex min-w-0 flex-1 items-center gap-2 text-sm text-text-primary">
												<input
													autoComplete="off"
													type="checkbox"
													checked={Boolean(inheritance)}
													onChange={(event) =>
														toggleGroup(group.id, event.target.checked)
													}
												/>
												<span className="truncate">{group.name}</span>
												<span className="shrink-0 text-[11px] uppercase text-text-muted">
													{group.group_type}
												</span>
											</label>
											{inheritance && (
												<select
													aria-label={`${group.name} access`}
													value={inheritance.access_mode}
													onChange={(event) =>
														setGroupAccess(
															group.id,
															event.target
																.value as MemoryGroupInheritance["access_mode"],
														)
													}
													className="h-8 rounded-md border border-border bg-control px-2 text-xs text-text-primary outline-none focus:border-accent"
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
					</fieldset>
				</>
			) : (
				<p role="alert" className="text-xs text-danger">
					{error || "Memory settings unavailable"}
				</p>
			)}

			{policy && error && (
				<p role="alert" className="mt-3 text-xs text-danger">
					{error}
				</p>
			)}
		</section>
	);
}

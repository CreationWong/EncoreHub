// Per-character memory policy: default mode and inherited group access.

import { Loader2, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { type MessageKey, useT } from "../../i18n";
import {
	type CharacterMemorySettingsResponse,
	type MemoryGroup,
	type MemoryGroupInheritance,
	type MemoryMode,
	memoriesApi,
} from "../../services/memories";
import { toast } from "../../stores/toastStore";

const MODE_OPTIONS: Array<{ id: MemoryMode; labelKey: MessageKey }> = [
	{ id: "simple", labelKey: "character.memoryPolicy.simple" },
	{ id: "rag", labelKey: "character.memoryPolicy.rag" },
	{ id: "rag_enhanced", labelKey: "character.memoryPolicy.ragEnhanced" },
];

/**
 * Translate a memory group type for the inheritance list.
 */
function groupTypeLabel(
	groupType: MemoryGroup["group_type"],
	translate: (key: MessageKey) => string,
): string {
	if (groupType === "character") return translate("memory.groupTypeCharacter");
	if (groupType === "global") return translate("memory.groupTypeGlobal");
	if (groupType === "custom") return translate("memory.groupTypeCustom");
	return groupType;
}

/** Dirty-check signature for the staged memory policy. */
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

/**
 * Memory mode and inherited-group editor for the character currently open.
 */
export default function CharacterMemorySettings({
	characterId,
}: {
	characterId: string;
}) {
	const t = useT();
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
						: t("character.memoryPolicy.loadFailed"),
				);
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [characterId, t]);

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
			toast.success(t("character.memorySaved"));
		} catch (saveError) {
			setError(
				saveError instanceof Error
					? saveError.message
					: t("character.memoryPolicy.saveFailed"),
			);
		} finally {
			setSaving(false);
		}
	};

	return (
		<section
			aria-label={t("character.memoryPolicy.section")}
			className="border-b border-border px-5 py-5"
		>
			<div className="mb-4 flex items-center justify-between gap-3">
				<h3 className="text-xs font-semibold text-text-primary">
					{t("memory.title")}
				</h3>
				<span className="text-[11px] text-text-muted">
					{t("character.memoryPolicy.currentCharacter")}
				</span>
			</div>

			{loading ? (
				<output
					aria-label={t("character.memoryPolicy.loading")}
					className="flex h-16 items-center justify-center text-text-muted"
				>
					<Loader2 className="h-4 w-4 animate-spin" />
				</output>
			) : policy ? (
				<>
					<div className="flex flex-wrap items-end gap-3">
						<label className="min-w-48 flex-1">
							<span className="mb-1.5 block text-xs font-medium text-text-secondary">
								{t("character.memoryPolicy.defaultMode")}
							</span>
							<select
								aria-label={t("character.memoryPolicy.mode")}
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
										{t(mode.labelKey)}
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
							{t("character.memoryPolicy.saveSettings")}
						</button>
					</div>

					<fieldset className="mt-4 border-t border-border pt-3">
						<legend className="pr-2 text-xs font-medium text-text-secondary">
							{t("character.memoryPolicy.inheritedGroups")}
						</legend>
						{inheritableGroups.length === 0 ? (
							<p className="pt-2 text-xs text-text-muted">
								{t("character.memoryPolicy.noneInheritable")}
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
													{groupTypeLabel(group.group_type, t)}
												</span>
											</label>
											{inheritance && (
												<select
													aria-label={t("character.memoryPolicy.access", {
														name: group.name,
													})}
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
													<option value="read">
														{t("character.memoryPolicy.read")}
													</option>
													<option value="read_write">
														{t("character.memoryPolicy.readWrite")}
													</option>
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
					{error || t("character.memoryPolicy.unavailable")}
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

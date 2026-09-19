// Group creation dialog for the multi-AI workspace.
//
// The dialog picks two to eight existing characters, optionally overrides each
// member's provider/model, and chooses the initial reply mode. Members keep
// their character snapshot, so later character edits do not rewrite the group.

import { Check, Loader2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useT } from "../../i18n";
import type {
	GroupMemberSelection,
	ReplyMode,
} from "../../services/conversation";
import { useCharacterStore } from "../../stores/characterStore";
import { useMultiChatStore } from "../../stores/multiChatStore";
import { useProviderStore } from "../../stores/providerStore";
import { toast } from "../../stores/toastStore";
import CharacterAvatar from "../character/CharacterAvatar";

const MAX_MEMBERS = 8;

export interface GroupCreateDialogProps {
	onClose: () => void;
}

export default function GroupCreateDialog({ onClose }: GroupCreateDialogProps) {
	const t = useT();
	const characters = useCharacterStore((state) => state.characters);
	const charactersLoaded = useCharacterStore((state) => state.loaded);
	const loadCharacters = useCharacterStore((state) => state.load);
	const profiles = useProviderStore((state) => state.profiles);
	const createGroup = useMultiChatStore((state) => state.createGroup);

	const [title, setTitle] = useState("");
	const [replyMode, setReplyMode] = useState<ReplyMode>("sequential");
	const [selected, setSelected] = useState<string[]>([]);
	const [overrides, setOverrides] = useState<
		Record<string, { provider: string; model: string }>
	>({});
	const [creating, setCreating] = useState(false);

	useEffect(() => {
		if (!charactersLoaded) void loadCharacters();
	}, [charactersLoaded, loadCharacters]);

	const providers = useMemo(
		() => profiles.filter((profile) => profile.enabled),
		[profiles],
	);
	const modelsFor = (providerId: string): string[] => {
		const profile = profiles.find((item) => item.id === providerId);
		if (!profile) return [];
		const configs = profile.model_configs?.map((config) => config.id) ?? [];
		return configs.length > 0 ? configs : profile.models;
	};

	const toggleMember = (characterId: string) => {
		setSelected((current) => {
			if (current.includes(characterId)) {
				const next = current.filter((id) => id !== characterId);
				setOverrides((existing) => {
					const copy = { ...existing };
					delete copy[characterId];
					return copy;
				});
				return next;
			}
			if (current.length >= MAX_MEMBERS) return current;
			setOverrides((existing) => ({
				...existing,
				[characterId]: {
					provider:
						characters.find((item) => item.id === characterId)
							?.default_provider ?? "",
					model:
						characters.find((item) => item.id === characterId)?.default_model ??
						"",
				},
			}));
			return [...current, characterId];
		});
	};

	const canCreate = selected.length >= 2 && selected.length <= MAX_MEMBERS;

	const submit = async () => {
		if (!canCreate || creating) return;
		setCreating(true);
		try {
			const members: GroupMemberSelection[] = selected.map((characterId) => {
				const override = overrides[characterId];
				const provider = override?.provider?.trim() ?? "";
				const model = override?.model?.trim() ?? "";
				return {
					character_id: characterId,
					...(provider && model ? { provider, model } : {}),
				};
			});
			await createGroup(
				title.trim() || t("multiChat.defaultTitle"),
				replyMode,
				members,
			);
			onClose();
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : t("multiChat.loadFailed"),
			);
			setCreating(false);
		}
	};

	return (
		<dialog
			open
			aria-label={t("multiChat.createTitle")}
			onKeyDown={(event) => {
				if (event.key === "Escape") onClose();
			}}
			className="fixed inset-0 z-40 m-0 flex h-full max-h-none w-full max-w-none items-center justify-center border-0 bg-black/30 p-4"
		>
			<div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-border bg-workspace shadow-2xl">
				<header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
					<h2 className="text-sm font-semibold text-text-primary">
						{t("multiChat.createTitle")}
					</h2>
					<button
						type="button"
						onClick={onClose}
						aria-label={t("common.cancel")}
						className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-control hover:text-text-primary"
					>
						<X className="h-4 w-4" />
					</button>
				</header>

				<div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
					<label className="block">
						<span className="mb-1.5 block text-xs font-medium text-text-secondary">
							{t("multiChat.titleLabel")}
						</span>
						<input
							autoComplete="off"
							value={title}
							onChange={(event) => setTitle(event.target.value)}
							placeholder={t("multiChat.titlePlaceholder")}
							className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
						/>
					</label>

					<fieldset className="m-0 border-0 p-0">
						<legend className="mb-1.5 text-xs font-medium text-text-secondary">
							{t("multiChat.replyMode")}
						</legend>
						<div className="grid gap-2 sm:grid-cols-2">
							{(
								[
									[
										"sequential",
										"replyModeSequential",
										"replyModeSequentialHelp",
									],
									["smart", "replyModeSmart", "replyModeSmartHelp"],
								] as const
							).map(([mode, labelKey, helpKey]) => {
								const active = replyMode === mode;
								return (
									<button
										key={mode}
										type="button"
										aria-pressed={active}
										onClick={() => setReplyMode(mode)}
										className={`rounded-md border p-3 text-left transition-colors ${
											active
												? "border-accent bg-surface-hover"
												: "border-border hover:bg-surface-hover"
										}`}
									>
										<span className="block text-sm font-medium text-text-primary">
											{t(`multiChat.${labelKey}`)}
										</span>
										<span className="mt-1 block text-xs leading-4 text-text-muted">
											{t(`multiChat.${helpKey}`)}
										</span>
									</button>
								);
							})}
						</div>
					</fieldset>

					<div>
						<div className="mb-1.5 flex items-center justify-between">
							<span className="text-xs font-medium text-text-secondary">
								{t("multiChat.members")}
							</span>
							<span className="text-[11px] text-text-muted">
								{t("multiChat.selectedCount", { count: selected.length })}
							</span>
						</div>
						<p className="mb-2 text-[11px] text-text-muted">
							{t("multiChat.membersHint")}
						</p>
						<div className="grid max-h-56 grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2 overflow-y-auto">
							{characters.map((character) => {
								const checked = selected.includes(character.id);
								return (
									<button
										key={character.id}
										type="button"
										aria-pressed={checked}
										onClick={() => toggleMember(character.id)}
										className={`flex min-w-0 items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors ${
											checked
												? "border-accent bg-surface-hover"
												: "border-border hover:bg-surface-hover"
										}`}
									>
										<CharacterAvatar
											avatar={character.avatar}
											characterId={character.id}
											name={character.name}
											size="small"
										/>
										<span className="min-w-0 flex-1 truncate text-xs text-text-primary">
											{character.name}
										</span>
										<Check
											className={`h-3.5 w-3.5 shrink-0 text-accent ${
												checked ? "opacity-100" : "opacity-0"
											}`}
										/>
									</button>
								);
							})}
						</div>
					</div>

					{selected.length > 0 && (
						<div className="space-y-2">
							{selected.map((characterId) => {
								const character = characters.find(
									(item) => item.id === characterId,
								);
								if (!character) return null;
								const override = overrides[characterId] ?? {
									provider: "",
									model: "",
								};
								const models = override.provider
									? modelsFor(override.provider)
									: [];
								return (
									<div
										key={characterId}
										className="flex flex-wrap items-center gap-2 rounded-md border border-border px-2.5 py-2"
									>
										<span className="min-w-0 flex-1 truncate text-xs text-text-primary">
											{character.name}
										</span>
										<select
											value={override.provider}
											aria-label={`${character.name} ${t("multiChat.provider")}`}
											onChange={(event) =>
												setOverrides((existing) => ({
													...existing,
													[characterId]: {
														provider: event.target.value,
														model: modelsFor(event.target.value)[0] ?? "",
													},
												}))
											}
											className="h-7 rounded-md border border-border bg-surface px-1.5 text-[11px] text-text-primary outline-none focus:border-accent"
										>
											<option value="">{t("multiChat.useDefault")}</option>
											{providers.map((provider) => (
												<option key={provider.id} value={provider.id}>
													{provider.name || provider.id}
												</option>
											))}
										</select>
										<select
											value={override.model}
											disabled={!override.provider}
											aria-label={`${character.name} ${t("multiChat.model")}`}
											onChange={(event) =>
												setOverrides((existing) => ({
													...existing,
													[characterId]: {
														provider: override.provider,
														model: event.target.value,
													},
												}))
											}
											className="h-7 max-w-48 rounded-md border border-border bg-surface px-1.5 text-[11px] text-text-primary outline-none focus:border-accent disabled:opacity-50"
										>
											{models.map((model) => (
												<option key={model} value={model}>
													{model}
												</option>
											))}
										</select>
									</div>
								);
							})}
						</div>
					)}
				</div>

				<footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-4 py-3">
					<button
						type="button"
						onClick={onClose}
						className="h-8 rounded-md px-3 text-xs text-text-secondary hover:bg-control hover:text-text-primary"
					>
						{t("multiChat.cancel")}
					</button>
					<button
						type="button"
						onClick={() => void submit()}
						disabled={!canCreate || creating}
						className="flex h-8 items-center gap-2 rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
					>
						{creating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
						{creating ? t("multiChat.creating") : t("multiChat.create")}
					</button>
				</footer>
			</div>
		</dialog>
	);
}

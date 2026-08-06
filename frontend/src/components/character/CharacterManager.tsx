import {
	AlertTriangle,
	Copy,
	History,
	Info,
	Loader2,
	MessageSquare,
	Pencil,
	Plus,
	RotateCcw,
	Save,
	Trash2,
	X,
} from "lucide-react";
import {
	type ChangeEvent,
	type KeyboardEvent as ReactKeyboardEvent,
	type Ref,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { ApiError } from "../../services/api";
import {
	type CharacterHistoryListResponse,
	type CharacterProfile,
	DEFAULT_CHARACTER_ID,
} from "../../services/characters";
import {
	type ProviderProfile,
	providerChatModels,
} from "../../services/providers";
import { useCharacterManagerStore } from "../../stores/characterManagerStore";
import { useCharacterStore } from "../../stores/characterStore";
import { confirm } from "../../stores/confirmStore";
import { useConversationStore } from "../../stores/conversationStore";
import { useProviderStore } from "../../stores/providerStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { toast } from "../../stores/toastStore";
import CharacterAvatar from "./CharacterAvatar";
import CharacterHistory from "./CharacterHistory";
import CharacterMemorySettings from "./CharacterMemorySettings";
import {
	CHARACTER_LIMITS,
	type CharacterDraft,
	characterDraftSignature,
	characterInputFromDraft,
	draftFromCharacter,
	emptyCharacterDraft,
	estimatePromptTokens,
	uniqueCopyName,
	validateCharacterDraft,
} from "./characterForm";

function providerModels(profile: ProviderProfile): Array<{
	id: string;
	name: string;
}> {
	const configs = profile.model_configs ?? [];
	const configured = new Map(configs.map((model) => [model.id, model]));
	return providerChatModels(profile).map((id) => ({
		id,
		name: configured.get(id)?.name?.trim() || id,
	}));
}

function selectableProviderProfiles(
	providers: ProviderProfile[],
): ProviderProfile[] {
	return providers.filter(
		(provider) => provider.enabled && providerModels(provider).length > 0,
	);
}

function resolveDraftDefaults(
	draft: CharacterDraft,
	providers: ProviderProfile[],
	appProvider: string,
	appModel: string,
): CharacterDraft {
	const selectableProviders = selectableProviderProfiles(providers);
	const selectedProvider =
		selectableProviders.find(
			(provider) => provider.id === draft.defaultProvider,
		) ??
		selectableProviders.find((provider) => provider.id === appProvider) ??
		selectableProviders[0];
	if (!selectedProvider) {
		return { ...draft, defaultProvider: "", defaultModel: "" };
	}

	const models = providerModels(selectedProvider);
	const currentModel =
		selectedProvider.id === draft.defaultProvider
			? models.find((model) => model.id === draft.defaultModel)?.id
			: undefined;
	const appDefaultModel =
		selectedProvider.id === appProvider
			? models.find((model) => model.id === appModel)?.id
			: undefined;

	return {
		...draft,
		defaultProvider: selectedProvider.id,
		defaultModel: currentModel ?? appDefaultModel ?? models[0]?.id ?? "",
	};
}

function modelIsAvailable(
	providers: ProviderProfile[],
	providerId: string,
	modelId: string,
): boolean {
	if (!providerId || !modelId) return false;
	const provider = providers.find((item) => item.id === providerId);
	return Boolean(
		provider?.enabled &&
			providerModels(provider).some((item) => item.id === modelId),
	);
}

function FieldError({ id, message }: { id: string; message?: string }) {
	if (!message) return null;
	return (
		<p id={id} className="mt-1 text-xs text-danger">
			{message}
		</p>
	);
}

function TextField({
	id,
	label,
	value,
	onChange,
	error,
	placeholder,
	maxLength,
	disabled,
	inputRef,
}: {
	id: string;
	label: string;
	value: string;
	onChange: (value: string) => void;
	error?: string;
	placeholder?: string;
	maxLength: number;
	disabled?: boolean;
	inputRef?: Ref<HTMLInputElement>;
}) {
	return (
		<label htmlFor={id} className="block min-w-0">
			<span className="mb-1.5 block text-xs font-medium text-text-secondary">
				{label}
			</span>
			<input
				autoComplete="off"
				ref={inputRef}
				id={id}
				value={value}
				onChange={(event) => onChange(event.target.value)}
				placeholder={placeholder}
				maxLength={maxLength}
				disabled={disabled}
				aria-invalid={Boolean(error)}
				aria-describedby={error ? `${id}-error` : undefined}
				className="h-9 w-full rounded-md border border-border bg-control px-3 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-accent disabled:cursor-not-allowed disabled:opacity-60"
			/>
			<FieldError id={`${id}-error`} message={error} />
		</label>
	);
}

function fieldId(name: string): string {
	return `character-${name}`;
}

interface CharacterManagerProps {
	historyLoader?: () => Promise<CharacterHistoryListResponse>;
}

export default function CharacterManager({
	historyLoader,
}: CharacterManagerProps = {}) {
	const open = useCharacterManagerStore((state) => state.open);
	const requestedId = useCharacterManagerStore((state) => state.characterId);
	const requestedCreating = useCharacterManagerStore((state) => state.creating);
	const closeStore = useCharacterManagerStore((state) => state.close);
	const characters = useCharacterStore((state) => state.characters);
	const loading = useCharacterStore((state) => state.loading);
	const loaded = useCharacterStore((state) => state.loaded);
	const loadError = useCharacterStore((state) => state.error);
	const load = useCharacterStore((state) => state.load);
	const create = useCharacterStore((state) => state.create);
	const update = useCharacterStore((state) => state.update);
	const remove = useCharacterStore((state) => state.remove);
	const clearStoreError = useCharacterStore((state) => state.clearError);
	const providers = useProviderStore((state) => state.profiles);
	const appProvider = useSettingsStore((state) => state.provider);
	const appModel = useSettingsStore((state) => state.model);
	const setSidebarMode = useSettingsStore((state) => state.setSidebarMode);
	const newConversation = useConversationStore(
		(state) => state.newConversation,
	);
	const dialogRef = useRef<HTMLDialogElement>(null);
	const nameRef = useRef<HTMLInputElement>(null);
	const returnFocusRef = useRef<HTMLElement | null>(null);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);
	const [draft, setDraft] = useState<CharacterDraft>(emptyCharacterDraft);
	const [sourceSignature, setSourceSignature] = useState(
		characterDraftSignature(emptyCharacterDraft()),
	);
	const [saving, setSaving] = useState(false);
	const [actionError, setActionError] = useState<string | null>(null);
	const [conflict, setConflict] = useState(false);
	const [view, setView] = useState<"edit" | "history">("edit");

	const currentProfile =
		characters.find((item) => item.id === editingId) ?? null;
	const errors = useMemo(
		() => validateCharacterDraft(draft, characters, editingId),
		[draft, characters, editingId],
	);
	const valid = Object.keys(errors).length === 0;
	const dirty = characterDraftSignature(draft) !== sourceSignature;
	const promptTokens = estimatePromptTokens(draft.systemPrompt);
	const selectableProviders = useMemo(
		() => selectableProviderProfiles(providers),
		[providers],
	);
	const selectedProvider = selectableProviders.find(
		(item) => item.id === draft.defaultProvider,
	);
	const models = selectedProvider ? providerModels(selectedProvider) : [];
	const modelAvailable = modelIsAvailable(
		providers,
		draft.defaultProvider,
		draft.defaultModel,
	);
	const resolvedModelAvailable = modelAvailable;

	useEffect(() => {
		if (!open) return;
		if (!loaded && !requestedCreating) return;
		returnFocusRef.current =
			document.activeElement instanceof HTMLElement
				? document.activeElement
				: null;
		const availableCharacters = useCharacterStore.getState().characters;
		const profile = requestedCreating
			? null
			: (availableCharacters.find((item) => item.id === requestedId) ??
				availableCharacters.find((item) => item.id === DEFAULT_CHARACTER_ID) ??
				availableCharacters[0] ??
				null);
		const storedDraft = profile
			? draftFromCharacter(profile)
			: emptyCharacterDraft();
		const providerState = useProviderStore.getState().profiles;
		const settingsState = useSettingsStore.getState();
		const nextDraft = resolveDraftDefaults(
			storedDraft,
			providerState,
			settingsState.provider,
			settingsState.model,
		);
		setEditingId(profile?.id ?? null);
		setCreating(requestedCreating || !profile);
		setDraft(nextDraft);
		setSourceSignature(characterDraftSignature(nextDraft));
		setActionError(null);
		setConflict(false);
		setView("edit");
		clearStoreError();
		const frame = requestAnimationFrame(() => nameRef.current?.focus());
		return () => cancelAnimationFrame(frame);
	}, [open, requestedCreating, requestedId, clearStoreError, loaded]);

	useEffect(() => {
		if (!open || loaded || loading) return;
		void load();
	}, [load, loaded, loading, open]);

	if (!open) return null;

	function resetEditor(profile: CharacterProfile | null, copy = false) {
		const storedDraft = profile
			? {
					...draftFromCharacter(profile),
					...(copy ? { name: uniqueCopyName(profile.name, characters) } : {}),
				}
			: emptyCharacterDraft();
		const nextDraft = resolveDraftDefaults(
			storedDraft,
			providers,
			appProvider,
			appModel,
		);
		setEditingId(copy ? null : (profile?.id ?? null));
		setCreating(copy || !profile);
		setDraft(nextDraft);
		setSourceSignature(
			copy
				? characterDraftSignature(emptyCharacterDraft())
				: characterDraftSignature(nextDraft),
		);
		setActionError(null);
		setConflict(false);
		clearStoreError();
		requestAnimationFrame(() => nameRef.current?.focus());
	}

	async function confirmDiscard(): Promise<boolean> {
		if (!dirty) return true;
		return confirm.ask(
			"Discard character changes?",
			"Unsaved character fields will be restored to their last saved values.",
		);
	}

	async function requestClose() {
		if (!(await confirmDiscard())) return;
		closeStore();
		const target = returnFocusRef.current;
		requestAnimationFrame(() => {
			if (target?.isConnected) target.focus();
		});
	}

	async function selectCharacter(profile: CharacterProfile | null) {
		if (!(await confirmDiscard())) return;
		resetEditor(profile);
	}

	async function selectView(nextView: "edit" | "history") {
		if (nextView === view) return;
		if (nextView === "history" && !(await confirmDiscard())) return;
		if (nextView === "history" && dirty) resetEditor(currentProfile);
		setView(nextView);
	}

	function setField<Key extends keyof CharacterDraft>(
		key: Key,
		value: CharacterDraft[Key],
	) {
		setDraft((current) => ({ ...current, [key]: value }));
		setActionError(null);
		setConflict(false);
	}

	async function persistDraft(): Promise<CharacterProfile | null> {
		if (!valid || saving) return null;
		setSaving(true);
		setActionError(null);
		setConflict(false);
		try {
			const input = characterInputFromDraft(draft);
			const saved = creating
				? await create(input)
				: await update(editingId ?? "", input);
			const savedDraft = draftFromCharacter(saved);
			setEditingId(saved.id);
			setCreating(false);
			setDraft(savedDraft);
			setSourceSignature(characterDraftSignature(savedDraft));
			toast.success(creating ? "Character created" : "Character saved");
			return saved;
		} catch (error) {
			if (error instanceof ApiError && error.status === 409) {
				setConflict(true);
				setActionError(
					"This character changed elsewhere. Reload the latest version before saving again.",
				);
			} else {
				setActionError(
					error instanceof Error ? error.message : "Failed to save character",
				);
			}
			clearStoreError();
			return null;
		} finally {
			setSaving(false);
		}
	}

	async function reloadConflict() {
		await load();
		const state = useCharacterStore.getState();
		if (state.error) {
			setActionError(
				"Unable to reload the latest character. Your unsaved draft is still intact.",
			);
			setConflict(true);
			return;
		}
		const latest = state.characters.find((item) => item.id === editingId);
		if (latest) {
			resetEditor(latest);
			return;
		}
		setActionError(
			"This character is no longer available. Copy the draft before choosing another character.",
		);
		setConflict(false);
	}

	async function duplicateDraft() {
		const nextDraft = {
			...draft,
			name: uniqueCopyName(draft.name, characters),
		};
		setEditingId(null);
		setCreating(true);
		setDraft(nextDraft);
		setSourceSignature(characterDraftSignature(emptyCharacterDraft()));
		setActionError(null);
		setConflict(false);
		requestAnimationFrame(() => nameRef.current?.focus());
	}

	async function deleteCurrent() {
		if (!currentProfile || currentProfile.id === DEFAULT_CHARACTER_ID) return;
		const accepted = await confirm.ask(
			"Delete character?",
			`Delete "${currentProfile.name}"? Existing conversations keep their saved character snapshot.`,
			true,
		);
		if (!accepted) return;
		try {
			await remove(currentProfile.id);
			const next =
				useCharacterStore
					.getState()
					.characters.find((item) => item.id === DEFAULT_CHARACTER_ID) ??
				useCharacterStore.getState().characters[0] ??
				null;
			resetEditor(next);
			toast.success("Character deleted");
		} catch (error) {
			setActionError(
				error instanceof Error ? error.message : "Failed to delete character",
			);
			clearStoreError();
		}
	}

	async function startTestConversation() {
		const profile = dirty || creating ? await persistDraft() : currentProfile;
		if (!profile) return;
		const provider = draft.defaultProvider;
		const model = draft.defaultModel;
		const id = await newConversation({
			characterId: profile.id,
			...(provider && model ? { provider, model } : {}),
		});
		if (!id) return;
		setSidebarMode("conversations");
		closeStore();
	}

	function handleProviderChange(event: ChangeEvent<HTMLSelectElement>) {
		const providerId = event.target.value;
		const provider = selectableProviders.find((item) => item.id === providerId);
		setDraft((current) => ({
			...current,
			defaultProvider: providerId,
			defaultModel: provider ? (providerModels(provider)[0]?.id ?? "") : "",
		}));
		setActionError(null);
		setConflict(false);
	}

	function handleDialogKeyDown(event: ReactKeyboardEvent<HTMLDialogElement>) {
		event.stopPropagation();
		if (event.key === "Escape") {
			event.preventDefault();
			void requestClose();
			return;
		}
		if (event.key !== "Tab") return;
		const focusable = Array.from(
			dialogRef.current?.querySelectorAll<HTMLElement>(
				'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
			) ?? [],
		);
		if (focusable.length === 0) return;
		const first = focusable[0];
		const last = focusable[focusable.length - 1];
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	}

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center p-4 max-[760px]:p-0">
			<button
				type="button"
				tabIndex={-1}
				onClick={() => void requestClose()}
				aria-label="Close character manager"
				className="absolute inset-0 bg-black/45"
			/>
			<dialog
				ref={dialogRef}
				open
				aria-modal="true"
				aria-labelledby="character-manager-title"
				onKeyDown={handleDialogKeyDown}
				className="relative z-10 flex h-[820px] max-h-full w-full max-w-6xl overflow-hidden rounded-lg border border-border bg-workspace text-text-primary shadow-2xl max-[760px]:h-full max-[760px]:rounded-none max-[760px]:border-0"
			>
				<aside className="flex w-60 shrink-0 flex-col border-r border-border bg-app-canvas max-[760px]:w-20">
					<header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-3">
						<h2
							id="character-manager-title"
							className="text-sm font-semibold max-[760px]:sr-only"
						>
							Characters
						</h2>
						<button
							type="button"
							onClick={() => void selectCharacter(null)}
							aria-label="Add character"
							title="Add character"
							className="flex h-8 w-8 items-center justify-center rounded-md text-text-secondary hover:bg-control hover:text-text-primary"
						>
							<Plus className="h-4 w-4" />
						</button>
					</header>

					<div className="min-h-0 flex-1 overflow-y-auto p-2">
						{loading && characters.length === 0 && (
							<output
								aria-label="Loading characters"
								className="flex h-24 items-center justify-center"
							>
								<Loader2 className="h-4 w-4 animate-spin text-text-muted" />
							</output>
						)}
						{loadError && characters.length === 0 && (
							<div className="px-2 py-6 text-center">
								<p className="text-xs text-danger">
									Unable to load characters.
								</p>
								<button
									type="button"
									onClick={() => void load()}
									className="mt-3 h-8 rounded-md border border-border px-3 text-xs text-text-secondary hover:bg-control"
								>
									Retry
								</button>
							</div>
						)}
						{!loading && !loadError && characters.length === 0 && (
							<p className="px-2 py-8 text-center text-xs text-text-muted">
								No characters yet.
							</p>
						)}
						<div className="space-y-1">
							{characters.map((profile) => {
								const selected = !creating && editingId === profile.id;
								return (
									<button
										key={profile.id}
										type="button"
										onClick={() => void selectCharacter(profile)}
										aria-current={selected ? "page" : undefined}
										className={`flex min-h-12 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left max-[760px]:justify-center ${
											selected
												? "bg-selected text-text-primary"
												: "text-text-secondary hover:bg-control hover:text-text-primary"
										}`}
									>
										<CharacterAvatar
											avatar={profile.avatar}
											characterId={profile.id}
											name={profile.name}
										/>
										<span className="min-w-0 flex-1 max-[760px]:hidden">
											<span className="block truncate text-sm font-medium">
												{profile.name}
											</span>
											<span className="block text-[10px] text-text-muted">
												Version {profile.version}
											</span>
										</span>
									</button>
								);
							})}
						</div>
					</div>
				</aside>

				<section className="flex min-w-0 flex-1 flex-col">
					<header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
						<div className="flex min-w-0 flex-1 items-center gap-3 max-[760px]:hidden">
							<CharacterAvatar
								avatar={draft.avatar}
								characterId={editingId ?? undefined}
								name={draft.name}
								size="large"
							/>
							<div className="min-w-0 flex-1">
								<p className="truncate text-sm font-semibold">
									{draft.name.trim() || "New character"}
								</p>
								<p className="truncate text-[11px] text-text-muted">
									{creating
										? "Unsaved profile"
										: `Version ${currentProfile?.version ?? 1}`}
								</p>
							</div>
						</div>
						<div
							className="flex h-8 items-center rounded-md border border-border bg-control p-0.5"
							aria-label="Character manager view"
						>
							<button
								type="button"
								onClick={() => void selectView("edit")}
								aria-pressed={view === "edit"}
								className={`flex h-6 items-center gap-1.5 rounded px-2 text-[11px] ${view === "edit" ? "bg-workspace text-text-primary shadow-sm" : "text-text-muted hover:text-text-primary"}`}
							>
								<Pencil className="h-3 w-3" /> Edit
							</button>
							<button
								type="button"
								onClick={() => void selectView("history")}
								aria-pressed={view === "history"}
								className={`flex h-6 items-center gap-1.5 rounded px-2 text-[11px] ${view === "history" ? "bg-workspace text-text-primary shadow-sm" : "text-text-muted hover:text-text-primary"}`}
							>
								<History className="h-3 w-3" /> History
							</button>
						</div>
						<button
							type="button"
							onClick={() => void requestClose()}
							aria-label="Close character manager"
							title="Close (Esc)"
							className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-control hover:text-text-primary"
						>
							<X className="h-4 w-4" />
						</button>
					</header>

					{view === "history" ? (
						<CharacterHistory
							selectedCharacterId={creating ? null : editingId}
							onProfileChange={(profile) => resetEditor(profile)}
							loadHistories={historyLoader}
						/>
					) : (
						<>
							<div className="min-h-0 flex-1 overflow-y-auto">
								{actionError && (
									<div className="flex items-start gap-2 border-b border-danger-border bg-danger-bg px-5 py-3 text-sm text-danger">
										<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
										<p className="min-w-0 flex-1">{actionError}</p>
										{conflict && (
											<button
												type="button"
												onClick={() => void reloadConflict()}
												className="shrink-0 rounded-md border border-danger-border px-2 py-1 text-xs font-medium hover:bg-danger-bg"
											>
												Reload latest
											</button>
										)}
									</div>
								)}

								<div className="border-b border-border px-5 py-5">
									<h3 className="mb-4 text-xs font-semibold text-text-primary">
										Identity
									</h3>
									<div className="grid grid-cols-2 gap-4 max-[860px]:grid-cols-1">
										<TextField
											id={fieldId("name")}
											label="Name"
											value={draft.name}
											onChange={(value) => setField("name", value)}
											error={errors.name}
											maxLength={CHARACTER_LIMITS.name + 1}
											inputRef={nameRef}
										/>
										<TextField
											id={fieldId("avatar")}
											label="Avatar URL or data URI"
											value={draft.avatar}
											onChange={(value) => setField("avatar", value)}
											error={errors.avatar}
											placeholder="Optional"
											maxLength={CHARACTER_LIMITS.avatar + 1}
										/>
									</div>
									<label
										htmlFor={fieldId("description")}
										className="mt-4 block"
									>
										<span className="mb-1.5 block text-xs font-medium text-text-secondary">
											Description
										</span>
										<textarea
											autoComplete="off"
											id={fieldId("description")}
											value={draft.description}
											onChange={(event) =>
												setField("description", event.target.value)
											}
											maxLength={CHARACTER_LIMITS.description + 1}
											rows={3}
											aria-invalid={Boolean(errors.description)}
											className="w-full resize-y rounded-md border border-border bg-control px-3 py-2 text-sm leading-5 text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
										/>
										<FieldError
											id={`${fieldId("description")}-error`}
											message={errors.description}
										/>
									</label>
									<TextField
										id={fieldId("tags")}
										label="Tags"
										value={draft.tags}
										onChange={(value) => setField("tags", value)}
										error={errors.tags}
										placeholder="research, writing, support"
										maxLength={
											CHARACTER_LIMITS.tags * (CHARACTER_LIMITS.tag + 2)
										}
									/>
								</div>

								<div className="border-b border-border px-5 py-5">
									<h3 className="mb-4 text-xs font-semibold text-text-primary">
										Conversation defaults
									</h3>
									<div className="grid grid-cols-2 gap-4 max-[860px]:grid-cols-1">
										<label htmlFor={fieldId("provider")} className="block">
											<span className="mb-1.5 block text-xs font-medium text-text-secondary">
												Provider
											</span>
											<select
												id={fieldId("provider")}
												value={draft.defaultProvider}
												onChange={handleProviderChange}
												aria-invalid={Boolean(errors.defaultProvider)}
												disabled={selectableProviders.length === 0}
												className="h-9 w-full rounded-md border border-border bg-control px-3 text-sm text-text-primary outline-none focus:border-accent"
											>
												{selectableProviders.length === 0 && (
													<option value="">No enabled providers</option>
												)}
												{selectableProviders.map((provider) => (
													<option key={provider.id} value={provider.id}>
														{provider.name}
													</option>
												))}
											</select>
											<FieldError
												id={`${fieldId("provider")}-error`}
												message={errors.defaultProvider}
											/>
										</label>

										<label htmlFor={fieldId("model")} className="block">
											<span className="mb-1.5 block text-xs font-medium text-text-secondary">
												Model
											</span>
											<select
												id={fieldId("model")}
												value={draft.defaultModel}
												onChange={(event) =>
													setField("defaultModel", event.target.value)
												}
												disabled={!selectedProvider || models.length === 0}
												aria-invalid={Boolean(errors.defaultModel)}
												className="h-9 w-full rounded-md border border-border bg-control px-3 text-sm text-text-primary outline-none focus:border-accent disabled:cursor-not-allowed disabled:opacity-60"
											>
												{models.length === 0 && (
													<option value="">No chat models available</option>
												)}
												{models.map((model) => (
													<option key={model.id} value={model.id}>
														{model.name}
														{model.name === model.id ? "" : ` (${model.id})`}
													</option>
												))}
											</select>
											<FieldError
												id={`${fieldId("model")}-error`}
												message={errors.defaultModel}
											/>
										</label>
									</div>
									{!resolvedModelAvailable && (
										<div className="mt-3 flex items-start gap-2 rounded-md border border-warning-border bg-warning-bg px-3 py-2 text-xs text-warning">
											<AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
											<span>
												The selected model is unavailable. Choose an enabled
												provider and model before starting a test conversation.
											</span>
										</div>
									)}

									<label
										htmlFor={fieldId("opening-message")}
										className="mt-4 block"
									>
										<span className="mb-1.5 block text-xs font-medium text-text-secondary">
											Opening message
										</span>
										<textarea
											autoComplete="off"
											id={fieldId("opening-message")}
											value={draft.openingMessage}
											onChange={(event) =>
												setField("openingMessage", event.target.value)
											}
											maxLength={CHARACTER_LIMITS.openingMessage + 1}
											rows={4}
											aria-invalid={Boolean(errors.openingMessage)}
											className="w-full resize-y rounded-md border border-border bg-control px-3 py-2 text-sm leading-5 text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
										/>
										<FieldError
											id={`${fieldId("opening-message")}-error`}
											message={errors.openingMessage}
										/>
									</label>
								</div>

								{editingId && !creating && (
									<CharacterMemorySettings characterId={editingId} />
								)}

								<div className="px-5 py-5">
									<div className="mb-2 flex items-center justify-between gap-3">
										<h3 className="text-xs font-semibold text-text-primary">
											Global prompt
										</h3>
										<span
											title="Local UTF-8 estimate; this is not provider usage"
											className="shrink-0 text-[11px] tabular-nums text-text-muted"
										>
											~{promptTokens.toLocaleString()} estimated tokens
										</span>
									</div>
									<textarea
										autoComplete="off"
										id={fieldId("system-prompt")}
										value={draft.systemPrompt}
										onChange={(event) =>
											setField("systemPrompt", event.target.value)
										}
										maxLength={CHARACTER_LIMITS.systemPrompt + 1}
										rows={12}
										spellCheck
										aria-invalid={Boolean(errors.systemPrompt)}
										aria-describedby={`${fieldId("system-prompt")}-help`}
										className="min-h-60 w-full resize-y rounded-md border border-border bg-control px-3 py-3 font-mono text-[13px] leading-5 text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
									/>
									<FieldError
										id={`${fieldId("system-prompt")}-error`}
										message={errors.systemPrompt}
									/>
									<details
										id={`${fieldId("system-prompt")}-help`}
										className="mt-3 text-xs text-text-muted"
									>
										<summary className="flex cursor-pointer list-none items-center gap-1.5 text-text-secondary hover:text-text-primary">
											<Info className="h-3.5 w-3.5" />
											Prompt variables
										</summary>
										<p className="mt-2 max-w-2xl leading-5">
											Prompt text is currently inserted exactly as written.
											Character name and description are supplied separately;
											template variables are not expanded in this version.
										</p>
									</details>
								</div>
							</div>

							<footer className="flex min-h-16 shrink-0 flex-wrap items-center gap-2 border-t border-border bg-workspace px-4 py-3">
								<button
									type="button"
									onClick={() => void duplicateDraft()}
									disabled={!draft.name.trim() || saving}
									className="flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm text-text-secondary hover:bg-control hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
								>
									<Copy className="h-3.5 w-3.5" />
									Duplicate
								</button>
								<button
									type="button"
									onClick={() => void deleteCurrent()}
									disabled={
										creating ||
										currentProfile?.id === DEFAULT_CHARACTER_ID ||
										saving
									}
									title={
										currentProfile?.id === DEFAULT_CHARACTER_ID
											? "The default character cannot be deleted"
											: "Delete character"
									}
									className="flex h-9 items-center gap-2 rounded-md px-3 text-sm text-danger hover:bg-danger-bg disabled:cursor-not-allowed disabled:opacity-40"
								>
									<Trash2 className="h-3.5 w-3.5" />
									Delete
								</button>
								<div className="min-w-2 flex-1" />
								{dirty && (
									<button
										type="button"
										onClick={() => resetEditor(currentProfile)}
										disabled={saving}
										className="flex h-9 items-center gap-2 rounded-md px-3 text-sm text-text-secondary hover:bg-control hover:text-text-primary disabled:opacity-50"
									>
										<RotateCcw className="h-3.5 w-3.5" />
										Cancel changes
									</button>
								)}
								<button
									type="button"
									onClick={() => void persistDraft()}
									disabled={!dirty || !valid || saving}
									className="flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-text-primary hover:bg-control disabled:cursor-not-allowed disabled:opacity-50"
								>
									{saving ? (
										<Loader2 className="h-3.5 w-3.5 animate-spin" />
									) : (
										<Save className="h-3.5 w-3.5" />
									)}
									Save
								</button>
								<button
									type="button"
									onClick={() => void startTestConversation()}
									disabled={!valid || !resolvedModelAvailable || saving}
									className="flex h-9 items-center gap-2 rounded-md bg-accent px-3 text-sm font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
								>
									<MessageSquare className="h-3.5 w-3.5" />
									Test conversation
								</button>
							</footer>
						</>
					)}
				</section>
			</dialog>
		</div>
	);
}

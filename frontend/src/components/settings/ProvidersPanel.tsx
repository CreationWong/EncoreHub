import { ArrowLeft, Plus, Search, Server } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProviderProfile } from "../../services/providers";
import { confirm } from "../../stores/confirmStore";
import { useProviderStore } from "../../stores/providerStore";
import { useSecretsStore } from "../../stores/secretsStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { toast } from "../../stores/toastStore";
import ProviderDebugPanel, {
	type ProviderDebugTarget,
} from "./ProviderDebugPanel";
import ProviderDetail, { type ProviderDraftController } from "./ProviderDetail";
import ProviderFormModal from "./ProviderFormModal";
import {
	type ProviderRuntimeStatus,
	defaultProviderRuntimeStatus,
	providerRuntimeStatusPresentation,
} from "./providerRuntimeStatus";
import { registerSettingsLeaveGuard } from "./settingsLeaveGuard";

const LAST_SETTINGS_PROVIDER_KEY = "encorehub-settings-provider";

function providerInitial(name: string): string {
	return name.trim().charAt(0).toUpperCase() || "P";
}

function loadLastSettingsProvider(): string | null {
	if (typeof window === "undefined") return null;
	try {
		return localStorage.getItem(LAST_SETTINGS_PROVIDER_KEY);
	} catch {
		return null;
	}
}

function rememberSettingsProvider(id: string | null): void {
	if (typeof window === "undefined") return;
	try {
		if (id) localStorage.setItem(LAST_SETTINGS_PROVIDER_KEY, id);
		else localStorage.removeItem(LAST_SETTINGS_PROVIDER_KEY);
	} catch {
		/* Preference persistence must not block provider configuration. */
	}
}

export default function ProvidersPanel() {
	const apiKeys = useSettingsStore((state) => state.apiKeys);
	const setApiKey = useSettingsStore((state) => state.setApiKey);
	const clearApiKey = useSettingsStore((state) => state.clearApiKey);
	const loadKeys = useSettingsStore((state) => state.loadKeys);
	const devMode = useSettingsStore((state) => state.devMode);

	const profiles = useProviderStore((state) => state.profiles);
	const loading = useProviderStore((state) => state.loading);
	const loaded = useProviderStore((state) => state.loaded);
	const upsert = useProviderStore((state) => state.upsert);
	const removeProfile = useProviderStore((state) => state.remove);

	const encrypted = useSecretsStore((state) => state.encrypted);
	const unlocked = useSecretsStore((state) => state.unlocked);
	const storedIds = useSecretsStore((state) => state.storedIds);
	const refreshSecrets = useSecretsStore((state) => state.refresh);

	useEffect(() => {
		void loadKeys();
		void refreshSecrets();
	}, [loadKeys, refreshSecrets]);

	const [drafts, setDrafts] = useState<ProviderProfile[]>([]);
	const [selectedId, setSelectedId] = useState<string | null>(
		loadLastSettingsProvider,
	);
	const [creating, setCreating] = useState(false);
	const [query, setQuery] = useState("");
	const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
	const [debugTarget, setDebugTarget] = useState<ProviderDebugTarget | null>(
		null,
	);
	const [runtimeStatuses, setRuntimeStatuses] = useState<
		Record<string, ProviderRuntimeStatus>
	>({});
	const draftControllersRef = useRef(
		new Map<string, ProviderDraftController>(),
	);
	const [dirtyProviderIds, setDirtyProviderIds] = useState<Set<string>>(
		() => new Set(),
	);

	const handleRuntimeStatusChange = useCallback(
		(providerId: string, status: ProviderRuntimeStatus) => {
			setRuntimeStatuses((current) =>
				current[providerId] === status
					? current
					: { ...current, [providerId]: status },
			);
		},
		[],
	);

	const list = useMemo(
		() => [
			...profiles,
			...drafts.filter(
				(draft) => !profiles.some((profile) => profile.id === draft.id),
			),
		],
		[profiles, drafts],
	);

	useEffect(() => {
		if (selectedId && list.some((profile) => profile.id === selectedId)) return;
		if (!loaded && list.length === 0) return;
		const fallbackId = list[0]?.id ?? null;
		setSelectedId(fallbackId);
		rememberSettingsProvider(fallbackId);
	}, [list, loaded, selectedId]);

	const filtered = useMemo(() => {
		const normalizedQuery = query.trim().toLowerCase();
		if (!normalizedQuery) return list;
		return list.filter((profile) =>
			[profile.name, profile.id, profile.protocol].some((value) =>
				value.toLowerCase().includes(normalizedQuery),
			),
		);
	}, [list, query]);

	const selected = list.find((profile) => profile.id === selectedId) ?? null;
	const vaultLocked = encrypted && !unlocked;

	const handleDraftControllerChange = useCallback(
		(providerId: string, controller: ProviderDraftController | null) => {
			if (controller) draftControllersRef.current.set(providerId, controller);
			else draftControllersRef.current.delete(providerId);
			setDirtyProviderIds((current) => {
				const next = new Set(current);
				if (controller?.dirty) next.add(providerId);
				else next.delete(providerId);
				if (
					next.size === current.size &&
					[...next].every((id) => current.has(id))
				) {
					return current;
				}
				return next;
			});
		},
		[],
	);

	const requestLeave = useCallback(async (): Promise<boolean> => {
		const dirtyIds = [...dirtyProviderIds].filter((id) =>
			draftControllersRef.current.has(id),
		);
		if (dirtyIds.length === 0) return true;

		const choice = await confirm.choose({
			title: "Unsaved provider changes",
			message:
				dirtyIds.length === 1
					? "This provider has unsaved changes. Save them before leaving Providers?"
					: `${dirtyIds.length} providers have unsaved changes. Save them before leaving Providers?`,
			confirmLabel: "Save changes",
			discardLabel: "Don't save",
			cancelLabel: "Cancel",
		});
		if (choice === "cancel") return false;
		if (choice === "discard") {
			for (const id of dirtyIds) {
				draftControllersRef.current.get(id)?.discard();
			}
			const dirtyIdSet = new Set(dirtyIds);
			setDrafts((current) =>
				current.filter((draft) => !dirtyIdSet.has(draft.id)),
			);
			setDirtyProviderIds(new Set());
			return true;
		}

		for (const id of dirtyIds) {
			const controller = draftControllersRef.current.get(id);
			if (!controller) continue;
			setSelectedId(id);
			rememberSettingsProvider(id);
			setMobileDetailOpen(true);
			if (!(await controller.save())) return false;
		}
		return true;
	}, [dirtyProviderIds]);

	useEffect(() => registerSettingsLeaveGuard(requestLeave), [requestLeave]);

	const handleCreated = (draft: ProviderProfile) => {
		setDrafts((current) => [...current, draft]);
		setSelectedId(draft.id);
		rememberSettingsProvider(draft.id);
		setCreating(false);
		setMobileDetailOpen(true);
	};

	const handleDelete = async (profile: ProviderProfile) => {
		if (!profiles.some((item) => item.id === profile.id)) {
			setDrafts((current) => current.filter((item) => item.id !== profile.id));
			if (selectedId === profile.id) {
				setSelectedId(null);
				setMobileDetailOpen(false);
			}
			return;
		}
		if (
			!(await confirm.ask(
				"Delete provider",
				`Delete provider "${profile.name}"? This cannot be undone.`,
				true,
			))
		) {
			return;
		}
		try {
			await removeProfile(profile.id);
			if (selectedId === profile.id) {
				setSelectedId(null);
				setMobileDetailOpen(false);
			}
			toast.success(`Removed ${profile.name}`);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to delete provider",
			);
		}
	};

	return (
		<div className="relative flex h-full min-h-0 overflow-hidden bg-surface">
			{creating && (
				<ProviderFormModal
					onCreated={handleCreated}
					onClose={() => setCreating(false)}
				/>
			)}

			<aside
				data-mobile-pane="provider-list"
				className={`flex w-60 shrink-0 flex-col border-r border-border bg-surface-alt max-[900px]:w-48 max-[700px]:w-full max-[700px]:border-r-0 ${
					mobileDetailOpen ? "max-[700px]:hidden" : ""
				}`}
			>
				<div className="border-b border-border p-3">
					<div className="relative">
						<Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
						<input
							autoComplete="off"
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder="Search providers"
							aria-label="Search providers"
							className="w-full rounded-md border border-border bg-surface py-2 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted"
						/>
					</div>
				</div>

				<div className="min-h-0 flex-1 overflow-y-auto p-2">
					{loading && list.length === 0 ? (
						<p className="px-2 py-4 text-xs text-text-muted">Loading...</p>
					) : filtered.length === 0 ? (
						<div className="flex min-h-32 flex-col items-center justify-center gap-2 px-4 text-center text-xs text-text-muted">
							<Server className="h-5 w-5" />
							{list.length === 0
								? "No providers configured"
								: "No providers match your search"}
						</div>
					) : (
						filtered.map((profile) => {
							const draft = !profiles.some((item) => item.id === profile.id);
							const selectedProfile = selectedId === profile.id;
							const runtimeStatus =
								runtimeStatuses[profile.id] ??
								defaultProviderRuntimeStatus(profile.enabled, draft);
							const statusPresentation =
								providerRuntimeStatusPresentation(runtimeStatus);
							return (
								<button
									key={profile.id}
									type="button"
									onClick={() => {
										setSelectedId(profile.id);
										rememberSettingsProvider(profile.id);
										setMobileDetailOpen(true);
									}}
									aria-current={selectedProfile ? "page" : undefined}
									className={`mb-1 flex w-full items-center gap-2.5 rounded-md border px-2.5 py-2 text-left transition-colors ${
										selectedProfile
											? "border-border bg-surface text-text-primary shadow-sm"
											: "border-transparent text-text-secondary hover:bg-surface-hover hover:text-text-primary"
									}`}
								>
									<span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-hover text-xs font-semibold text-text-secondary">
										{providerInitial(profile.name)}
									</span>
									<span className="min-w-0 flex-1">
										<span className="flex min-w-0 items-center gap-1.5">
											<span className="truncate text-sm font-medium">
												{profile.name}
											</span>
											{draft && (
												<span className="shrink-0 rounded bg-warning-bg px-1 py-0.5 text-[9px] uppercase text-warning">
													draft
												</span>
											)}
										</span>
										<span className="block truncate text-[11px] text-text-muted">
											{profile.protocol === "anthropic"
												? "Anthropic Messages"
												: profile.protocol === "openai-responses"
													? "OpenAI Responses API"
													: "OpenAI compatible"}{" "}
											/ {profile.models.length} models
										</span>
									</span>
									<span
										className={`h-2.5 w-2.5 shrink-0 rounded-full ${
											statusPresentation.className
										} ${statusPresentation.pulse ? "animate-pulse" : ""}`}
										aria-label={`${profile.name} status: ${statusPresentation.label}`}
										title={statusPresentation.label}
									/>
								</button>
							);
						})
					)}
				</div>

				<div className="border-t border-border p-2">
					<button
						type="button"
						onClick={() => setCreating(true)}
						className="flex h-9 w-full items-center justify-center gap-2 rounded-md border border-border bg-surface text-sm text-text-secondary hover:bg-surface-hover hover:text-text-primary"
					>
						<Plus className="h-4 w-4" />
						Add provider
					</button>
				</div>
			</aside>

			<div
				data-mobile-pane="provider-detail"
				className={`min-w-0 flex-1 flex-col ${
					mobileDetailOpen ? "flex" : "flex max-[700px]:hidden"
				}`}
			>
				{selected ? (
					<>
						<div className="hidden h-11 shrink-0 items-center gap-2 border-b border-border bg-surface px-2 max-[700px]:flex">
							<button
								type="button"
								onClick={() => setMobileDetailOpen(false)}
								aria-label="Back to provider list"
								className="flex h-8 items-center gap-1 rounded-md px-2 text-sm text-text-secondary hover:bg-surface-hover hover:text-text-primary"
							>
								<ArrowLeft className="h-4 w-4" />
								Providers
							</button>
							<span className="min-w-0 flex-1 truncate text-right text-xs text-text-muted">
								{selected.name}
							</span>
						</div>
						<div className="min-h-0 flex-1">
							{list.map((profile) => {
								const profileIsDraft = !profiles.some(
									(item) => item.id === profile.id,
								);
								const profileKeyStored =
									storedIds.includes(profile.id) ||
									(apiKeys[profile.id]?.length ?? 0) > 0;
								return (
									<div
										key={profile.id}
										data-provider-detail={profile.id}
										hidden={profile.id !== selected.id}
										className="h-full"
									>
										<ProviderDetail
											profile={profile}
											isDraft={profileIsDraft}
											apiKey={apiKeys[profile.id] ?? ""}
											vaultLocked={vaultLocked}
											keyStored={profileKeyStored}
											onStatusChange={handleRuntimeStatusChange}
											onDraftControllerChange={handleDraftControllerChange}
											onSetKey={(value) => setApiKey(profile.id, value)}
											onClearKey={() => clearApiKey(profile.id)}
											onSave={async (next) => {
												await upsert(next);
												setDrafts((current) =>
													current.filter((draft) => draft.id !== next.id),
												);
											}}
											onDelete={() => void handleDelete(profile)}
											onOpenDebug={
												devMode
													? (matchers) =>
															setDebugTarget({
																id: profile.id,
																name: profile.name,
																matchers,
															})
													: undefined
											}
										/>
									</div>
								);
							})}
						</div>
					</>
				) : (
					<div className="flex h-full flex-col items-center justify-center gap-3 text-center text-sm text-text-muted">
						<Server className="h-6 w-6" />
						<span>Select a provider to configure it</span>
					</div>
				)}
			</div>
			{devMode && debugTarget && (
				<ProviderDebugPanel
					key={debugTarget.id}
					target={debugTarget}
					onClose={() => setDebugTarget(null)}
				/>
			)}
		</div>
	);
}

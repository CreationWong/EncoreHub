import { Plus, Search, Server } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ProviderProfile } from "../../services/providers";
import { confirm } from "../../stores/confirmStore";
import { useProviderStore } from "../../stores/providerStore";
import { useSecretsStore } from "../../stores/secretsStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { toast } from "../../stores/toastStore";
import ProviderDetail from "./ProviderDetail";
import ProviderFormModal from "./ProviderFormModal";

function providerInitial(name: string): string {
	return name.trim().charAt(0).toUpperCase() || "P";
}

export default function ProvidersPanel() {
	const apiKeys = useSettingsStore((state) => state.apiKeys);
	const setApiKey = useSettingsStore((state) => state.setApiKey);
	const clearApiKey = useSettingsStore((state) => state.clearApiKey);
	const loadKeys = useSettingsStore((state) => state.loadKeys);

	const profiles = useProviderStore((state) => state.profiles);
	const loading = useProviderStore((state) => state.loading);
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
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);
	const [query, setQuery] = useState("");

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
		setSelectedId(list[0]?.id ?? null);
	}, [list, selectedId]);

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
	const isDraft =
		selected !== null &&
		!profiles.some((profile) => profile.id === selected.id);
	const vaultLocked = encrypted && !unlocked;
	const keyStored =
		selected !== null &&
		(storedIds.includes(selected.id) ||
			(apiKeys[selected.id]?.length ?? 0) > 0);

	const handleCreated = (draft: ProviderProfile) => {
		setDrafts((current) => [...current, draft]);
		setSelectedId(draft.id);
		setCreating(false);
	};

	const handleDelete = async (profile: ProviderProfile) => {
		if (!profiles.some((item) => item.id === profile.id)) {
			setDrafts((current) => current.filter((item) => item.id !== profile.id));
			if (selectedId === profile.id) setSelectedId(null);
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
			if (selectedId === profile.id) setSelectedId(null);
			toast.success(`Removed ${profile.name}`);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to delete provider",
			);
		}
	};

	return (
		<div className="flex h-full min-h-0 bg-surface">
			{creating && (
				<ProviderFormModal
					onCreated={handleCreated}
					onClose={() => setCreating(false)}
				/>
			)}

			<aside className="flex w-60 shrink-0 flex-col border-r border-border bg-surface-alt max-[900px]:w-48">
				<div className="border-b border-border p-3">
					<div className="relative">
						<Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
						<input
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
							return (
								<button
									key={profile.id}
									type="button"
									onClick={() => setSelectedId(profile.id)}
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
												: "OpenAI compatible"}{" "}
											/ {profile.models.length} models
										</span>
									</span>
									<span
										className={`h-2 w-2 shrink-0 rounded-full ${
											profile.enabled ? "bg-success" : "bg-border"
										}`}
										title={profile.enabled ? "Enabled" : "Disabled"}
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

			<div className="min-w-0 flex-1">
				{selected ? (
					<ProviderDetail
						key={selected.id}
						profile={selected}
						isDraft={isDraft}
						apiKey={apiKeys[selected.id] ?? ""}
						vaultLocked={vaultLocked}
						keyStored={keyStored}
						onSetKey={(value) => setApiKey(selected.id, value)}
						onClearKey={() => clearApiKey(selected.id)}
						onSave={async (next) => {
							await upsert(next);
							setDrafts((current) =>
								current.filter((draft) => draft.id !== next.id),
							);
						}}
						onDelete={() => void handleDelete(selected)}
					/>
				) : (
					<div className="flex h-full flex-col items-center justify-center gap-3 text-center text-sm text-text-muted">
						<Server className="h-6 w-6" />
						<span>Select a provider to configure it</span>
					</div>
				)}
			</div>
		</div>
	);
}

import { Eye, EyeOff, Lock, LockOpen, Plus, Save, Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { keyHintFor } from "../../constants/providers";
import type { ProviderProfile } from "../../services/providers";
import { useProviderStore } from "../../stores/providerStore";
import { useSecretsStore } from "../../stores/secretsStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { toast } from "../../stores/toastStore";
import ProviderFormModal from "./ProviderFormModal";

export default function ProvidersPanel() {
	const apiKeys = useSettingsStore((s) => s.apiKeys);
	const setApiKey = useSettingsStore((s) => s.setApiKey);
	const clearApiKey = useSettingsStore((s) => s.clearApiKey);
	const loadKeys = useSettingsStore((s) => s.loadKeys);

	const profiles = useProviderStore((s) => s.profiles);
	const loading = useProviderStore((s) => s.loading);
	const upsert = useProviderStore((s) => s.upsert);
	const removeProfile = useProviderStore((s) => s.remove);

	const encrypted = useSecretsStore((s) => s.encrypted);
	const unlocked = useSecretsStore((s) => s.unlocked);
	const storedIds = useSecretsStore((s) => s.storedIds);
	const refreshSecrets = useSecretsStore((s) => s.refresh);

	// Re-pull keys + encryption state whenever the panel opens. The startup
	// load (App.tsx) can race the engine's in-process warmup and come back
	// empty; by the time the user reaches Settings the engine is ready, so this
	// reliably populates the stored key even if the startup attempt missed.
	useEffect(() => {
		loadKeys();
		refreshSecrets();
	}, [loadKeys, refreshSecrets]);

	// Local drafts: providers created via the Add dialog but not yet persisted
	// (they lack a base_url/models, which the gateway requires). They live here
	// until their first successful save.
	const [drafts, setDrafts] = useState<ProviderProfile[]>([]);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);

	// The list shown in the left column: persisted profiles plus pending drafts.
	const list = [
		...profiles,
		...drafts.filter((d) => !profiles.some((p) => p.id === d.id)),
	];
	const selected = list.find((p) => p.id === selectedId) ?? null;
	const isDraft =
		selected !== null && !profiles.some((p) => p.id === selected.id);

	const vaultLocked = encrypted && !unlocked;

	const handleCreated = (draft: ProviderProfile) => {
		setDrafts((d) => [...d, draft]);
		setSelectedId(draft.id);
		setCreating(false);
	};

	const handleDelete = async (p: ProviderProfile) => {
		// Drafts only exist locally — drop without touching the gateway.
		if (!profiles.some((pp) => pp.id === p.id)) {
			setDrafts((d) => d.filter((x) => x.id !== p.id));
			if (selectedId === p.id) setSelectedId(null);
			return;
		}
		const { confirm } = await import("../../stores/confirmStore");
		if (
			!(await confirm.ask(
				"Delete Provider",
				`Delete provider "${p.name}"? This cannot be undone.`,
				true,
			))
		)
			return;
		try {
			await removeProfile(p.id);
			if (selectedId === p.id) setSelectedId(null);
			toast.success(`Removed ${p.name}`);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : "Failed to delete provider");
		}
	};

	const handleSaved = (saved: ProviderProfile) => {
		// Once persisted, the draft is gone — it now lives in the store.
		setDrafts((d) => d.filter((x) => x.id !== saved.id));
	};

	// A key is "stored" if the engine lists it (works even while locked) or we
	// already hold it in session memory.
	const keyStored =
		selected !== null &&
		(storedIds.includes(selected.id) ||
			(apiKeys[selected.id]?.length ?? 0) > 0);

	return (
		<div className="flex h-full min-h-0 gap-4">
			{creating && (
				<ProviderFormModal
					onCreated={handleCreated}
					onClose={() => setCreating(false)}
				/>
			)}

			{/* Left: provider list + add */}
			<div className="flex w-56 shrink-0 flex-col">
				<div className="mb-2 flex items-center justify-between">
					<h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
						Providers
					</h3>
					<button
						type="button"
						onClick={() => setCreating(true)}
						aria-label="Add provider"
						title="Add provider"
						className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-text-secondary hover:bg-surface-hover hover:text-text-primary"
					>
						<Plus className="h-3.5 w-3.5" />
						Add
					</button>
				</div>
				<div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
					{loading && list.length === 0 ? (
						<p className="px-2 text-xs text-text-muted">Loading…</p>
					) : list.length === 0 ? (
						<p className="px-2 text-xs text-text-muted">
							No providers. Add one to get started.
						</p>
					) : (
						list.map((p) => {
							const draft = !profiles.some((pp) => pp.id === p.id);
							return (
								<button
									key={p.id}
									type="button"
									onClick={() => setSelectedId(p.id)}
									className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
										selectedId === p.id
											? "border-accent bg-accent/10"
											: "border-transparent hover:bg-surface-hover"
									}`}
								>
									<div className="flex items-center gap-1.5">
										<span className="truncate text-sm text-text-primary">
											{p.name}
										</span>
										{p.builtin && (
											<span className="rounded bg-surface px-1 py-0.5 text-[9px] uppercase text-text-muted">
												builtin
											</span>
										)}
										{draft && (
											<span className="rounded bg-warning-bg px-1 py-0.5 text-[9px] uppercase text-warning">
												draft
											</span>
										)}
										{!draft && !p.enabled && (
											<span className="rounded bg-surface px-1 py-0.5 text-[9px] uppercase text-text-muted">
												off
											</span>
										)}
									</div>
									<p className="truncate text-[11px] text-text-muted">
										{p.protocol} · {p.models.length} model
										{p.models.length === 1 ? "" : "s"}
									</p>
								</button>
							);
						})
					)}
				</div>
			</div>

			{/* Right: detail / config */}
			<div className="min-w-0 flex-1 border-l border-border pl-4">
				{selected ? (
					<ProviderDetail
						key={selected.id}
						profile={selected}
						isDraft={isDraft}
						apiKey={apiKeys[selected.id] ?? ""}
						vaultLocked={vaultLocked}
						keyStored={keyStored}
						onSetKey={(v) => setApiKey(selected.id, v)}
						onClearKey={async () => {
							await clearApiKey(selected.id);
							// Refresh stored-key ids so the masked indicator clears too.
							refreshSecrets();
						}}
						onSave={async (next) => {
							await upsert(next);
							handleSaved(next);
						}}
						onDelete={() => handleDelete(selected)}
					/>
				) : (
					<div className="flex h-full items-center justify-center text-sm text-text-muted">
						Select a provider to configure it, or add a new one.
					</div>
				)}
			</div>
		</div>
	);
}

interface DetailProps {
	profile: ProviderProfile;
	isDraft: boolean;
	apiKey: string;
	vaultLocked: boolean;
	keyStored: boolean;
	onSetKey: (value: string) => void;
	onClearKey: () => void;
	onSave: (next: ProviderProfile) => Promise<void>;
	onDelete: () => void;
}

/** Config form for one provider: endpoint, API key, and model list. */
function ProviderDetail({
	profile,
	isDraft,
	apiKey,
	vaultLocked,
	keyStored,
	onSetKey,
	onClearKey,
	onSave,
	onDelete,
}: DetailProps) {
	const [baseUrl, setBaseUrl] = useState(profile.base_url);
	const [modelsText, setModelsText] = useState(profile.models.join("\n"));
	const [enabled, setEnabled] = useState(profile.enabled);
	const [reveal, setReveal] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Inline unlock prompt: shown when the user asks to reveal a key that's
	// stored encrypted while the vault is locked.
	const unlock = useSecretsStore((s) => s.unlock);
	const loadKeys = useSettingsStore((s) => s.loadKeys);
	const [unlocking, setUnlocking] = useState(false);
	const [pw, setPw] = useState("");
	const [unlockBusy, setUnlockBusy] = useState(false);

	// Builtins fall back to the SDK default endpoint, so an empty base_url is fine.
	const allowEmptyBase = profile.protocol === "openai" && profile.builtin;

	// The key is stored encrypted and we can't read it yet — show a masked
	// placeholder instead of an empty field, and gate reveal behind the password.
	const lockedStored = vaultLocked && keyStored;

	const submitUnlock = async (e: FormEvent) => {
		e.preventDefault();
		setUnlockBusy(true);
		try {
			await unlock(pw);
			// Now unlocked — pull the decrypted keys back into the store so this
			// field can show the plaintext.
			await loadKeys();
			setReveal(true);
			setPw("");
			setUnlocking(false);
			toast.success("Unlocked — key revealed");
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Incorrect password");
		} finally {
			setUnlockBusy(false);
		}
	};

	const handleSave = async () => {
		const models = modelsText
			.split(/[\n,]/)
			.map((m) => m.trim())
			.filter(Boolean);
		if (!baseUrl.trim() && !allowEmptyBase) {
			setError("API endpoint is required");
			return;
		}
		if (models.length === 0) {
			setError("At least one model is required");
			return;
		}

		setSaving(true);
		setError(null);
		try {
			await onSave({
				...profile,
				base_url: baseUrl.trim(),
				models,
				enabled,
			});
			toast.success(`Saved ${profile.name}`);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Failed to save provider");
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="mb-4 flex items-center justify-between">
				<div className="min-w-0">
					<div className="flex items-center gap-2">
						<h3 className="truncate text-sm font-semibold text-text-primary">
							{profile.name}
						</h3>
						{profile.builtin && (
							<span className="rounded bg-surface px-1.5 py-0.5 text-[10px] uppercase text-text-muted">
								builtin
							</span>
						)}
					</div>
					<p className="text-xs text-text-muted">
						{profile.protocol === "anthropic"
							? "Anthropic"
							: "OpenAI-compatible"}{" "}
						· id: {profile.id}
					</p>
				</div>
				<button
					type="button"
					disabled={profile.builtin}
					onClick={onDelete}
					aria-label={`Delete ${profile.name}`}
					title={
						profile.builtin ? "Builtin providers cannot be deleted" : "Delete"
					}
					className="rounded-lg border border-border px-2 py-1 text-text-muted hover:bg-danger-bg hover:text-danger disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-text-muted"
				>
					<Trash2 className="h-3.5 w-3.5" />
				</button>
			</div>

			<div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
				<div>
					<label
						htmlFor="detail-baseurl"
						className="text-xs font-medium text-text-secondary"
					>
						API endpoint
					</label>
					<input
						id="detail-baseurl"
						value={baseUrl}
						onChange={(e) => setBaseUrl(e.target.value)}
						placeholder={
							profile.protocol === "anthropic"
								? "https://api.anthropic.com/v1"
								: "https://api.openai.com/v1"
						}
						className="mt-1 w-full rounded-lg border border-border bg-surface-alt px-3 py-2 font-mono text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50"
					/>
					{allowEmptyBase && (
						<p className="mt-1 text-[11px] text-text-muted">
							Leave blank to use the builtin default endpoint.
						</p>
					)}
				</div>

				<div>
					<label
						htmlFor="detail-key"
						className="text-xs font-medium text-text-secondary"
					>
						API key
					</label>
					{lockedStored ? (
						<p className="mt-0.5 mb-1 flex items-start gap-1.5 text-[11px] text-text-muted">
							<Lock className="mt-0.5 h-3 w-3 shrink-0" />A key is stored,
							encrypted at rest. Click the eye to enter your master password and
							reveal or change it.
						</p>
					) : vaultLocked ? (
						<p className="mt-0.5 mb-1 flex items-start gap-1.5 text-[11px] text-warning">
							<Lock className="mt-0.5 h-3 w-3 shrink-0" />
							Vault is locked — keys entered now will only last this session.
							Unlock in the Security tab to persist them.
						</p>
					) : (
						<p className="mt-0.5 mb-1 text-[11px] text-text-muted">
							Keys are saved to disk automatically. Enable encryption in the
							Security tab to protect them at rest.
						</p>
					)}
					{lockedStored ? (
						<>
							<div className="flex gap-2">
								<div className="flex flex-1 items-center gap-2 rounded-lg border border-border bg-surface-alt px-3 py-2">
									<span className="flex-1 truncate font-mono text-xs tracking-widest text-text-muted">
										••••••••••••••••
									</span>
									<span className="shrink-0 rounded bg-surface px-1.5 py-0.5 text-[9px] uppercase text-text-muted">
										encrypted
									</span>
								</div>
								<button
									type="button"
									onClick={() => setUnlocking((v) => !v)}
									className="rounded-lg border border-border px-2 text-text-muted hover:bg-surface-hover hover:text-text-primary"
									aria-label="Unlock to view API key"
									title="Enter password to view"
								>
									<Eye className="h-3.5 w-3.5" />
								</button>
								<button
									type="button"
									onClick={onClearKey}
									aria-label="Clear API key"
									className="rounded-lg border border-border px-2 text-text-muted hover:bg-danger-bg hover:text-danger"
									title="Clear"
								>
									<Trash2 className="h-3.5 w-3.5" />
								</button>
							</div>
							{unlocking && (
								<form onSubmit={submitUnlock} className="mt-2 flex gap-2">
									<input
										type="password"
										value={pw}
										onChange={(e) => setPw(e.target.value)}
										placeholder="Master password"
										// biome-ignore lint/a11y/noAutofocus: reveal prompt should focus immediately
										autoFocus
										className="flex-1 rounded-lg border border-border bg-surface-alt px-3 py-2 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50"
									/>
									<button
										type="submit"
										disabled={unlockBusy || !pw}
										className="flex items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-medium text-white hover:bg-accent/90 disabled:opacity-40"
									>
										<LockOpen className="h-3.5 w-3.5" />
										Unlock
									</button>
								</form>
							)}
						</>
					) : (
						<div className="flex gap-2">
							<input
								id="detail-key"
								type={reveal ? "text" : "password"}
								value={apiKey}
								onChange={(e) => onSetKey(e.target.value)}
								placeholder={keyHintFor(profile.protocol)}
								className="flex-1 rounded-lg border border-border bg-surface-alt px-3 py-2 font-mono text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50"
							/>
							<button
								type="button"
								onClick={() => setReveal((v) => !v)}
								className="rounded-lg border border-border px-2 text-text-muted hover:bg-surface-hover hover:text-text-primary"
								aria-label={reveal ? "Hide API key" : "Show API key"}
								title={reveal ? "Hide" : "Show"}
							>
								{reveal ? (
									<EyeOff className="h-3.5 w-3.5" />
								) : (
									<Eye className="h-3.5 w-3.5" />
								)}
							</button>
							{apiKey && (
								<button
									type="button"
									onClick={onClearKey}
									aria-label="Clear API key"
									className="rounded-lg border border-border px-2 text-text-muted hover:bg-danger-bg hover:text-danger"
									title="Clear"
								>
									<Trash2 className="h-3.5 w-3.5" />
								</button>
							)}
						</div>
					)}
				</div>

				<div>
					<label
						htmlFor="detail-models"
						className="text-xs font-medium text-text-secondary"
					>
						Models
					</label>
					<textarea
						id="detail-models"
						value={modelsText}
						onChange={(e) => setModelsText(e.target.value)}
						rows={6}
						placeholder={"gpt-4o\ngpt-4o-mini"}
						className="mt-1 w-full rounded-lg border border-border bg-surface-alt px-3 py-2 font-mono text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50"
					/>
					<p className="mt-1 text-[11px] text-text-muted">
						One per line (or comma-separated).
					</p>
				</div>

				<label className="flex items-center gap-2 text-xs text-text-secondary">
					<input
						type="checkbox"
						checked={enabled}
						onChange={(e) => setEnabled(e.target.checked)}
						className="rounded border-border"
					/>
					Enabled (selectable for chat)
				</label>

				{error && (
					<p className="rounded-lg bg-danger-bg px-3 py-2 text-xs text-danger">
						{error}
					</p>
				)}
			</div>

			<div className="mt-4 flex justify-end border-t border-border pt-4">
				<button
					type="button"
					onClick={handleSave}
					disabled={saving}
					className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-60"
				>
					<Save className="h-3.5 w-3.5" />
					{saving ? "Saving…" : isDraft ? "Create provider" : "Save changes"}
				</button>
			</div>
		</div>
	);
}

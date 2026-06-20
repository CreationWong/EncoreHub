import { Eye, EyeOff, Lock, Pencil, Plus, Save, Trash2 } from "lucide-react";
import { useState } from "react";
import { keyHintFor } from "../../constants/providers";
import type { ProviderProfile } from "../../services/providers";
import { secretsApi } from "../../services/secrets";
import { useProviderStore } from "../../stores/providerStore";
import { useSecretsStore } from "../../stores/secretsStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { toast } from "../../stores/toastStore";
import ProviderFormModal from "./ProviderFormModal";

export default function ProvidersPanel() {
	const provider = useSettingsStore((s) => s.provider);
	const model = useSettingsStore((s) => s.model);
	const apiKeys = useSettingsStore((s) => s.apiKeys);
	const setProvider = useSettingsStore((s) => s.setProvider);
	const setModel = useSettingsStore((s) => s.setModel);
	const setApiKey = useSettingsStore((s) => s.setApiKey);
	const clearApiKey = useSettingsStore((s) => s.clearApiKey);

	const profiles = useProviderStore((s) => s.profiles);
	const loading = useProviderStore((s) => s.loading);
	const removeProfile = useProviderStore((s) => s.remove);

	const encrypted = useSecretsStore((s) => s.encrypted);
	const unlocked = useSecretsStore((s) => s.unlocked);

	const [reveal, setReveal] = useState<Record<string, boolean>>({});
	const [editing, setEditing] = useState<ProviderProfile | null>(null);
	const [creating, setCreating] = useState(false);

	const enabled = profiles.filter((p) => p.enabled);
	const activeProfile = profiles.find((p) => p.id === provider);

	// When encryption is on and unlocked, keys can be persisted (encrypted) to
	// the engine vault rather than kept only in session memory.
	const vaultActive = encrypted && unlocked;

	const saveToVault = async (providerId: string, key: string) => {
		try {
			await secretsApi.putKey(providerId, key);
			toast.success("Key saved to encrypted vault");
		} catch (e) {
			toast.error(e instanceof Error ? e.message : "Failed to save key");
		}
	};

	const handleDelete = async (p: ProviderProfile) => {
		if (!confirm(`Delete provider "${p.name}"? This cannot be undone.`)) return;
		try {
			await removeProfile(p.id);
			toast.success(`Removed ${p.name}`);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : "Failed to delete provider");
		}
	};

	return (
		<div className="space-y-6">
			{(creating || editing) && (
				<ProviderFormModal
					initial={editing}
					onClose={() => {
						setCreating(false);
						setEditing(null);
					}}
				/>
			)}

			<section>
				<h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
					Active provider
				</h3>
				{loading && profiles.length === 0 ? (
					<p className="text-xs text-text-muted">Loading providers…</p>
				) : (
					<div className="flex flex-wrap gap-2">
						{enabled.map((p) => (
							<button
								key={p.id}
								type="button"
								onClick={() => setProvider(p.id, p.models[0])}
								className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
									provider === p.id
										? "border-accent bg-accent/10 text-accent"
										: "border-border text-text-secondary hover:bg-surface-hover"
								}`}
							>
								{p.name}
							</button>
						))}
						{enabled.length === 0 && (
							<p className="text-xs text-text-muted">
								No enabled providers. Add one below.
							</p>
						)}
					</div>
				)}
				{provider && activeProfile && (
					<div className="mt-3">
						<label
							className="block text-xs text-text-muted"
							htmlFor="model-select"
						>
							Model
						</label>
						<select
							id="model-select"
							value={model}
							onChange={(e) => setModel(e.target.value)}
							className="mt-1 w-full rounded-lg border border-border bg-surface-alt px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
						>
							{activeProfile.models.map((m) => (
								<option key={m} value={m}>
									{m}
								</option>
							))}
						</select>
					</div>
				)}
			</section>

			<section>
				<div className="mb-2 flex items-center justify-between">
					<h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
						Manage providers
					</h3>
					<button
						type="button"
						onClick={() => setCreating(true)}
						className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-text-secondary hover:bg-surface-hover hover:text-text-primary"
					>
						<Plus className="h-3.5 w-3.5" />
						Add provider
					</button>
				</div>
				<div className="space-y-2">
					{profiles.map((p) => (
						<div
							key={p.id}
							className="flex items-center justify-between rounded-lg border border-border bg-surface-alt px-3 py-2"
						>
							<div className="min-w-0">
								<div className="flex items-center gap-2">
									<span className="text-sm text-text-primary">{p.name}</span>
									{p.builtin && (
										<span className="rounded bg-surface px-1.5 py-0.5 text-[10px] uppercase text-text-muted">
											builtin
										</span>
									)}
									{!p.enabled && (
										<span className="rounded bg-surface px-1.5 py-0.5 text-[10px] uppercase text-text-muted">
											disabled
										</span>
									)}
								</div>
								<p className="truncate text-xs text-text-muted">
									{p.protocol} · {p.models.length} model
									{p.models.length === 1 ? "" : "s"}
									{p.base_url ? ` · ${p.base_url}` : ""}
								</p>
							</div>
							<div className="flex shrink-0 gap-1">
								<button
									type="button"
									onClick={() => setEditing(p)}
									aria-label={`Edit ${p.name}`}
									className="rounded-lg border border-border px-2 py-1 text-text-muted hover:bg-surface-hover hover:text-text-primary"
								>
									<Pencil className="h-3.5 w-3.5" />
								</button>
								<button
									type="button"
									disabled={p.builtin}
									onClick={() => handleDelete(p)}
									aria-label={`Delete ${p.name}`}
									title={
										p.builtin ? "Builtin providers cannot be deleted" : "Delete"
									}
									className="rounded-lg border border-border px-2 py-1 text-text-muted hover:bg-danger-bg hover:text-danger disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-text-muted"
								>
									<Trash2 className="h-3.5 w-3.5" />
								</button>
							</div>
						</div>
					))}
				</div>
			</section>

			<section>
				<h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
					API keys
				</h3>
				{vaultActive ? (
					<p className="mb-3 flex items-start gap-1.5 text-xs text-text-muted">
						<Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
						Encryption is on. Use the save button to store a key in the
						encrypted vault — it persists across restarts and never leaves the
						local machine in plaintext.
					</p>
				) : (
					<p className="mb-3 text-xs text-text-muted">
						Stored in memory by default. Enable encryption in the Security tab
						to persist keys safely at rest.
					</p>
				)}
				<div className="space-y-3">
					{enabled.map((p) => {
						const value = apiKeys[p.id] ?? "";
						const isShown = reveal[p.id];
						return (
							<div key={p.id} className="space-y-1">
								<label
									htmlFor={`key-${p.id}`}
									className="text-xs font-medium text-text-secondary"
								>
									{p.name}
								</label>
								<div className="flex gap-2">
									<input
										id={`key-${p.id}`}
										type={isShown ? "text" : "password"}
										value={value}
										onChange={(e) => setApiKey(p.id, e.target.value)}
										placeholder={keyHintFor(p.protocol)}
										className="flex-1 rounded-lg border border-border bg-surface-alt px-3 py-2 font-mono text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50"
									/>
									<button
										type="button"
										onClick={() =>
											setReveal((s) => ({ ...s, [p.id]: !s[p.id] }))
										}
										className="rounded-lg border border-border px-2 text-text-muted hover:bg-surface-hover hover:text-text-primary"
										aria-label={isShown ? "Hide API key" : "Show API key"}
										title={isShown ? "Hide" : "Show"}
									>
										{isShown ? (
											<EyeOff className="h-3.5 w-3.5" />
										) : (
											<Eye className="h-3.5 w-3.5" />
										)}
									</button>
									{vaultActive && value && (
										<button
											type="button"
											onClick={() => saveToVault(p.id, value)}
											aria-label="Save API key to encrypted vault"
											className="rounded-lg border border-border px-2 text-text-muted hover:bg-success-bg hover:text-success"
											title="Save to encrypted vault"
										>
											<Save className="h-3.5 w-3.5" />
										</button>
									)}
									{value && (
										<button
											type="button"
											onClick={() => clearApiKey(p.id)}
											aria-label="Clear API key"
											className="rounded-lg border border-border px-2 text-text-muted hover:bg-danger-bg hover:text-danger"
											title="Clear"
										>
											<Trash2 className="h-3.5 w-3.5" />
										</button>
									)}
								</div>
							</div>
						);
					})}
				</div>
			</section>
		</div>
	);
}

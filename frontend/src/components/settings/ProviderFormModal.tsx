import { X } from "lucide-react";
import { useState } from "react";
import type {
	ProviderProfile,
	ProviderProtocol,
} from "../../services/providers";
import { useProviderStore } from "../../stores/providerStore";
import { toast } from "../../stores/toastStore";

interface Props {
	/** Profile being edited, or null when creating a new one. */
	initial: ProviderProfile | null;
	onClose: () => void;
}

const PROTOCOLS: { value: ProviderProtocol; label: string }[] = [
	{ value: "openai", label: "OpenAI-compatible" },
	{ value: "anthropic", label: "Anthropic" },
];

// Slugify a display name into a stable id (lowercase, dashes). Only used when
// creating; existing ids are immutable so chat history keeps resolving.
function slugify(name: string): string {
	return name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

export default function ProviderFormModal({ initial, onClose }: Props) {
	const isEdit = initial !== null;
	const profiles = useProviderStore((s) => s.profiles);
	const upsert = useProviderStore((s) => s.upsert);

	const [name, setName] = useState(initial?.name ?? "");
	const [protocol, setProtocol] = useState<ProviderProtocol>(
		initial?.protocol ?? "openai",
	);
	const [baseUrl, setBaseUrl] = useState(initial?.base_url ?? "");
	const [modelsText, setModelsText] = useState(
		(initial?.models ?? []).join("\n"),
	);
	const [enabled, setEnabled] = useState(initial?.enabled ?? true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleSubmit = async () => {
		const trimmedName = name.trim();
		const models = modelsText
			.split(/[\n,]/)
			.map((m) => m.trim())
			.filter(Boolean);

		// Mirror the gateway's validation client-side for instant feedback.
		if (!trimmedName) {
			setError("Name is required");
			return;
		}
		const id = isEdit ? initial.id : slugify(trimmedName);
		if (!id) {
			setError("Name must contain at least one letter or number");
			return;
		}
		if (!isEdit && profiles.some((p) => p.id === id)) {
			setError(`A provider with id "${id}" already exists`);
			return;
		}
		// OpenAI builtin is the only profile allowed an empty base URL.
		const allowEmptyBase = protocol === "openai" && (initial?.builtin ?? false);
		if (!baseUrl.trim() && !allowEmptyBase) {
			setError("Base URL is required");
			return;
		}
		if (models.length === 0) {
			setError("At least one model is required");
			return;
		}

		const profile: ProviderProfile = {
			id,
			name: trimmedName,
			protocol,
			base_url: baseUrl.trim(),
			models,
			enabled,
			builtin: initial?.builtin ?? false,
		};

		setSaving(true);
		setError(null);
		try {
			await upsert(profile);
			toast.success(isEdit ? `Updated ${trimmedName}` : `Added ${trimmedName}`);
			onClose();
		} catch (e) {
			setError(e instanceof Error ? e.message : "Failed to save provider");
			setSaving(false);
		}
	};

	return (
		<div
			className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
			onClick={onClose}
			onKeyDown={(e) => {
				if (e.key === "Escape") onClose();
			}}
			role="presentation"
		>
			<dialog
				open
				aria-modal="true"
				className="w-full max-w-md rounded-2xl border border-border bg-surface p-5 text-text-primary shadow-2xl"
				onClick={(e) => e.stopPropagation()}
				onKeyDown={(e) => e.stopPropagation()}
			>
				<div className="mb-4 flex items-center justify-between">
					<h3 className="text-sm font-semibold">
						{isEdit ? `Edit ${initial.name}` : "Add provider"}
					</h3>
					<button
						type="button"
						onClick={onClose}
						aria-label="Close"
						className="rounded-lg p-1 text-text-muted hover:bg-surface-hover hover:text-text-primary"
					>
						<X className="h-4 w-4" />
					</button>
				</div>

				<div className="space-y-3">
					<div>
						<label
							htmlFor="prov-name"
							className="text-xs font-medium text-text-secondary"
						>
							Name
						</label>
						<input
							id="prov-name"
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="My Provider"
							className="mt-1 w-full rounded-lg border border-border bg-surface-alt px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
						/>
						{!isEdit && name.trim() && (
							<p className="mt-1 text-[11px] text-text-muted">
								id: {slugify(name) || "—"}
							</p>
						)}
					</div>

					<div>
						<label
							htmlFor="prov-protocol"
							className="text-xs font-medium text-text-secondary"
						>
							Protocol
						</label>
						<select
							id="prov-protocol"
							value={protocol}
							onChange={(e) => setProtocol(e.target.value as ProviderProtocol)}
							disabled={initial?.builtin}
							className="mt-1 w-full rounded-lg border border-border bg-surface-alt px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 disabled:opacity-60"
						>
							{PROTOCOLS.map((p) => (
								<option key={p.value} value={p.value}>
									{p.label}
								</option>
							))}
						</select>
					</div>

					<div>
						<label
							htmlFor="prov-baseurl"
							className="text-xs font-medium text-text-secondary"
						>
							Base URL
						</label>
						<input
							id="prov-baseurl"
							value={baseUrl}
							onChange={(e) => setBaseUrl(e.target.value)}
							placeholder={
								protocol === "anthropic"
									? "https://api.anthropic.com/v1"
									: "https://api.openai.com/v1"
							}
							className="mt-1 w-full rounded-lg border border-border bg-surface-alt px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-accent/50"
						/>
						<p className="mt-1 text-[11px] text-text-muted">
							Leave blank only for the builtin OpenAI endpoint.
						</p>
					</div>

					<div>
						<label
							htmlFor="prov-models"
							className="text-xs font-medium text-text-secondary"
						>
							Models
						</label>
						<textarea
							id="prov-models"
							value={modelsText}
							onChange={(e) => setModelsText(e.target.value)}
							rows={4}
							placeholder={"gpt-4o\ngpt-4o-mini"}
							className="mt-1 w-full rounded-lg border border-border bg-surface-alt px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-accent/50"
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

				<div className="mt-5 flex justify-end gap-2">
					<button
						type="button"
						onClick={onClose}
						className="rounded-lg border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-hover"
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={handleSubmit}
						disabled={saving}
						className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-60"
					>
						{saving ? "Saving…" : isEdit ? "Save changes" : "Add provider"}
					</button>
				</div>
			</dialog>
		</div>
	);
}

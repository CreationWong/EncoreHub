import { X } from "lucide-react";
import { useState } from "react";
import type {
	ProviderProfile,
	ProviderProtocol,
} from "../../services/providers";
import { useProviderStore } from "../../stores/providerStore";

interface Props {
	/** Called with the freshly-created draft profile (not yet persisted). */
	onCreated: (draft: ProviderProfile) => void;
	onClose: () => void;
}

const PROTOCOLS: { value: ProviderProtocol; label: string }[] = [
	{ value: "openai", label: "OpenAI-compatible" },
	{ value: "anthropic", label: "Anthropic" },
];

// Slugify a display name into a stable id (lowercase, dashes). ids are immutable
// once created so chat history keeps resolving.
function slugify(name: string): string {
	return name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

/**
 * Minimal "Add provider" dialog: only the display name and the API format
 * (protocol). Endpoint, key, and models are configured afterwards in the
 * detail panel, so this stays focused on the one irreversible choice (id +
 * protocol).
 */
export default function ProviderFormModal({ onCreated, onClose }: Props) {
	const profiles = useProviderStore((s) => s.profiles);

	const [name, setName] = useState("");
	const [protocol, setProtocol] = useState<ProviderProtocol>("openai");
	const [error, setError] = useState<string | null>(null);

	const handleSubmit = () => {
		const trimmedName = name.trim();
		if (!trimmedName) {
			setError("Name is required");
			return;
		}
		const id = slugify(trimmedName);
		if (!id) {
			setError("Name must contain at least one letter or number");
			return;
		}
		if (profiles.some((p) => p.id === id)) {
			setError(`A provider with id "${id}" already exists`);
			return;
		}

		// A draft with empty base_url/models — the detail panel fills those in
		// before the first save. enabled defaults off until it's configured.
		onCreated({
			id,
			name: trimmedName,
			protocol,
			base_url: "",
			models: [],
			enabled: false,
			builtin: false,
		});
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
					<h3 className="text-sm font-semibold">Add provider</h3>
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
							onKeyDown={(e) => {
								if (e.key === "Enter") handleSubmit();
							}}
							placeholder="My Provider"
							// biome-ignore lint/a11y/noAutofocus: single-field dialog, keyboard-first
							autoFocus
							className="mt-1 w-full rounded-lg border border-border bg-surface-alt px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
						/>
						{name.trim() && (
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
							API format
						</label>
						<select
							id="prov-protocol"
							value={protocol}
							onChange={(e) => setProtocol(e.target.value as ProviderProtocol)}
							className="mt-1 w-full rounded-lg border border-border bg-surface-alt px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
						>
							{PROTOCOLS.map((p) => (
								<option key={p.value} value={p.value}>
									{p.label}
								</option>
							))}
						</select>
						<p className="mt-1 text-[11px] text-text-muted">
							The wire protocol used to talk to this provider. Most custom
							endpoints are OpenAI-compatible.
						</p>
					</div>

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
						className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90"
					>
						Create
					</button>
				</div>
			</dialog>
		</div>
	);
}

// Owns the first step of custom provider creation and its immutable identity.
import { Braces, MessageSquareText, Plus, X } from "lucide-react";
import { useState } from "react";
import { API_FORMATS } from "../../constants/providers";
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

/** Generate an opaque UUID v4 so display names retain their full Unicode text. */
function createProviderId(): string {
	if (typeof crypto.randomUUID === "function") return crypto.randomUUID();

	const bytes = crypto.getRandomValues(new Uint8Array(16));
	bytes[6] = (bytes[6] & 0x0f) | 0x40;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;
	const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
	return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

/**
 * Minimal "Add provider" dialog: only the display name and the API format
 * (protocol). Endpoint, key, and models are configured afterwards in the
 * detail panel, so this stays focused on the display name and protocol. The
 * immutable provider id is an opaque UUID generated at creation time.
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
		let id = createProviderId();
		while (profiles.some((profile) => profile.id === id)) {
			id = createProviderId();
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
			routing_strategy: "failover",
			key_routing_strategy: "failover",
			model_configs: [],
		});
	};

	return (
		<div
			className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
			onKeyDown={(e) => {
				if (e.key === "Escape") onClose();
			}}
			role="presentation"
		>
			<dialog
				open
				aria-modal="true"
				aria-labelledby="add-provider-title"
				className="w-full max-w-xl rounded-lg border border-border bg-surface p-0 text-text-primary shadow-2xl"
				onKeyDown={(e) => e.stopPropagation()}
			>
				<header className="flex items-center justify-between border-b border-border px-5 py-4">
					<h3 id="add-provider-title" className="text-base font-semibold">
						Add provider
					</h3>
					<button
						type="button"
						onClick={onClose}
						aria-label="Close"
						className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text-primary"
					>
						<X className="h-4 w-4" />
					</button>
				</header>

				<div className="space-y-5 px-5 py-5">
					<div>
						<label
							htmlFor="prov-name"
							className="text-xs font-medium text-text-secondary"
						>
							Name
						</label>
						<input
							id="prov-name"
							autoComplete="off"
							value={name}
							onChange={(e) => setName(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter" && !e.nativeEvent.isComposing) {
									handleSubmit();
								}
							}}
							placeholder="My Provider"
							// biome-ignore lint/a11y/noAutofocus: single-field dialog, keyboard-first
							autoFocus
							className="mt-1.5 w-full rounded-md border border-border bg-surface-alt px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
						/>
					</div>

					<fieldset className="m-0 border-0 p-0">
						<legend className="text-xs font-medium text-text-secondary">
							API format
						</legend>
						<div className="mt-1.5 grid gap-2 sm:grid-cols-2">
							{API_FORMATS.map((format) => {
								const selected = protocol === format.value;
								const Icon =
									format.value === "anthropic" ? MessageSquareText : Braces;
								return (
									<button
										key={format.value}
										type="button"
										aria-pressed={selected}
										onClick={() =>
											setProtocol(format.value as ProviderProtocol)
										}
										className={`flex min-h-24 items-start gap-3 rounded-md border p-3 text-left transition-colors ${
											selected
												? "border-accent bg-surface-hover"
												: "border-border hover:bg-surface-hover"
										}`}
									>
										<Icon
											className={`mt-0.5 h-4 w-4 shrink-0 ${selected ? "text-accent" : "text-text-muted"}`}
										/>
										<span className="min-w-0">
											<span className="block text-sm font-medium text-text-primary">
												{format.label}
											</span>
											<span className="mt-1 block text-xs leading-4 text-text-muted">
												{format.description}
											</span>
										</span>
									</button>
								);
							})}
						</div>
						<p className="mt-2 text-xs text-text-muted">
							All endpoints added later must belong to this provider and use
							this API format.
						</p>
					</fieldset>

					{error && (
						<p className="rounded-md bg-danger-bg px-3 py-2 text-xs text-danger">
							{error}
						</p>
					)}
				</div>

				<footer className="flex justify-end gap-2 border-t border-border px-5 py-4">
					<button
						type="button"
						onClick={onClose}
						className="rounded-md border border-border px-4 py-2 text-sm text-text-secondary hover:bg-surface-hover"
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={handleSubmit}
						className="flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
					>
						<Plus className="h-4 w-4" />
						Create
					</button>
				</footer>
			</dialog>
		</div>
	);
}

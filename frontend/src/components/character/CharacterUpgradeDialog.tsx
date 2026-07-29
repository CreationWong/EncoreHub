import { AlertTriangle, ArrowRight, Loader2, RefreshCw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
	type CharacterSnapshot,
	type CharacterUpgradePreview,
	previewCharacterUpgrade,
} from "../../services/characters";
import type { Conversation } from "../../services/conversation";
import { useConversationStore } from "../../stores/conversationStore";
import { toast } from "../../stores/toastStore";

const FIELD_LABELS: Record<string, string> = {
	name: "Name",
	avatar: "Avatar",
	description: "Description",
	system_prompt: "Global prompt",
	opening_message: "Opening message",
	tags: "Tags",
	provider: "Provider",
	model: "Model",
};

function fieldValue(
	preview: CharacterUpgradePreview,
	field: CharacterUpgradePreview["changed_fields"][number],
	side: "current" | "proposed",
): string {
	if (field === "provider") {
		return side === "current"
			? preview.current_provider
			: preview.proposed_provider;
	}
	if (field === "model") {
		return side === "current" ? preview.current_model : preview.proposed_model;
	}
	const snapshot: CharacterSnapshot =
		side === "current" ? preview.current_snapshot : preview.proposed_snapshot;
	const value = snapshot[field];
	return Array.isArray(value) ? value.join(", ") : value || "Empty";
}

export default function CharacterUpgradeDialog({
	conversation,
	latestVersion,
}: {
	conversation: Conversation;
	latestVersion: number;
}) {
	const upgrade = useConversationStore(
		(state) => state.upgradeConversationCharacter,
	);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const closeRef = useRef<HTMLButtonElement>(null);
	const dialogRef = useRef<HTMLDialogElement>(null);
	const [open, setOpen] = useState(false);
	const [preview, setPreview] = useState<CharacterUpgradePreview | null>(null);
	const [loading, setLoading] = useState(false);
	const [applying, setApplying] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const loadPreview = async () => {
		setLoading(true);
		setError(null);
		try {
			setPreview(await previewCharacterUpgrade(conversation.id));
		} catch (loadError) {
			setError(
				loadError instanceof Error
					? loadError.message
					: "Unable to preview this update.",
			);
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		if (!open) return;
		const frame = requestAnimationFrame(() => closeRef.current?.focus());
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				setOpen(false);
				requestAnimationFrame(() => triggerRef.current?.focus());
				return;
			}
			if (event.key !== "Tab") return;
			const focusable = Array.from(
				dialogRef.current?.querySelectorAll<HTMLElement>(
					'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
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
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => {
			cancelAnimationFrame(frame);
			window.removeEventListener("keydown", handleKeyDown);
		};
	}, [open]);

	if ((conversation.character_version ?? 1) >= latestVersion) return null;

	const close = () => {
		setOpen(false);
		requestAnimationFrame(() => triggerRef.current?.focus());
	};

	const apply = async () => {
		if (!preview?.changed || applying) return;
		setApplying(true);
		setError(null);
		try {
			await upgrade(conversation.id, preview.from_version);
			toast.success(
				`Conversation upgraded to character version ${preview.to_version}`,
			);
			close();
		} catch (applyError) {
			setError(
				applyError instanceof Error
					? applyError.message
					: "Unable to apply this update.",
			);
		} finally {
			setApplying(false);
		}
	};

	return (
		<>
			<button
				ref={triggerRef}
				type="button"
				onClick={() => {
					setOpen(true);
					setPreview(null);
					void loadPreview();
				}}
				aria-label="Review character update"
				title={`Character version ${latestVersion} is available`}
				className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-warning-border bg-warning-bg px-2 text-[11px] font-medium text-warning hover:bg-control max-[899px]:w-8 max-[899px]:justify-center max-[899px]:px-0"
			>
				<RefreshCw className="h-3.5 w-3.5" />
				<span className="max-[899px]:hidden">Update available</span>
			</button>

			{open && (
				<div className="fixed inset-0 z-50 flex items-center justify-center p-4">
					<button
						type="button"
						tabIndex={-1}
						onClick={close}
						aria-label="Dismiss character update preview"
						className="absolute inset-0 bg-black/45"
					/>
					<dialog
						ref={dialogRef}
						open
						aria-labelledby="character-upgrade-title"
						className="relative z-10 flex max-h-[calc(100vh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-border bg-workspace text-text-primary shadow-2xl"
					>
						<header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
							<div className="min-w-0 flex-1">
								<h2
									id="character-upgrade-title"
									className="truncate text-sm font-semibold"
								>
									Review character update
								</h2>
								<p className="text-[11px] text-text-muted">
									Conversation snapshot remains unchanged until you apply this
									update.
								</p>
							</div>
							<button
								ref={closeRef}
								type="button"
								onClick={close}
								aria-label="Close character update preview"
								className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-control hover:text-text-primary"
							>
								<X className="h-4 w-4" />
							</button>
						</header>

						<div className="min-h-0 flex-1 overflow-y-auto p-4">
							{loading && (
								<output
									aria-label="Loading character update preview"
									className="flex h-40 items-center justify-center"
								>
									<Loader2 className="h-5 w-5 animate-spin text-text-muted" />
								</output>
							)}

							{error && (
								<div className="flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-3 py-3 text-sm text-danger">
									<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
									<p className="min-w-0 flex-1 break-words">{error}</p>
									<button
										type="button"
										onClick={() => void loadPreview()}
										className="shrink-0 rounded-md border border-danger-border px-2 py-1 text-xs font-medium"
									>
										Retry
									</button>
								</div>
							)}

							{preview && (
								<>
									<div className="flex items-center gap-3 border-b border-border pb-4 text-sm">
										<span className="rounded-md bg-control px-2 py-1 font-medium tabular-nums">
											Version {preview.from_version}
										</span>
										<ArrowRight className="h-4 w-4 text-text-muted" />
										<span className="rounded-md bg-success-bg px-2 py-1 font-medium text-success tabular-nums">
											Version {preview.to_version}
										</span>
									</div>

									{preview.changed_fields.length === 0 ? (
										<p className="py-8 text-center text-sm text-text-muted">
											No content fields changed.
										</p>
									) : (
										<div className="divide-y divide-border">
											{preview.changed_fields.map((field) => (
												<section key={field} className="py-4">
													<h3 className="mb-2 text-xs font-semibold text-text-secondary">
														{FIELD_LABELS[field] ?? field}
													</h3>
													<div className="grid grid-cols-2 gap-3 max-[680px]:grid-cols-1">
														<div className="min-w-0">
															<p className="mb-1 text-[10px] font-medium text-text-muted">
																Current snapshot
															</p>
															<pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words rounded-md bg-control p-2 font-sans text-xs leading-5 text-text-secondary">
																{fieldValue(preview, field, "current")}
															</pre>
														</div>
														<div className="min-w-0">
															<p className="mb-1 text-[10px] font-medium text-text-muted">
																Latest profile
															</p>
															<pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words rounded-md bg-control p-2 font-sans text-xs leading-5 text-text-primary">
																{fieldValue(preview, field, "proposed")}
															</pre>
														</div>
													</div>
												</section>
											))}
										</div>
									)}
								</>
							)}
						</div>

						<footer className="flex min-h-16 shrink-0 items-center justify-end gap-2 border-t border-border px-4 py-3">
							<button
								type="button"
								onClick={close}
								className="h-9 rounded-md border border-border px-3 text-sm text-text-secondary hover:bg-control hover:text-text-primary"
							>
								Keep current snapshot
							</button>
							<button
								type="button"
								onClick={() => void apply()}
								disabled={!preview?.changed || loading || applying}
								className="flex h-9 items-center gap-2 rounded-md bg-accent px-3 text-sm font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
							>
								{applying && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
								Apply update
							</button>
						</footer>
					</dialog>
				</div>
			)}
		</>
	);
}

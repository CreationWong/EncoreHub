import {
	AlertTriangle,
	BrainCircuit,
	ChevronDown,
	ChevronUp,
	CircleHelp,
	Copy,
	Eye,
	Globe2,
	Layers3,
	ListRestart,
	MessageSquare,
	RotateCcw,
	Save,
	Sparkles,
	Wrench,
	X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { MODEL_CAPABILITIES } from "../../constants/providers";
import { applyMetadataToModelConfig } from "../../services/modelMetadata";
import type {
	ProviderModelCapability,
	ProviderModelConfig,
	ProviderModelType,
	ProviderProtocol,
} from "../../services/providers";
import {
	modelMetadataForId,
	useModelMetadataStore,
} from "../../stores/modelMetadataStore";
import { defaultModelConfig } from "./providerConfig";

interface Props {
	model: ProviderModelConfig | null;
	existingIds: string[];
	protocol: ProviderProtocol;
	onSave: (model: ProviderModelConfig) => void;
	onClose: () => void;
}

const CAPABILITY_ICONS: Record<ProviderModelCapability, typeof Eye> = {
	vision: Eye,
	web: Globe2,
	reasoning: BrainCircuit,
	tools: Wrench,
	rerank: ListRestart,
	embedding: Layers3,
};

const CAPABILITY_STYLES: Record<ProviderModelCapability, string> = {
	vision: "border-success-border bg-success-bg text-success",
	web: "border-accent/30 bg-accent/10 text-accent",
	reasoning:
		"border-indigo-400/30 bg-indigo-500/10 text-indigo-500 dark:text-indigo-300",
	tools: "border-warning-border bg-warning-bg text-warning",
	rerank: "border-cyan-400/30 bg-cyan-500/10 text-cyan-600 dark:text-cyan-300",
	embedding:
		"border-fuchsia-400/30 bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-300",
};

const CURRENCY_SYMBOLS: Record<string, string> = {
	USD: "$",
	CNY: "¥",
	EUR: "€",
};

function FieldLabel({
	children,
	hint,
	required = false,
}: {
	children: string;
	hint: string;
	required?: boolean;
}) {
	return (
		<span className="flex items-center gap-1.5 text-sm font-medium text-text-secondary">
			{required && <span className="text-danger">*</span>}
			{children}
			<CircleHelp aria-label={hint} className="h-3.5 w-3.5 text-text-muted" />
		</span>
	);
}

export default function ProviderModelModal({
	model,
	existingIds,
	protocol,
	onSave,
	onClose,
}: Props) {
	const editing = model !== null;
	const [draft, setDraft] = useState<ProviderModelConfig>(() =>
		model ? { ...model } : defaultModelConfig("", "", "Models"),
	);
	const [advanced, setAdvanced] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const metadataProviders = useModelMetadataStore((state) => state.providers);
	const recordsByProvider = useModelMetadataStore(
		(state) => state.recordsByProvider,
	);
	const refreshMetadata = useModelMetadataStore(
		(state) => state.refreshEnabled,
	);
	const appliedMetadataRef = useRef<string | null>(null);

	const capabilities = useMemo(
		() => new Set(draft.capabilities ?? []),
		[draft.capabilities],
	);
	// Legacy profiles used the embedding capability before model purpose existed.
	const embeddingsSupported = protocol === "openai";
	const modelType: ProviderModelType =
		embeddingsSupported &&
		(draft.type === "embedding" || capabilities.has("embedding"))
			? "embedding"
			: "chat";
	const currencySymbol = CURRENCY_SYMBOLS[draft.currency ?? "USD"] ?? "$";
	const metadata = useMemo(
		() =>
			modelMetadataForId(
				{ providers: metadataProviders, recordsByProvider },
				draft.id.trim(),
			),
		[metadataProviders, recordsByProvider, draft.id],
	);

	useEffect(() => {
		void refreshMetadata();
	}, [refreshMetadata]);

	useEffect(() => {
		if (!metadata) {
			appliedMetadataRef.current = null;
			return;
		}
		const requestedModelId = draft.id.trim();
		const signature = JSON.stringify(metadata);
		if (appliedMetadataRef.current === signature) return;
		appliedMetadataRef.current = signature;
		setDraft((current) =>
			current.id.trim() === requestedModelId
				? applyMetadataToModelConfig(current, metadata)
				: current,
		);
	}, [metadata, draft.id]);

	const update = <K extends keyof ProviderModelConfig>(
		key: K,
		value: ProviderModelConfig[K],
	) => setDraft((current) => ({ ...current, [key]: value }));

	const toggleCapability = (capability: ProviderModelCapability) => {
		const next = new Set(capabilities);
		if (next.has(capability)) next.delete(capability);
		else next.add(capability);
		update("capabilities", [...next]);
	};

	const setModelType = (type: ProviderModelType) => {
		setDraft((current) => ({
			...current,
			type,
			capabilities: (current.capabilities ?? []).filter(
				(capability) => capability !== "embedding",
			),
			streaming: type === "chat",
			output_price: type === "embedding" ? 0 : current.output_price,
		}));
	};

	const handleSave = () => {
		const id = draft.id.trim();
		if (!id) {
			setError("Model ID is required");
			return;
		}
		if (
			existingIds.some(
				(existingId) => existingId === id && existingId !== model?.id,
			)
		) {
			setError(`Model "${id}" already exists`);
			return;
		}
		if ((draft.input_price ?? 0) < 0 || (draft.output_price ?? 0) < 0) {
			setError("Prices cannot be negative");
			return;
		}
		if (
			draft.context_window !== undefined &&
			(!Number.isInteger(draft.context_window) || draft.context_window < 1)
		) {
			setError("Maximum context size must be a positive integer");
			return;
		}
		if (
			modelType === "embedding" &&
			draft.dimensions !== undefined &&
			(draft.dimensions < 1 || draft.dimensions > 3072)
		) {
			setError("Dimensions must be between 1 and 3072");
			return;
		}
		onSave({
			...draft,
			id,
			name: draft.name?.trim() || id,
			group: draft.group?.trim() || "Models",
			type: modelType,
			capabilities: [...capabilities].filter(
				(capability) => capability !== "embedding",
			),
			dimensions:
				modelType === "embedding" && Number(draft.dimensions) > 0
					? Number(draft.dimensions)
					: undefined,
			streaming: modelType === "chat" ? draft.streaming : false,
			currency: draft.currency || "USD",
			input_price: Number(draft.input_price) || 0,
			output_price: modelType === "chat" ? Number(draft.output_price) || 0 : 0,
			context_window:
				Number(draft.context_window) > 0
					? Number(draft.context_window)
					: undefined,
		});
	};

	return (
		<div
			className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4"
			onClick={onClose}
			onKeyDown={(event) => {
				if (event.key === "Escape") onClose();
			}}
			role="presentation"
		>
			<dialog
				open
				aria-modal="true"
				aria-labelledby="provider-model-dialog-title"
				className="max-h-[calc(100vh-2rem)] w-full max-w-3xl overflow-y-auto rounded-lg border border-border bg-surface p-0 text-text-primary shadow-2xl"
				onClick={(event) => event.stopPropagation()}
				onKeyDown={(event) => event.stopPropagation()}
			>
				<header className="flex items-center justify-between px-6 pb-3 pt-5">
					<h3
						id="provider-model-dialog-title"
						className="text-base font-semibold"
					>
						{editing ? "Edit model" : "Add model"}
					</h3>
					<button
						type="button"
						onClick={onClose}
						aria-label="Close model editor"
						title="Close"
						className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text-primary"
					>
						<X className="h-4 w-4" />
					</button>
				</header>

				<div className="px-6 pb-6">
					<div className="space-y-4 py-3">
						<label className="grid gap-1.5 sm:grid-cols-[9rem_1fr] sm:items-center">
							<FieldLabel
								required
								hint="The model identifier sent to the provider API"
							>
								Model ID
							</FieldLabel>
							<span className="flex min-w-0">
								<input
									value={draft.id}
									onChange={(event) => update("id", event.target.value)}
									placeholder="gpt-4.1-mini"
									// biome-ignore lint/a11y/noAutofocus: primary field in a focused creation dialog
									autoFocus={!editing}
									className={`min-w-0 flex-1 border border-border bg-surface-alt px-3 py-2 font-mono text-sm text-text-primary placeholder:text-text-muted ${
										editing ? "rounded-l-md" : "rounded-md"
									}`}
								/>
								{editing && (
									<button
										type="button"
										onClick={() => navigator.clipboard?.writeText(draft.id)}
										aria-label="Copy model ID"
										title="Copy model ID"
										className="flex w-10 items-center justify-center rounded-r-md border border-l-0 border-border bg-surface-alt text-text-muted hover:bg-surface-hover hover:text-text-primary"
									>
										<Copy className="h-4 w-4" />
									</button>
								)}
							</span>
						</label>

						<label className="grid gap-1.5 sm:grid-cols-[9rem_1fr] sm:items-center">
							<FieldLabel hint="An optional local note or alias; it is never sent to the provider API">
								Model name
							</FieldLabel>
							<input
								value={draft.name ?? ""}
								onChange={(event) => update("name", event.target.value)}
								placeholder="GPT-4.1 Mini"
								className="rounded-md border border-border bg-surface-alt px-3 py-2 text-sm text-text-primary placeholder:text-text-muted"
							/>
						</label>

						<label className="grid gap-1.5 sm:grid-cols-[9rem_1fr] sm:items-center">
							<FieldLabel hint="Models with the same group are displayed together">
								Group
							</FieldLabel>
							<input
								value={draft.group ?? ""}
								onChange={(event) => update("group", event.target.value)}
								placeholder="General"
								className="rounded-md border border-border bg-surface-alt px-3 py-2 text-sm text-text-primary placeholder:text-text-muted"
							/>
						</label>

						{embeddingsSupported && (
							<div className="grid gap-1.5 sm:grid-cols-[9rem_1fr] sm:items-center">
								<FieldLabel hint="Chat models generate replies; embedding models only convert text into vectors">
									Model function
								</FieldLabel>
								<fieldset
									aria-label="Model function"
									className="m-0 grid grid-cols-2 rounded-md border border-border bg-surface-alt p-1"
								>
									<button
										type="button"
										aria-pressed={modelType === "chat"}
										onClick={() => setModelType("chat")}
										className={`flex h-8 items-center justify-center gap-2 rounded text-sm ${modelType === "chat" ? "bg-surface text-text-primary shadow-sm" : "text-text-muted hover:text-text-primary"}`}
									>
										<MessageSquare className="h-3.5 w-3.5" />
										Chat
									</button>
									<button
										type="button"
										aria-pressed={modelType === "embedding"}
										onClick={() => setModelType("embedding")}
										className={`flex h-8 items-center justify-center gap-2 rounded text-sm ${modelType === "embedding" ? "bg-surface text-text-primary shadow-sm" : "text-text-muted hover:text-text-primary"}`}
									>
										<Layers3 className="h-3.5 w-3.5" />
										Embedding
									</button>
								</fieldset>
							</div>
						)}

						<div className="flex items-center justify-between gap-3 pt-1">
							<button
								type="button"
								onClick={() => setAdvanced((value) => !value)}
								aria-expanded={advanced}
								className="flex items-center gap-2 rounded-md bg-surface-alt px-3 py-2 text-sm text-text-secondary hover:bg-surface-hover hover:text-text-primary"
							>
								More settings
								{advanced ? (
									<ChevronUp className="h-4 w-4" />
								) : (
									<ChevronDown className="h-4 w-4" />
								)}
							</button>
							<button
								type="button"
								onClick={handleSave}
								className="flex h-10 items-center gap-2 rounded-md bg-accent px-4 text-sm font-medium text-white hover:bg-accent-hover"
							>
								<Save className="h-4 w-4" />
								{editing ? "Save" : "Add model"}
							</button>
						</div>
					</div>

					{advanced && (
						<div className="space-y-0 border-t border-border">
							{modelType === "chat" && (
								<fieldset className="m-0 border-0 p-0">
									<legend className="sr-only">Model capabilities</legend>
									<div className="flex items-center justify-between gap-3 py-4">
										<span className="flex items-center gap-1.5 text-sm font-medium text-text-secondary">
											Model capabilities
											{metadata ? (
												<span
													aria-label="Configured from model metadata"
													title="Configured from model metadata"
													className="text-accent"
												>
													<Sparkles
														aria-hidden="true"
														className="h-3.5 w-3.5"
													/>
												</span>
											) : (
												<AlertTriangle className="h-3.5 w-3.5 text-warning" />
											)}
										</span>
										<button
											type="button"
											onClick={() => {
												setDraft((current) =>
													metadata
														? applyMetadataToModelConfig(current, metadata)
														: {
																...current,
																capabilities: model?.capabilities ?? [],
															},
												);
											}}
											aria-label="Reset model capabilities"
											title="Reset model capabilities"
											className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text-primary"
										>
											<RotateCcw className="h-4 w-4" />
										</button>
									</div>
									<div className="flex flex-wrap gap-2 pb-4">
										{MODEL_CAPABILITIES.filter(
											(capability) => capability.value !== "embedding",
										).map((capability) => {
											const Icon = CAPABILITY_ICONS[capability.value];
											const selected = capabilities.has(capability.value);
											return (
												<button
													key={capability.value}
													type="button"
													aria-pressed={selected}
													onClick={() => toggleCapability(capability.value)}
													className={`flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors ${
														selected
															? CAPABILITY_STYLES[capability.value]
															: "border-border text-text-muted hover:bg-surface-hover hover:text-text-primary"
													}`}
												>
													<Icon className="h-3.5 w-3.5" />
													{capability.label}
												</button>
											);
										})}
									</div>
								</fieldset>
							)}

							{modelType === "chat" && (
								<label className="flex min-h-16 items-center justify-between border-t border-border py-3 text-sm text-text-secondary">
									<span className="flex items-center gap-1.5">
										Supports streaming output
										<CircleHelp
											aria-label="Whether this model can return incremental output"
											className="h-3.5 w-3.5 text-text-muted"
										/>
									</span>
									<span className="relative inline-flex h-6 w-11 shrink-0 items-center">
										<input
											type="checkbox"
											role="switch"
											aria-checked={draft.streaming}
											checked={draft.streaming}
											onChange={(event) =>
												update("streaming", event.target.checked)
											}
											className="peer sr-only"
										/>
										<span className="absolute inset-0 rounded-full bg-border transition-colors peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-surface" />
										<span className="pointer-events-none absolute left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-5" />
									</span>
								</label>
							)}

							<div className="grid gap-3 border-t border-border py-4 sm:grid-cols-[9rem_1fr] sm:items-center">
								<label
									htmlFor="model-context-window"
									className="text-sm text-text-secondary"
								>
									Maximum context size
								</label>
								<div className="flex">
									<input
										id="model-context-window"
										type="number"
										min="1"
										step="1"
										value={draft.context_window ?? ""}
										onChange={(event) =>
											update(
												"context_window",
												event.target.value
													? Number(event.target.value)
													: undefined,
											)
										}
										placeholder="From metadata"
										className="min-w-0 flex-1 rounded-l-md border border-border bg-surface-alt px-3 py-2 text-sm"
									/>
									<span className="flex items-center rounded-r-md border border-l-0 border-border bg-surface-alt px-3 text-xs text-text-muted">
										tokens
									</span>
								</div>

								<label
									htmlFor="model-currency"
									className="text-sm text-text-secondary"
								>
									Currency
								</label>
								<select
									id="model-currency"
									value={draft.currency ?? "USD"}
									onChange={(event) => update("currency", event.target.value)}
									className="w-36 rounded-md border border-border bg-surface-alt px-3 py-2 text-sm"
								>
									<option value="USD">USD ($)</option>
									<option value="CNY">CNY (¥)</option>
									<option value="EUR">EUR (€)</option>
								</select>

								<label
									htmlFor="model-input-price"
									className="text-sm text-text-secondary"
								>
									Input price
								</label>
								<div className="flex">
									<input
										id="model-input-price"
										type="number"
										min="0"
										step="0.01"
										value={draft.input_price ?? 0}
										onChange={(event) =>
											update("input_price", Number(event.target.value))
										}
										className="min-w-0 flex-1 rounded-l-md border border-border bg-surface-alt px-3 py-2 text-sm"
									/>
									<span className="flex items-center rounded-r-md border border-l-0 border-border bg-surface-alt px-3 text-xs text-text-muted">
										{currencySymbol} / 1M tokens
									</span>
								</div>

								{modelType === "embedding" && (
									<>
										<label
											htmlFor="model-dimensions"
											className="text-sm text-text-secondary"
										>
											Default dimensions
										</label>
										<input
											id="model-dimensions"
											type="number"
											min="1"
											max="3072"
											value={draft.dimensions ?? ""}
											onChange={(event) =>
												update(
													"dimensions",
													event.target.value
														? Number(event.target.value)
														: undefined,
												)
											}
											placeholder="Provider default"
											className="rounded-md border border-border bg-surface-alt px-3 py-2 text-sm"
										/>
									</>
								)}

								{modelType === "chat" && (
									<>
										<label
											htmlFor="model-output-price"
											className="text-sm text-text-secondary"
										>
											Output price
										</label>
										<div className="flex">
											<input
												id="model-output-price"
												type="number"
												min="0"
												step="0.01"
												value={draft.output_price ?? 0}
												onChange={(event) =>
													update("output_price", Number(event.target.value))
												}
												className="min-w-0 flex-1 rounded-l-md border border-border bg-surface-alt px-3 py-2 text-sm"
											/>
											<span className="flex items-center rounded-r-md border border-l-0 border-border bg-surface-alt px-3 text-xs text-text-muted">
												{currencySymbol} / 1M tokens
											</span>
										</div>
									</>
								)}
							</div>
						</div>
					)}

					{error && (
						<p className="mt-4 rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">
							{error}
						</p>
					)}
				</div>
			</dialog>
		</div>
	);
}

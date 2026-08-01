import {
	AlertCircle,
	Check,
	Database,
	Plus,
	RefreshCw,
	Save,
	Search,
	Settings2,
	Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
	MODEL_METADATA_FIELDS,
	MODEL_METADATA_FIELD_LABELS,
	MODEL_METADATA_PRESETS,
	type ModelMetadataFetchResult,
	type ModelMetadataField,
	type ModelMetadataPreset,
	type ModelMetadataProvider,
	applyModelMetadataPreset,
	fetchModelMetadata,
	inferMetadataMapping,
} from "../../services/modelMetadata";
import { useModelMetadataStore } from "../../stores/modelMetadataStore";
import { toast } from "../../stores/toastStore";
import ModelMetadataTable from "./ModelMetadataTable";

const LAST_PROVIDER_KEY = "encorehub-model-metadata-provider";

function cloneProvider(provider: ModelMetadataProvider): ModelMetadataProvider {
	return { ...provider, mapping: { ...provider.mapping } };
}

function loadSelectedId(): string | null {
	try {
		return localStorage.getItem(LAST_PROVIDER_KEY);
	} catch {
		return null;
	}
}

function rememberSelectedId(id: string | null) {
	try {
		if (id) localStorage.setItem(LAST_PROVIDER_KEY, id);
		else localStorage.removeItem(LAST_PROVIDER_KEY);
	} catch {
		/* Selection preference is optional. */
	}
}

function providerInitial(name: string): string {
	return name.trim().charAt(0).toUpperCase() || "M";
}

function newProvider(): ModelMetadataProvider {
	return {
		id: `metadata-${Date.now()}`,
		name: "New metadata provider",
		url: "https://example.com/models.json",
		enabled: true,
		format: "array",
		dataPath: "",
		preset: "custom",
		mapping: { id: "id", name: "name" },
	};
}

export default function ModelMetadataPanel() {
	const providers = useModelMetadataStore((state) => state.providers);
	const recordsByProvider = useModelMetadataStore(
		(state) => state.recordsByProvider,
	);
	const loadCatalog = useModelMetadataStore((state) => state.load);
	const catalogLoading = useModelMetadataStore((state) => state.loading);
	const upsert = useModelMetadataStore((state) => state.upsert);
	const remove = useModelMetadataStore((state) => state.remove);
	const setRecords = useModelMetadataStore((state) => state.setRecords);
	const [selectedId, setSelectedId] = useState<string | null>(loadSelectedId);
	const [query, setQuery] = useState("");
	const [view, setView] = useState<"setup" | "data">("setup");
	const [draft, setDraft] = useState<ModelMetadataProvider | null>(null);
	const [preview, setPreview] = useState<ModelMetadataFetchResult | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);

	useEffect(() => {
		void loadCatalog();
	}, [loadCatalog]);

	useEffect(() => {
		const selected =
			providers.find((provider) => provider.id === selectedId) ??
			providers[0] ??
			null;
		setSelectedId(selected?.id ?? null);
		setDraft(selected ? cloneProvider(selected) : null);
		setPreview(null);
		setError(null);
	}, [providers, selectedId]);

	const mappedFields = useMemo(
		() => MODEL_METADATA_FIELDS.filter((field) => draft?.mapping[field]),
		[draft?.mapping],
	);
	const filteredProviders = useMemo(() => {
		const normalized = query.trim().toLowerCase();
		if (!normalized) return providers;
		return providers.filter((provider) =>
			[provider.name, provider.id, provider.url].some((value) =>
				value.toLowerCase().includes(normalized),
			),
		);
	}, [providers, query]);
	const storedRecords = draft ? (recordsByProvider[draft.id] ?? []) : [];

	const selectProvider = (id: string) => {
		setSelectedId(id);
		rememberSelectedId(id);
		setView("setup");
	};

	const updateDraft = <K extends keyof ModelMetadataProvider>(
		key: K,
		value: ModelMetadataProvider[K],
	) => {
		setDraft((current) => (current ? { ...current, [key]: value } : current));
		setSaved(false);
	};

	const updateMapping = (field: ModelMetadataField, path: string) => {
		setDraft((current) =>
			current
				? { ...current, mapping: { ...current.mapping, [field]: path } }
				: current,
		);
		setSaved(false);
	};

	const handleLoad = async () => {
		if (!draft?.url.trim()) return;
		setLoading(true);
		setError(null);
		setSaved(false);
		try {
			const result = await fetchModelMetadata(draft);
			await setRecords(draft.id, result.records);
			setPreview(result);
			toast.success(`${result.count.toLocaleString()} metadata records stored`);
		} catch (reason) {
			const message =
				reason instanceof Error ? reason.message : "Metadata request failed";
			setError(message);
			toast.error(message);
		} finally {
			setLoading(false);
		}
	};

	const handleAutoMap = () => {
		if (!draft || !preview?.sample) return;
		setDraft({
			...draft,
			mapping: { ...draft.mapping, ...inferMetadataMapping(preview.sample) },
		});
		setSaved(false);
	};

	const handleSave = async () => {
		if (!draft) return;
		const normalized = {
			...draft,
			id: draft.id.trim(),
			name: draft.name.trim() || draft.id.trim(),
			url: draft.url.trim(),
			dataPath: draft.dataPath?.trim() ?? "",
		};
		if (!normalized.id || !normalized.url) {
			setError("Name, ID, and URL are required");
			toast.error("Name, ID, and URL are required");
			return;
		}
		try {
			await upsert(normalized, selectedId ?? undefined);
			setSelectedId(normalized.id);
			rememberSelectedId(normalized.id);
			setDraft(cloneProvider(normalized));
			setSaved(true);
			if (normalized.enabled) {
				setLoading(true);
				try {
					const result = await fetchModelMetadata(normalized);
					await setRecords(normalized.id, result.records);
					setPreview(result);
					toast.success(
						`Metadata provider saved; ${result.count.toLocaleString()} records refreshed`,
					);
				} catch (reason) {
					const message =
						reason instanceof Error
							? reason.message
							: "Metadata refresh failed";
					setError(message);
					toast.warning("Provider saved, but its metadata refresh failed");
				} finally {
					setLoading(false);
				}
			} else {
				toast.success("Metadata provider saved");
			}
		} catch {
			toast.error("Failed to save metadata provider");
		}
	};

	const handleAdd = async () => {
		const provider = newProvider();
		try {
			await upsert(provider);
			selectProvider(provider.id);
			setDraft(cloneProvider(provider));
			setPreview(null);
			setError(null);
		} catch {
			toast.error("Failed to add metadata provider");
		}
	};

	const handleRemove = async () => {
		if (!draft) return;
		const next = providers.find((provider) => provider.id !== draft.id) ?? null;
		try {
			await remove(draft.id);
			setSelectedId(next?.id ?? null);
			rememberSelectedId(next?.id ?? null);
			setDraft(next ? cloneProvider(next) : null);
			setPreview(null);
			toast.success("Metadata provider removed");
		} catch {
			toast.error("Failed to remove metadata provider");
		}
	};

	return (
		<div className="flex h-full min-h-0 bg-surface">
			<aside className="flex w-60 shrink-0 flex-col border-r border-border bg-surface-alt max-[700px]:hidden">
				<div className="border-b border-border p-3">
					<div className="relative">
						<Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
						<input
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder="Search providers"
							aria-label="Search metadata providers"
							className="w-full rounded-md border border-border bg-surface py-2 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted"
						/>
					</div>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto p-2">
					{catalogLoading && providers.length === 0 ? (
						<p className="px-2 py-4 text-xs text-text-muted">
							Loading catalog…
						</p>
					) : (
						filteredProviders.map((provider) => (
							<button
								key={provider.id}
								type="button"
								onClick={() => selectProvider(provider.id)}
								aria-current={provider.id === selectedId ? "page" : undefined}
								className={`mb-1 flex w-full items-center gap-2.5 rounded-md border px-2.5 py-2 text-left transition-colors ${
									provider.id === selectedId
										? "border-border bg-surface text-text-primary shadow-sm"
										: "border-transparent text-text-secondary hover:bg-surface-hover hover:text-text-primary"
								}`}
							>
								<span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-hover text-xs font-semibold text-text-secondary">
									{providerInitial(provider.name)}
								</span>
								<span className="min-w-0 flex-1">
									<span className="block truncate text-sm font-medium">
										{provider.name}
									</span>
									<span className="block truncate text-[11px] text-text-muted">
										{(
											recordsByProvider[provider.id] ?? []
										).length.toLocaleString()}{" "}
										records
									</span>
								</span>
								<span
									className={`h-2.5 w-2.5 shrink-0 rounded-full ${
										provider.enabled
											? "bg-success"
											: "bg-transparent ring-1 ring-border"
									}`}
									aria-label={`${provider.name} ${
										provider.enabled ? "enabled" : "disabled"
									}`}
								/>
							</button>
						))
					)}
				</div>
				<div className="border-t border-border p-2">
					<button
						type="button"
						onClick={() => void handleAdd()}
						className="flex h-9 w-full items-center justify-center gap-2 rounded-md border border-border bg-surface text-sm text-text-secondary hover:bg-surface-hover hover:text-text-primary"
					>
						<Plus className="h-4 w-4" /> Add metadata provider
					</button>
				</div>
			</aside>

			{draft ? (
				<main className="flex min-w-0 flex-1 flex-col">
					<header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
						<div className="min-w-0">
							<h3 className="truncate text-base font-semibold text-text-primary">
								{draft.name}
							</h3>
							<p className="text-xs text-text-muted">
								{storedRecords.length.toLocaleString()} records stored in the
								local database
							</p>
						</div>
						<div className="flex items-center gap-2">
							<div
								className="grid grid-cols-2 rounded-md border border-border bg-surface-alt p-0.5"
								aria-label="Metadata view"
							>
								<button
									type="button"
									onClick={() => setView("setup")}
									aria-pressed={view === "setup"}
									className={`flex h-8 items-center gap-1.5 rounded px-3 text-xs ${
										view === "setup"
											? "bg-surface text-text-primary shadow-sm"
											: "text-text-muted hover:text-text-primary"
									}`}
								>
									<Settings2 className="h-3.5 w-3.5" />
									Provider setup
								</button>
								<button
									type="button"
									onClick={() => setView("data")}
									aria-pressed={view === "data"}
									className={`flex h-8 items-center gap-1.5 rounded px-3 text-xs ${
										view === "data"
											? "bg-surface text-text-primary shadow-sm"
											: "text-text-muted hover:text-text-primary"
									}`}
								>
									<Database className="h-3.5 w-3.5" />
									Data
								</button>
							</div>
							<button
								type="button"
								onClick={() => void handleRemove()}
								aria-label="Remove metadata provider"
								title="Remove metadata provider"
								className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-danger-bg hover:text-danger"
							>
								<Trash2 className="h-4 w-4" />
							</button>
						</div>
					</header>

					{view === "data" ? (
						<ModelMetadataTable
							records={storedRecords}
							providerName={draft.name}
							onSave={(records) => setRecords(draft.id, records)}
						/>
					) : (
						<div className="min-h-0 flex-1 overflow-y-auto p-5">
							<div className="mx-auto max-w-4xl space-y-6">
								<section
									className="space-y-3"
									aria-labelledby="metadata-source-heading"
								>
									<h4
										id="metadata-source-heading"
										className="text-sm font-semibold text-text-primary"
									>
										Source
									</h4>
									<div className="grid gap-3 sm:grid-cols-2">
										<label className="block">
											<span className="mb-1.5 block text-xs font-medium text-text-secondary">
												Name
											</span>
											<input
												value={draft.name}
												onChange={(event) =>
													updateDraft("name", event.target.value)
												}
												className="w-full rounded-md border border-border bg-surface-alt px-3 py-2 text-sm text-text-primary"
											/>
										</label>
										<label className="block">
											<span className="mb-1.5 block text-xs font-medium text-text-secondary">
												Provider ID
											</span>
											<input
												value={draft.id}
												onChange={(event) =>
													updateDraft("id", event.target.value)
												}
												className="w-full rounded-md border border-border bg-surface-alt px-3 py-2 font-mono text-sm text-text-primary"
											/>
										</label>
									</div>
									<label className="block">
										<span className="mb-1.5 block text-xs font-medium text-text-secondary">
											Metadata URL
										</span>
										<input
											type="url"
											value={draft.url}
											onChange={(event) =>
												updateDraft("url", event.target.value)
											}
											className="w-full rounded-md border border-border bg-surface-alt px-3 py-2 font-mono text-sm text-text-primary"
										/>
									</label>
									<div className="grid gap-3 sm:grid-cols-2">
										<label className="block">
											<span className="mb-1.5 block text-xs font-medium text-text-secondary">
												Source preset
											</span>
											<select
												value={draft.preset ?? "custom"}
												onChange={(event) => {
													setDraft((current) =>
														current
															? applyModelMetadataPreset(
																	current,
																	event.target.value as ModelMetadataPreset,
																)
															: current,
													);
													setSaved(false);
												}}
												className="w-full rounded-md border border-border bg-surface-alt px-3 py-2 text-sm text-text-primary"
											>
												{MODEL_METADATA_PRESETS.map((preset) => (
													<option key={preset.id} value={preset.id}>
														{preset.label}
													</option>
												))}
											</select>
										</label>
										<label className="block">
											<span className="mb-1.5 block text-xs font-medium text-text-secondary">
												Collection path
											</span>
											<input
												value={draft.dataPath ?? ""}
												onChange={(event) =>
													updateDraft("dataPath", event.target.value)
												}
												placeholder="data (empty means root)"
												className="w-full rounded-md border border-border bg-surface-alt px-3 py-2 font-mono text-sm text-text-primary placeholder:text-text-muted"
											/>
										</label>
									</div>
									<div className="flex flex-wrap items-center gap-4">
										<label className="flex items-center gap-2 text-sm text-text-secondary">
											<input
												type="checkbox"
												checked={draft.enabled}
												onChange={(event) =>
													updateDraft("enabled", event.target.checked)
												}
												className="h-4 w-4 accent-accent"
											/>
											Use this provider
										</label>
										<label className="flex items-center gap-2 text-sm text-text-secondary">
											Format
											<select
												value={draft.format}
												onChange={(event) =>
													updateDraft(
														"format",
														event.target
															.value as ModelMetadataProvider["format"],
													)
												}
												className="rounded-md border border-border bg-surface-alt px-2 py-1.5 text-sm text-text-primary"
											>
												<option value="object">Object keyed by model ID</option>
												<option value="array">Array of model objects</option>
											</select>
										</label>
									</div>
								</section>

								<section
									className="space-y-3"
									aria-labelledby="metadata-mapping-heading"
								>
									<div className="flex flex-wrap items-center justify-between gap-3">
										<div>
											<h4
												id="metadata-mapping-heading"
												className="text-sm font-semibold text-text-primary"
											>
												Field mapping
											</h4>
											<p className="mt-1 text-xs text-text-muted">
												Dot paths support nested provider-specific fields.
											</p>
										</div>
										<div className="flex gap-2">
											<button
												type="button"
												onClick={() => void handleLoad()}
												disabled={loading || !draft.url.trim()}
												className="flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs text-text-secondary hover:bg-surface-hover disabled:opacity-50"
											>
												<RefreshCw
													className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
												/>
												{loading ? "Fetching" : "Fetch & store"}
											</button>
											<button
												type="button"
												onClick={handleAutoMap}
												disabled={!preview?.sample}
												className="flex h-8 items-center gap-1.5 rounded-md border border-accent/30 bg-accent/10 px-3 text-xs text-accent hover:bg-accent/15 disabled:opacity-50"
											>
												<Check className="h-3.5 w-3.5" /> Auto map
											</button>
										</div>
									</div>
									<div className="divide-y divide-border rounded-md border border-border">
										{MODEL_METADATA_FIELDS.map((field) => (
											<label
												key={field}
												className="grid gap-2 px-3 py-2.5 sm:grid-cols-[10rem_1fr] sm:items-center"
											>
												<span className="text-xs font-medium text-text-secondary">
													{MODEL_METADATA_FIELD_LABELS[field]}
												</span>
												<input
													aria-label={`Mapping ${MODEL_METADATA_FIELD_LABELS[field]}`}
													value={draft.mapping[field] ?? ""}
													onChange={(event) =>
														updateMapping(field, event.target.value)
													}
													placeholder="Not mapped"
													className="min-w-0 rounded-md border border-border bg-surface-alt px-2.5 py-1.5 font-mono text-xs text-text-primary placeholder:text-text-muted"
												/>
											</label>
										))}
									</div>
								</section>

								{error && (
									<p
										role="alert"
										className="flex items-center gap-2 rounded-md border border-danger-border bg-danger-bg px-3 py-2 text-xs text-danger"
									>
										<AlertCircle className="h-4 w-4 shrink-0" />
										{error}
									</p>
								)}
								{preview && (
									<p className="flex items-center gap-2 rounded-md border border-success-border bg-success-bg px-3 py-2 text-xs text-success">
										<Database className="h-4 w-4 shrink-0" />
										{preview.count.toLocaleString()} records stored;{" "}
										{mappedFields.length} fields mapped.
									</p>
								)}
								<div className="flex items-center justify-end gap-3 border-t border-border pt-4">
									{saved && (
										<span className="flex items-center gap-1 text-xs text-success">
											<Check className="h-3.5 w-3.5" />
											Saved
										</span>
									)}
									<button
										type="button"
										onClick={() => void handleSave()}
										className="flex h-9 items-center gap-2 rounded-md bg-accent px-4 text-sm font-medium text-white hover:bg-accent-hover"
									>
										<Save className="h-4 w-4" />
										Save provider
									</button>
								</div>
							</div>
						</div>
					)}
				</main>
			) : (
				<main className="flex min-w-0 flex-1 items-center justify-center p-5 text-sm text-text-muted">
					Add a metadata provider to configure model information.
				</main>
			)}
		</div>
	);
}

import {
	AlertCircle,
	Check,
	Plus,
	RefreshCw,
	Save,
	Search,
	Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
	MODEL_METADATA_FIELDS,
	MODEL_METADATA_FIELD_LABELS,
	type ModelMetadataFetchResult,
	type ModelMetadataField,
	type ModelMetadataProvider,
	fetchModelMetadata,
	inferMetadataMapping,
} from "../../services/modelMetadata";
import { useModelMetadataStore } from "../../stores/modelMetadataStore";

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
		mapping: { id: "id", name: "name" },
	};
}

export default function ModelMetadataPanel() {
	const providers = useModelMetadataStore((state) => state.providers);
	const upsert = useModelMetadataStore((state) => state.upsert);
	const remove = useModelMetadataStore((state) => state.remove);
	const [selectedId, setSelectedId] = useState<string | null>(loadSelectedId);
	const [query, setQuery] = useState("");
	const [draft, setDraft] = useState<ModelMetadataProvider | null>(null);
	const [preview, setPreview] = useState<ModelMetadataFetchResult | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);

	const selected =
		providers.find((provider) => provider.id === selectedId) ?? null;

	useEffect(() => {
		const fallback = selected ?? providers[0] ?? null;
		setSelectedId(fallback?.id ?? null);
		setDraft(fallback ? cloneProvider(fallback) : null);
		setPreview(null);
		setError(null);
	}, [providers, selected]);

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

	const selectProvider = (id: string) => {
		setSelectedId(id);
		rememberSelectedId(id);
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
			setPreview(result);
		} catch (reason) {
			setError(
				reason instanceof Error ? reason.message : "Metadata request failed",
			);
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

	const handleSave = () => {
		if (!draft) return;
		const normalized = {
			...draft,
			id: draft.id.trim(),
			name: draft.name.trim() || draft.id.trim(),
			url: draft.url.trim(),
		};
		if (!normalized.id || !normalized.url) {
			setError("Name, ID, and URL are required");
			return;
		}
		if (selectedId && selectedId !== normalized.id) remove(selectedId);
		upsert(normalized);
		setSelectedId(normalized.id);
		rememberSelectedId(normalized.id);
		setDraft(cloneProvider(normalized));
		setSaved(true);
	};

	const handleAdd = () => {
		const provider = newProvider();
		upsert(provider);
		selectProvider(provider.id);
		setDraft(cloneProvider(provider));
		setPreview(null);
		setError(null);
	};

	const handleRemove = () => {
		if (!draft) return;
		remove(draft.id);
		const next = providers.find((provider) => provider.id !== draft.id) ?? null;
		setSelectedId(next?.id ?? null);
		rememberSelectedId(next?.id ?? null);
		setDraft(next ? cloneProvider(next) : null);
		setPreview(null);
	};

	return (
		<div className="flex h-full min-h-0 bg-surface">
			<aside className="flex w-60 shrink-0 flex-col border-r border-border bg-surface-alt max-[700px]:w-full max-[700px]:border-r-0">
				<div className="border-b border-border p-3">
					<div className="relative">
						<Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
						<input
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder="Search metadata providers"
							aria-label="Search metadata providers"
							className="w-full rounded-md border border-border bg-surface py-2 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted"
						/>
					</div>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto p-2">
					{filteredProviders.map((provider) => (
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
									{provider.format === "object" ? "Object index" : "Array"}
									{" / "}
									{Object.keys(provider.mapping).length} mapped
								</span>
							</span>
							<span
								className={`h-2.5 w-2.5 shrink-0 rounded-full ${provider.enabled ? "bg-success" : "bg-transparent ring-1 ring-border"}`}
								aria-label={`${provider.name} ${provider.enabled ? "enabled" : "disabled"}`}
							/>
						</button>
					))}
					{filteredProviders.length === 0 && (
						<p className="px-2 py-4 text-xs text-text-muted">
							No matching providers
						</p>
					)}
				</div>
				<div className="border-t border-border p-2">
					<button
						type="button"
						onClick={handleAdd}
						className="flex h-9 w-full items-center justify-center gap-2 rounded-md border border-border bg-surface text-sm text-text-secondary hover:bg-surface-hover hover:text-text-primary"
					>
						<Plus className="h-4 w-4" /> Add metadata provider
					</button>
				</div>
			</aside>

			{draft ? (
				<main className="min-w-0 flex-1 overflow-y-auto p-5">
					<div className="mx-auto max-w-4xl space-y-6">
						<header className="flex items-start justify-between gap-4">
							<div>
								<h3 className="text-base font-semibold text-text-primary">
									{draft.name}
								</h3>
								<p className="mt-1 text-xs text-text-muted">
									Metadata is matched by model ID and can enrich configured
									providers.
								</p>
							</div>
							<button
								type="button"
								onClick={handleRemove}
								aria-label="Remove metadata provider"
								title="Remove metadata provider"
								className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-danger-bg hover:text-danger"
							>
								<Trash2 className="h-4 w-4" />
							</button>
						</header>

						<section
							aria-labelledby="metadata-source-heading"
							className="space-y-3"
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
										onChange={(event) => updateDraft("id", event.target.value)}
										disabled={providers.some(
											(provider) =>
												provider.id === draft.id && provider.id !== selectedId,
										)}
										className="w-full rounded-md border border-border bg-surface-alt px-3 py-2 font-mono text-sm text-text-primary disabled:opacity-60"
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
									onChange={(event) => updateDraft("url", event.target.value)}
									className="w-full rounded-md border border-border bg-surface-alt px-3 py-2 font-mono text-sm text-text-primary"
								/>
							</label>
							<div className="flex flex-wrap items-center gap-4">
								<label className="flex items-center gap-2 text-sm text-text-secondary">
									<input
										type="checkbox"
										checked={draft.enabled}
										onChange={(event) =>
											updateDraft("enabled", event.target.checked)
										}
										className="h-4 w-4 accent-accent"
									/>{" "}
									Use this provider
								</label>
								<label className="flex items-center gap-2 text-sm text-text-secondary">
									Format
									<select
										value={draft.format}
										onChange={(event) =>
											updateDraft(
												"format",
												event.target.value as ModelMetadataProvider["format"],
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
							aria-labelledby="metadata-mapping-heading"
							className="space-y-3"
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
										Use dot paths such as <code>limit.context</code>. Empty
										paths leave fields unmapped.
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
										/>{" "}
										{loading ? "Loading" : "Load sample"}
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
							<section
								aria-labelledby="metadata-preview-heading"
								className="space-y-3"
							>
								<div className="flex items-center justify-between gap-3">
									<div>
										<h4
											id="metadata-preview-heading"
											className="text-sm font-semibold text-text-primary"
										>
											Preview
										</h4>
										<p className="mt-1 text-xs text-text-muted">
											{preview.count.toLocaleString()} records loaded;{" "}
											{mappedFields.length} fields mapped.
										</p>
									</div>
									{saved && (
										<span className="flex items-center gap-1 text-xs text-success">
											<Check className="h-3.5 w-3.5" />
											Saved
										</span>
									)}
								</div>
								<div className="divide-y divide-border rounded-md border border-border">
									{preview.records.slice(0, 6).map((record) => (
										<div
											key={record.id}
											className="grid gap-1 px-3 py-2.5 sm:grid-cols-[minmax(12rem,1fr)_minmax(12rem,2fr)]"
										>
											<span className="font-mono text-xs text-text-primary">
												{record.id}
											</span>
											<span className="truncate text-xs text-text-secondary">
												{record.name ??
													record.description ??
													"No display metadata"}
											</span>
										</div>
									))}
									{preview.records.length === 0 && (
										<p className="px-3 py-4 text-xs text-text-muted">
											No records matched the current mapping.
										</p>
									)}
								</div>
							</section>
						)}
						<div className="flex justify-end border-t border-border pt-4">
							<button
								type="button"
								onClick={handleSave}
								className="flex h-9 items-center gap-2 rounded-md bg-accent px-4 text-sm font-medium text-white hover:bg-accent/90"
							>
								<Save className="h-4 w-4" />
								Save provider
							</button>
						</div>
					</div>
				</main>
			) : (
				<main className="flex min-w-0 flex-1 items-center justify-center p-5 text-sm text-text-muted">
					Add a metadata provider to configure model information.
				</main>
			)}
		</div>
	);
}

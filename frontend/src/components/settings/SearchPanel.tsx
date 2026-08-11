import { ArrowLeft, Check, Globe2, Loader2, Save, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	DEFAULT_WEB_SEARCH_SETTINGS,
	type OpenSERPEngine,
	type SearchProvider,
	type WebSearchSettings,
	webSearchApi,
} from "../../services/webSearch";
import { useSettingsStore } from "../../stores/settingsStore";
import { toast } from "../../stores/toastStore";

const PROVIDERS: Array<{
	value: SearchProvider;
	label: string;
	detail: string;
}> = [
	{
		value: "duckduckgo",
		label: "DuckDuckGo",
		detail: "Web results + Instant Answers",
	},
	{ value: "searxng", label: "SearXNG", detail: "Custom endpoint" },
	{ value: "openserp", label: "OpenSERP", detail: "Custom endpoint" },
];

const OPENSERP_ENGINES: Array<{ value: OpenSERPEngine; label: string }> = [
	{ value: "mega", label: "Mega search" },
	{ value: "google", label: "Google" },
	{ value: "bing", label: "Bing" },
	{ value: "duckduckgo", label: "DuckDuckGo" },
	{ value: "baidu", label: "Baidu" },
	{ value: "yandex", label: "Yandex" },
	{ value: "ecosia", label: "Ecosia" },
];

function SearchSwitch({
	checked,
	label,
	onChange,
}: { checked: boolean; label: string; onChange: (checked: boolean) => void }) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			aria-label={label}
			onClick={() => onChange(!checked)}
			className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors ${checked ? "bg-accent" : "bg-surface-hover"}`}
		>
			<span
				aria-hidden="true"
				className={`h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${checked ? "translate-x-5" : "translate-x-0"}`}
			/>
		</button>
	);
}

function TextField({
	label,
	value,
	onChange,
	placeholder,
}: {
	label: string;
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
}) {
	return (
		<label className="block min-w-0">
			<span className="mb-1.5 block text-xs font-medium text-text-secondary">
				{label}
			</span>
			<input
				autoComplete="off"
				type="url"
				value={value}
				onChange={(event) => onChange(event.target.value)}
				placeholder={placeholder}
				className="w-full rounded-md border border-border bg-surface-alt px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
			/>
		</label>
	);
}

function validateEndpoint(label: string, value: string): void {
	let endpoint: URL;
	try {
		endpoint = new URL(value);
	} catch {
		throw new Error(`${label} endpoint must be an absolute URL`);
	}
	if (
		!(["http:", "https:"] as const).includes(
			endpoint.protocol as "http:" | "https:",
		)
	) {
		throw new Error(`${label} endpoint must use HTTP or HTTPS`);
	}
	if (endpoint.username || endpoint.password) {
		throw new Error(`${label} endpoint cannot contain credentials`);
	}
}

export default function SearchPanel() {
	const loaded = useSettingsStore((state) => state.searchSettingsLoaded);
	const loadSettings = useSettingsStore((state) => state.loadWebSearchSettings);
	const saveSettings = useSettingsStore((state) => state.saveWebSearchSettings);
	const searchEnabled = useSettingsStore((state) => state.searchEnabled);
	const searchProvider = useSettingsStore((state) => state.searchProvider);
	const searchMaxResults = useSettingsStore((state) => state.searchMaxResults);
	const searxng = useSettingsStore((state) => state.searXNGSearchSettings);
	const openserp = useSettingsStore((state) => state.openSERPSearchSettings);
	const normalizedStoreSettings = useMemo<WebSearchSettings>(
		() => ({
			enabled: searchEnabled,
			provider: searchProvider,
			max_results: searchMaxResults,
			searxng: { ...searxng },
			openserp: { ...openserp },
		}),
		[openserp, searchEnabled, searchMaxResults, searchProvider, searxng],
	);
	const [draft, setDraft] = useState<WebSearchSettings>({
		...DEFAULT_WEB_SEARCH_SETTINGS,
		searxng: { ...DEFAULT_WEB_SEARCH_SETTINGS.searxng },
		openserp: { ...DEFAULT_WEB_SEARCH_SETTINGS.openserp },
	});
	const [selectedProvider, setSelectedProvider] =
		useState<SearchProvider>("duckduckgo");
	const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
	const [saving, setSaving] = useState(false);
	const [testing, setTesting] = useState(false);
	const selectionInitialized = useRef(false);

	useEffect(() => {
		if (!loaded) void loadSettings();
	}, [loadSettings, loaded]);

	useEffect(() => {
		if (!loaded) return;
		setDraft(normalizedStoreSettings);
		if (!selectionInitialized.current) {
			setSelectedProvider(normalizedStoreSettings.provider);
			selectionInitialized.current = true;
		}
	}, [loaded, normalizedStoreSettings]);

	const selected =
		PROVIDERS.find((provider) => provider.value === selectedProvider) ??
		PROVIDERS[0];
	const ready = (provider: SearchProvider) =>
		provider === "duckduckgo" ||
		(provider === "searxng"
			? Boolean(draft.searxng.endpoint.trim())
			: Boolean(draft.openserp.endpoint.trim()));

	const validate = (provider: SearchProvider) => {
		if (provider === "searxng")
			validateEndpoint("SearXNG", draft.searxng.endpoint);
		if (provider === "openserp")
			validateEndpoint("OpenSERP", draft.openserp.endpoint);
	};

	const persist = async (provider: SearchProvider, showToast: boolean) => {
		validate(provider);
		await saveSettings(draft);
		if (showToast) toast.success("Web search settings saved");
	};

	const handleSave = async () => {
		setSaving(true);
		try {
			await persist(draft.provider, true);
		} catch (error) {
			toast.error(
				error instanceof Error
					? error.message
					: "Failed to save web search settings",
			);
		} finally {
			setSaving(false);
		}
	};

	const handleTest = async () => {
		setTesting(true);
		try {
			await persist(selectedProvider, false);
			const response = await webSearchApi.test(
				selectedProvider,
				draft.max_results,
			);
			toast.success(`${response.provider}: ${response.results.length} results`);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Search connection failed",
			);
		} finally {
			setTesting(false);
		}
	};

	if (!loaded) {
		return (
			<output
				className="flex h-full min-h-48 items-center justify-center"
				aria-label="Loading web search settings"
			>
				<Loader2 className="h-5 w-5 animate-spin text-text-muted" />
			</output>
		);
	}

	return (
		<div className="flex h-full min-h-0 bg-surface">
			<aside
				data-mobile-pane="search-provider-list"
				className={`flex w-60 shrink-0 flex-col border-r border-border bg-surface-alt max-[700px]:w-full max-[700px]:border-r-0 ${mobileDetailOpen ? "max-[700px]:hidden" : ""}`}
			>
				<div className="flex items-center justify-between gap-3 border-b border-border p-3">
					<div>
						<p className="text-sm font-medium text-text-primary">Web search</p>
						<p className="mt-0.5 text-[11px] text-text-muted">
							Default for new conversations
						</p>
					</div>
					<SearchSwitch
						checked={draft.enabled}
						label="Enable web search by default"
						onChange={(enabled) =>
							setDraft((current) => ({ ...current, enabled }))
						}
					/>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto p-2">
					{PROVIDERS.map((provider) => (
						<button
							key={provider.value}
							type="button"
							onClick={() => {
								setSelectedProvider(provider.value);
								setMobileDetailOpen(true);
							}}
							aria-label={`Configure ${provider.label}`}
							aria-current={
								selectedProvider === provider.value ? "page" : undefined
							}
							className={`mb-1 flex w-full items-center gap-2.5 rounded-md border px-2.5 py-2 text-left ${selectedProvider === provider.value ? "border-border bg-surface" : "border-transparent hover:bg-surface-hover"}`}
						>
							<Globe2 className="h-4 w-4 shrink-0 text-text-muted" />
							<span className="min-w-0 flex-1">
								<span className="block truncate text-sm font-medium text-text-primary">
									{provider.label}
								</span>
								<span className="block truncate text-[11px] text-text-muted">
									{provider.detail}
								</span>
							</span>
							<span
								className={`h-2.5 w-2.5 rounded-full ${ready(provider.value) ? "bg-success" : "border border-border"}`}
								aria-label={`${provider.label} ${ready(provider.value) ? "ready" : "not configured"}`}
							/>
						</button>
					))}
				</div>
				<label className="border-t border-border p-3">
					<span className="mb-1.5 block text-[11px] font-medium text-text-muted">
						Results per search
					</span>
					<input
						autoComplete="off"
						type="number"
						min={1}
						max={10}
						value={draft.max_results}
						onChange={(event) =>
							setDraft((current) => ({
								...current,
								max_results: Math.min(
									10,
									Math.max(1, Number(event.target.value) || 1),
								),
							}))
						}
						className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
					/>
				</label>
			</aside>

			<div
				data-mobile-pane="search-provider-detail"
				className={`min-w-0 flex-1 flex-col ${mobileDetailOpen ? "flex" : "flex max-[700px]:hidden"}`}
			>
				<div className="hidden h-11 items-center border-b border-border px-2 max-[700px]:flex">
					<button
						type="button"
						onClick={() => setMobileDetailOpen(false)}
						aria-label="Back to search providers"
						className="flex h-8 items-center gap-1 rounded-md px-2 text-sm text-text-secondary hover:bg-surface-hover"
					>
						<ArrowLeft className="h-4 w-4" />
						Providers
					</button>
				</div>
				<header className="flex min-h-16 items-center justify-between gap-3 border-b border-border px-5 py-3">
					<div>
						<h3 className="text-base font-semibold text-text-primary">
							{selected.label}
						</h3>
						<p className="text-xs text-text-muted">{selected.detail}</p>
					</div>
					{draft.provider === selectedProvider ? (
						<span className="flex items-center gap-1.5 text-xs text-accent">
							<Check className="h-3.5 w-3.5" />
							Default
						</span>
					) : (
						<button
							type="button"
							onClick={() =>
								setDraft((current) => ({
									...current,
									provider: selectedProvider,
								}))
							}
							className="rounded-md border border-border px-2.5 py-1.5 text-xs text-text-secondary hover:bg-surface-hover"
						>
							Set as default
						</button>
					)}
				</header>
				<div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
					<div className="mx-auto max-w-3xl space-y-5">
						{selectedProvider === "duckduckgo" && (
							<div className="border-b border-border pb-5">
								<p className="text-sm font-medium text-text-primary">
									Ready without configuration
								</p>
								<p className="mt-1 text-xs text-text-muted">
									HTML web results with featured Instant Answer summaries
								</p>
							</div>
						)}
						{selectedProvider === "searxng" && (
							<TextField
								label="SearXNG endpoint"
								value={draft.searxng.endpoint}
								onChange={(endpoint) =>
									setDraft((current) => ({ ...current, searxng: { endpoint } }))
								}
								placeholder="http://127.0.0.1:8888"
							/>
						)}
						{selectedProvider === "openserp" && (
							<>
								<TextField
									label="OpenSERP endpoint"
									value={draft.openserp.endpoint}
									onChange={(endpoint) =>
										setDraft((current) => ({
											...current,
											openserp: { ...current.openserp, endpoint },
										}))
									}
									placeholder="http://127.0.0.1:7000"
								/>
								<label className="block">
									<span className="mb-1.5 block text-xs font-medium text-text-secondary">
										Search engine
									</span>
									<select
										value={draft.openserp.engine}
										onChange={(event) =>
											setDraft((current) => ({
												...current,
												openserp: {
													...current.openserp,
													engine: event.target.value as OpenSERPEngine,
												},
											}))
										}
										className="w-full rounded-md border border-border bg-surface-alt px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
									>
										{OPENSERP_ENGINES.map((engine) => (
											<option key={engine.value} value={engine.value}>
												{engine.label}
											</option>
										))}
									</select>
								</label>
								{draft.openserp.engine === "mega" && (
									<TextField
										label="Mega search engines"
										value={draft.openserp.engines}
										onChange={(engines) =>
											setDraft((current) => ({
												...current,
												openserp: { ...current.openserp, engines },
											}))
										}
										placeholder="google,bing,duckduckgo"
									/>
								)}
							</>
						)}
						<button
							type="button"
							onClick={() => void handleTest()}
							disabled={testing || saving}
							className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-xs font-medium text-text-secondary hover:bg-surface-hover disabled:opacity-50"
						>
							{testing ? (
								<Loader2 className="h-4 w-4 animate-spin" />
							) : (
								<Search className="h-4 w-4" />
							)}
							Test connection
						</button>
					</div>
				</div>
				<div className="flex justify-end border-t border-border px-5 py-3">
					<button
						type="button"
						onClick={() => void handleSave()}
						disabled={saving || testing}
						className="inline-flex min-h-9 items-center gap-2 rounded-md bg-accent px-3 py-2 text-xs font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
					>
						{saving ? (
							<Loader2 className="h-3.5 w-3.5 animate-spin" />
						) : (
							<Save className="h-3.5 w-3.5" />
						)}
						Save changes
					</button>
				</div>
			</div>
		</div>
	);
}

// Web search settings: default provider, endpoints, and connection tests.

import { ArrowLeft, Check, Globe2, Loader2, Save, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { type MessageKey, t, useT } from "../../i18n";
import {
	DEFAULT_WEB_SEARCH_SETTINGS,
	type OpenSERPEngine,
	type SearchProvider,
	type WebSearchSettings,
	webSearchApi,
} from "../../services/webSearch";
import { useSettingsStore } from "../../stores/settingsStore";
import { toast } from "../../stores/toastStore";

/** Provider list metadata; labels resolve through the catalog at render time. */
const PROVIDERS: Array<{
	value: SearchProvider;
	labelKey: MessageKey;
	detailKey: MessageKey;
}> = [
	{
		value: "duckduckgo",
		labelKey: "searchPanel.duckduckgo",
		detailKey: "searchPanel.duckduckgoDetail",
	},
	{
		value: "searxng",
		labelKey: "searchPanel.searxng",
		detailKey: "searchPanel.searxngDetail",
	},
	{
		value: "openserp",
		labelKey: "searchPanel.openserp",
		detailKey: "searchPanel.openserpDetail",
	},
];

/** OpenSERP engine options; brand names stay in the catalog as product names. */
const OPENSERP_ENGINES: Array<{ value: OpenSERPEngine; labelKey: MessageKey }> =
	[
		{ value: "mega", labelKey: "searchPanel.mega" },
		{ value: "google", labelKey: "searchPanel.google" },
		{ value: "bing", labelKey: "searchPanel.bing" },
		{ value: "duckduckgo", labelKey: "searchPanel.duckduckgo" },
		{ value: "baidu", labelKey: "searchPanel.baidu" },
		{ value: "yandex", labelKey: "searchPanel.yandex" },
		{ value: "ecosia", labelKey: "searchPanel.ecosia" },
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

/** Reject relative, non-HTTP, or credential-bearing search endpoints. */
function validateEndpoint(name: string, value: string): void {
	let endpoint: URL;
	try {
		endpoint = new URL(value);
	} catch {
		throw new Error(t("searchPanel.endpointAbsolute", { name }));
	}
	if (
		!(["http:", "https:"] as const).includes(
			endpoint.protocol as "http:" | "https:",
		)
	) {
		throw new Error(t("searchPanel.endpointProtocol", { name }));
	}
	if (endpoint.username || endpoint.password) {
		throw new Error(t("searchPanel.endpointCredentials", { name }));
	}
}

/** Default search provider, endpoints, and per-conversation toggle. */
export default function SearchPanel() {
	const translate = useT();
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
	const selectedLabel = translate(selected.labelKey);
	const selectedDetail = translate(selected.detailKey);
	const ready = (provider: SearchProvider) =>
		provider === "duckduckgo" ||
		(provider === "searxng"
			? Boolean(draft.searxng.endpoint.trim())
			: Boolean(draft.openserp.endpoint.trim()));

	const validate = (provider: SearchProvider) => {
		if (provider === "searxng")
			validateEndpoint(
				translate("searchPanel.searxng"),
				draft.searxng.endpoint,
			);
		if (provider === "openserp")
			validateEndpoint(
				translate("searchPanel.openserp"),
				draft.openserp.endpoint,
			);
	};

	const persist = async (provider: SearchProvider, showToast: boolean) => {
		validate(provider);
		await saveSettings(draft);
		if (showToast) toast.success(t("toast.searchSettingsSaved"));
	};

	const handleSave = async () => {
		setSaving(true);
		try {
			await persist(draft.provider, true);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : t("searchPanel.saveFailed"),
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
			toast.success(
				t("toast.searchResults", {
					provider: response.provider,
					count: response.results.length,
				}),
			);
		} catch (error) {
			toast.error(
				error instanceof Error
					? error.message
					: t("searchPanel.connectionFailed"),
			);
		} finally {
			setTesting(false);
		}
	};

	if (!loaded) {
		return (
			<output
				className="flex h-full min-h-48 items-center justify-center"
				aria-label={translate("searchPanel.loading")}
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
						<p className="text-sm font-medium text-text-primary">
							{translate("searchPanel.heading")}
						</p>
						<p className="mt-0.5 text-[11px] text-text-muted">
							{translate("searchPanel.defaultForNew")}
						</p>
					</div>
					<SearchSwitch
						checked={draft.enabled}
						label={translate("searchPanel.enableDefault")}
						onChange={(enabled) =>
							setDraft((current) => ({ ...current, enabled }))
						}
					/>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto p-2">
					{PROVIDERS.map((provider) => {
						const label = translate(provider.labelKey);
						return (
							<button
								key={provider.value}
								type="button"
								onClick={() => {
									setSelectedProvider(provider.value);
									setMobileDetailOpen(true);
								}}
								aria-label={translate("searchPanel.configure", { name: label })}
								aria-current={
									selectedProvider === provider.value ? "page" : undefined
								}
								className={`mb-1 flex w-full items-center gap-2.5 rounded-md border px-2.5 py-2 text-left ${selectedProvider === provider.value ? "border-border bg-surface" : "border-transparent hover:bg-surface-hover"}`}
							>
								<Globe2 className="h-4 w-4 shrink-0 text-text-muted" />
								<span className="min-w-0 flex-1">
									<span className="block truncate text-sm font-medium text-text-primary">
										{label}
									</span>
									<span className="block truncate text-[11px] text-text-muted">
										{translate(provider.detailKey)}
									</span>
								</span>
								<span
									className={`h-2.5 w-2.5 rounded-full ${ready(provider.value) ? "bg-success" : "border border-border"}`}
									aria-label={
										ready(provider.value)
											? translate("searchPanel.statusReady", { name: label })
											: translate("searchPanel.statusNotConfigured", {
													name: label,
												})
									}
								/>
							</button>
						);
					})}
				</div>
				<label className="border-t border-border p-3">
					<span className="mb-1.5 block text-[11px] font-medium text-text-muted">
						{translate("searchPanel.resultsPerSearch")}
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
						aria-label={translate("searchPanel.back")}
						className="flex h-8 items-center gap-1 rounded-md px-2 text-sm text-text-secondary hover:bg-surface-hover"
					>
						<ArrowLeft className="h-4 w-4" />
						{translate("searchPanel.providers")}
					</button>
				</div>
				<header className="flex min-h-16 items-center justify-between gap-3 border-b border-border px-5 py-3">
					<div>
						<h3 className="text-base font-semibold text-text-primary">
							{selectedLabel}
						</h3>
						<p className="text-xs text-text-muted">{selectedDetail}</p>
					</div>
					{draft.provider === selectedProvider ? (
						<span className="flex items-center gap-1.5 text-xs text-accent">
							<Check className="h-3.5 w-3.5" />
							{translate("searchPanel.default")}
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
							{translate("searchPanel.setDefault")}
						</button>
					)}
				</header>
				<div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
					<div className="mx-auto max-w-3xl space-y-5">
						{selectedProvider === "duckduckgo" && (
							<div className="border-b border-border pb-5">
								<p className="text-sm font-medium text-text-primary">
									{translate("searchPanel.readyNoConfig")}
								</p>
								<p className="mt-1 text-xs text-text-muted">
									{translate("searchPanel.duckduckgoHelp")}
								</p>
							</div>
						)}
						{selectedProvider === "searxng" && (
							<TextField
								label={translate("searchPanel.endpoint")}
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
									label={translate("searchPanel.openserpEndpoint")}
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
										{translate("searchPanel.searchEngine")}
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
												{translate(engine.labelKey)}
											</option>
										))}
									</select>
								</label>
								{draft.openserp.engine === "mega" && (
									<TextField
										label={translate("searchPanel.megaEngines")}
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
							{translate("searchPanel.testConnection")}
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
						{translate("common.saveChanges")}
					</button>
				</div>
			</div>
		</div>
	);
}

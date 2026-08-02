import {
	ArrowLeft,
	Check,
	Globe2,
	KeyRound,
	Loader2,
	Save,
	Search,
	ShieldCheck,
	Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { secretsApi } from "../../services/secrets";
import {
	DEFAULT_WEB_SEARCH_SETTINGS,
	SEARCH_SECRET_IDS,
	type SearchProvider,
	type WebSearchSettings,
	webSearchApi,
} from "../../services/webSearch";
import { confirm } from "../../stores/confirmStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { toast } from "../../stores/toastStore";

const PROVIDERS: Array<{
	value: SearchProvider;
	label: string;
	detail: string;
	description: string;
}> = [
	{
		value: "duckduckgo",
		label: "DuckDuckGo",
		detail: "No API key",
		description: "Keyless web search with no account configuration.",
	},
	{
		value: "bing",
		label: "Bing Web Search",
		detail: "API key",
		description: "Microsoft Bing Web Search API v7.",
	},
	{
		value: "google",
		label: "Google Custom Search",
		detail: "API key + engine ID",
		description: "Google Programmable Search Engine JSON API.",
	},
	{
		value: "custom",
		label: "Custom JSON endpoint",
		detail: "Mapped response",
		description: "Connect an HTTP JSON search service and map its response.",
	},
];

type KeyProvider = keyof typeof SEARCH_SECRET_IDS;

function providerInitial(name: string): string {
	return name.trim().charAt(0).toUpperCase() || "S";
}

function switchClass(enabled: boolean): string {
	return enabled ? "bg-accent" : "bg-surface-hover";
}

function SearchSwitch({
	checked,
	label,
	onChange,
}: {
	checked: boolean;
	label: string;
	onChange: (checked: boolean) => void;
}) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			aria-label={label}
			onClick={() => onChange(!checked)}
			className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${switchClass(checked)}`}
		>
			<span
				aria-hidden="true"
				className={`h-3.5 w-3.5 rounded-full bg-white transition-transform ${checked ? "translate-x-5" : "translate-x-1"}`}
			/>
		</button>
	);
}

function SecretField({
	provider,
	value,
	stored,
	onChange,
	onClear,
}: {
	provider: KeyProvider;
	value: string;
	stored: boolean;
	onChange: (value: string) => void;
	onClear: () => void;
}) {
	const label = `${provider === "google" ? "Google" : provider === "bing" ? "Bing" : "Custom provider"} API key`;
	return (
		<label className="block">
			<span className="mb-1.5 flex items-center justify-between gap-3 text-xs font-medium text-text-secondary">
				{label}
				{stored && (
					<span className="flex items-center gap-1 text-[10px] font-normal text-success">
						<ShieldCheck className="h-3 w-3" />
						Stored
					</span>
				)}
			</span>
			<span className="flex items-center gap-2">
				<input
					type="password"
					value={value}
					onChange={(event) => onChange(event.target.value)}
					placeholder={
						stored ? "Leave blank to keep stored key" : "Enter API key"
					}
					autoComplete="off"
					className="min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
				/>
				{stored && (
					<button
						type="button"
						onClick={onClear}
						aria-label={`Remove ${label}`}
						title={`Remove ${label}`}
						className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-danger"
					>
						<Trash2 className="h-4 w-4" />
					</button>
				)}
			</span>
		</label>
	);
}

function TextField({
	label,
	value,
	onChange,
	placeholder,
	type = "text",
}: {
	label: string;
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	type?: "text" | "url";
}) {
	return (
		<label className="block min-w-0">
			<span className="mb-1.5 block text-xs font-medium text-text-secondary">
				{label}
			</span>
			<input
				autoComplete="off"
				type={type}
				value={value}
				onChange={(event) => onChange(event.target.value)}
				placeholder={placeholder}
				className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
			/>
		</label>
	);
}

export default function SearchPanel() {
	const loaded = useSettingsStore((state) => state.searchSettingsLoaded);
	const loadSettings = useSettingsStore((state) => state.loadWebSearchSettings);
	const saveSettings = useSettingsStore((state) => state.saveWebSearchSettings);
	const searchEnabled = useSettingsStore((state) => state.searchEnabled);
	const searchProvider = useSettingsStore((state) => state.searchProvider);
	const searchMaxResults = useSettingsStore((state) => state.searchMaxResults);
	const googleSearchEngineId = useSettingsStore(
		(state) => state.googleSearchEngineId,
	);
	const customSearchSettings = useSettingsStore(
		(state) => state.customSearchSettings,
	);
	const storeSettings = useMemo<WebSearchSettings>(
		() => ({
			enabled: searchEnabled,
			provider: searchProvider,
			max_results: searchMaxResults,
			google_cse_id: googleSearchEngineId,
			custom: customSearchSettings,
		}),
		[
			customSearchSettings,
			googleSearchEngineId,
			searchEnabled,
			searchMaxResults,
			searchProvider,
		],
	);
	const [draft, setDraft] = useState<WebSearchSettings>({
		...DEFAULT_WEB_SEARCH_SETTINGS,
		custom: { ...DEFAULT_WEB_SEARCH_SETTINGS.custom },
	});
	const [selectedProvider, setSelectedProvider] =
		useState<SearchProvider>("duckduckgo");
	const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
	const [keys, setKeys] = useState<Record<KeyProvider, string>>({
		bing: "",
		google: "",
		custom: "",
	});
	const [storedSecrets, setStoredSecrets] = useState<Set<string>>(new Set());
	const [saving, setSaving] = useState(false);
	const [testing, setTesting] = useState(false);
	const selectionInitialized = useRef(false);

	useEffect(() => {
		if (!loaded) void loadSettings();
		void secretsApi
			.list()
			.then(({ provider_ids }) => setStoredSecrets(new Set(provider_ids)))
			.catch(() => undefined);
	}, [loadSettings, loaded]);

	useEffect(() => {
		if (!loaded) return;
		setDraft({ ...storeSettings, custom: { ...storeSettings.custom } });
		if (!selectionInitialized.current) {
			setSelectedProvider(storeSettings.provider);
			selectionInitialized.current = true;
		}
	}, [loaded, storeSettings]);

	const selected =
		PROVIDERS.find((provider) => provider.value === selectedProvider) ??
		PROVIDERS[0];
	const activeSecret =
		selectedProvider === "duckduckgo" ? null : selectedProvider;

	const updateCustom = (
		field: keyof WebSearchSettings["custom"],
		value: string,
	) => {
		setDraft((current) => ({
			...current,
			custom: { ...current.custom, [field]: value },
		}));
	};

	const hasSecret = (provider: KeyProvider) =>
		keys[provider].trim().length > 0 ||
		storedSecrets.has(SEARCH_SECRET_IDS[provider]);

	const providerStatus = (provider: SearchProvider) => {
		switch (provider) {
			case "duckduckgo":
				return { label: "Ready", ready: true };
			case "bing":
				return hasSecret("bing")
					? { label: "Key stored", ready: true }
					: { label: "API key required", ready: false };
			case "google":
				return hasSecret("google") && draft.google_cse_id.trim()
					? { label: "Configured", ready: true }
					: { label: "Key and engine ID required", ready: false };
			case "custom": {
				const keyReady =
					!draft.custom.api_key_header.trim() || hasSecret("custom");
				return draft.custom.endpoint.trim() && keyReady
					? { label: "Configured", ready: true }
					: { label: "Endpoint required", ready: false };
			}
		}
	};

	const validateProvider = (provider: SearchProvider) => {
		if (provider === "bing" && !hasSecret("bing")) {
			throw new Error("Bing API key is required");
		}
		if (provider === "google") {
			if (!hasSecret("google")) throw new Error("Google API key is required");
			if (!draft.google_cse_id.trim()) {
				throw new Error("Google search engine ID is required");
			}
		}
		if (provider === "custom") {
			let endpoint: URL;
			try {
				endpoint = new URL(draft.custom.endpoint);
			} catch {
				throw new Error("Custom endpoint must be an absolute URL");
			}
			if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
				throw new Error("Custom endpoint must use HTTP or HTTPS");
			}
			if (endpoint.username || endpoint.password) {
				throw new Error("Custom endpoint cannot contain credentials");
			}
			if (draft.custom.api_key_header.trim() && !hasSecret("custom")) {
				throw new Error("Custom provider API key is required");
			}
		}
	};

	const persist = async (
		providerToValidate: SearchProvider,
		showToast: boolean,
	) => {
		validateProvider(providerToValidate);
		for (const provider of ["bing", "google", "custom"] as const) {
			const key = keys[provider].trim();
			if (key) await secretsApi.putKey(SEARCH_SECRET_IDS[provider], key);
		}
		await saveSettings(draft);
		setStoredSecrets((current) => {
			const next = new Set(current);
			for (const provider of ["bing", "google", "custom"] as const) {
				if (keys[provider].trim()) next.add(SEARCH_SECRET_IDS[provider]);
			}
			return next;
		});
		setKeys({ bing: "", google: "", custom: "" });
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

	const clearSecret = async (provider: KeyProvider) => {
		const accepted = await confirm.ask(
			"Remove search API key?",
			"The stored key will be deleted from EncoreHub secrets.",
		);
		if (!accepted) return;
		try {
			await secretsApi.deleteKey(SEARCH_SECRET_IDS[provider]);
			setStoredSecrets((current) => {
				const next = new Set(current);
				next.delete(SEARCH_SECRET_IDS[provider]);
				return next;
			});
			toast.success("Search API key removed");
		} catch (error) {
			toast.error(
				error instanceof Error
					? error.message
					: "Failed to remove search API key",
			);
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
				className={`flex w-72 shrink-0 flex-col border-r border-border bg-surface-alt max-[900px]:w-60 max-[700px]:w-full max-[700px]:border-r-0 ${
					mobileDetailOpen ? "max-[700px]:hidden" : ""
				}`}
			>
				<div className="border-b border-border p-3">
					<div className="flex items-center justify-between gap-3">
						<div className="min-w-0">
							<p className="text-sm font-medium text-text-primary">
								Web search
							</p>
							<p className="mt-0.5 truncate text-[11px] text-text-muted">
								Available to new conversations
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
				</div>

				<div className="min-h-0 flex-1 overflow-y-auto p-2">
					<p className="px-2 pb-2 pt-1 text-[10px] font-semibold uppercase text-text-muted">
						Search providers
					</p>
					{PROVIDERS.map((provider) => {
						const selectedItem = selectedProvider === provider.value;
						const status = providerStatus(provider.value);
						return (
							<button
								key={provider.value}
								type="button"
								onClick={() => {
									setSelectedProvider(provider.value);
									setMobileDetailOpen(true);
								}}
								aria-label={`Configure ${provider.label}`}
								aria-current={selectedItem ? "page" : undefined}
								className={`mb-1 flex w-full items-center gap-2.5 rounded-md border px-2.5 py-2 text-left transition-colors ${
									selectedItem
										? "border-border bg-surface text-text-primary shadow-sm"
										: "border-transparent text-text-secondary hover:bg-surface-hover hover:text-text-primary"
								}`}
							>
								<span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-hover text-xs font-semibold text-text-secondary">
									{providerInitial(provider.label)}
								</span>
								<span className="min-w-0 flex-1">
									<span className="flex min-w-0 items-center gap-1.5">
										<span className="truncate text-sm font-medium">
											{provider.label}
										</span>
										{draft.provider === provider.value && (
											<span className="shrink-0 rounded bg-accent/10 px-1 py-0.5 text-[9px] uppercase text-accent">
												default
											</span>
										)}
									</span>
									<span className="block truncate text-[11px] text-text-muted">
										{status.label}
									</span>
								</span>
								<span
									className={`h-2.5 w-2.5 shrink-0 rounded-full ${
										status.ready ? "bg-success" : "border border-border"
									}`}
									aria-label={`${provider.label} status: ${status.label}`}
								/>
							</button>
						);
					})}
				</div>

				<div className="space-y-3 border-t border-border p-3">
					<label className="block">
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
				</div>
			</aside>

			<div
				data-mobile-pane="search-provider-detail"
				className={`min-w-0 flex-1 flex-col ${
					mobileDetailOpen ? "flex" : "flex max-[700px]:hidden"
				}`}
			>
				<div className="hidden h-11 shrink-0 items-center gap-2 border-b border-border bg-surface px-2 max-[700px]:flex">
					<button
						type="button"
						onClick={() => setMobileDetailOpen(false)}
						aria-label="Back to search providers"
						className="flex h-8 items-center gap-1 rounded-md px-2 text-sm text-text-secondary hover:bg-surface-hover hover:text-text-primary"
					>
						<ArrowLeft className="h-4 w-4" />
						Providers
					</button>
					<span className="min-w-0 flex-1 truncate text-right text-xs text-text-muted">
						{selected.label}
					</span>
				</div>

				<div className="min-h-0 flex-1 overflow-y-auto">
					<div className="mx-auto max-w-3xl space-y-6 p-5 sm:p-6">
						<header className="flex items-start gap-3 border-b border-border pb-5">
							<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-hover text-sm font-semibold text-text-secondary">
								{providerInitial(selected.label)}
							</span>
							<div className="min-w-0 flex-1">
								<h3 className="text-base font-semibold text-text-primary">
									{selected.label}
								</h3>
								<p className="mt-1 text-xs leading-5 text-text-muted">
									{selected.description}
								</p>
							</div>
							{draft.provider === selectedProvider ? (
								<span className="flex shrink-0 items-center gap-1.5 rounded-md bg-accent/10 px-2.5 py-1.5 text-xs font-medium text-accent">
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
									className="shrink-0 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-hover hover:text-text-primary"
								>
									Set as default
								</button>
							)}
						</header>

						<section
							aria-labelledby="search-credentials-heading"
							className="space-y-4"
						>
							<div className="flex items-center gap-2">
								{activeSecret ? (
									<KeyRound className="h-4 w-4 text-text-muted" />
								) : (
									<Globe2 className="h-4 w-4 text-text-muted" />
								)}
								<h4
									id="search-credentials-heading"
									className="text-xs font-semibold text-text-secondary"
								>
									{activeSecret ? "Connection" : "Connection status"}
								</h4>
							</div>

							{activeSecret ? (
								<SecretField
									provider={activeSecret}
									value={keys[activeSecret]}
									stored={storedSecrets.has(SEARCH_SECRET_IDS[activeSecret])}
									onChange={(value) =>
										setKeys((current) => ({
											...current,
											[activeSecret]: value,
										}))
									}
									onClear={() => void clearSecret(activeSecret)}
								/>
							) : (
								<div className="flex items-center gap-2 rounded-md border border-border bg-surface-alt px-3 py-2.5 text-xs text-text-secondary">
									<ShieldCheck className="h-4 w-4 text-success" />
									Ready without credentials
								</div>
							)}

							{selectedProvider === "google" && (
								<TextField
									label="Programmable Search Engine ID"
									value={draft.google_cse_id}
									onChange={(google_cse_id) =>
										setDraft((current) => ({ ...current, google_cse_id }))
									}
									placeholder="Search engine ID"
								/>
							)}
						</section>

						{selectedProvider === "custom" && (
							<section
								aria-labelledby="custom-search-heading"
								className="space-y-5 border-t border-border pt-5"
							>
								<div>
									<h4
										id="custom-search-heading"
										className="text-xs font-semibold text-text-secondary"
									>
										Endpoint
									</h4>
									<p className="mt-1 text-[11px] leading-5 text-text-muted">
										EncoreHub sends GET requests with the query and result
										limit.
									</p>
								</div>
								<div className="grid gap-4 sm:grid-cols-2">
									<TextField
										label="Display name"
										value={draft.custom.name}
										onChange={(value) => updateCustom("name", value)}
									/>
									<TextField
										label="Endpoint URL"
										type="url"
										value={draft.custom.endpoint}
										onChange={(value) => updateCustom("endpoint", value)}
										placeholder="https://search.example.com/api"
									/>
									<TextField
										label="Query parameter"
										value={draft.custom.query_parameter}
										onChange={(value) => updateCustom("query_parameter", value)}
									/>
									<TextField
										label="Result limit parameter"
										value={draft.custom.limit_parameter}
										onChange={(value) => updateCustom("limit_parameter", value)}
									/>
									<TextField
										label="API key header"
										value={draft.custom.api_key_header}
										onChange={(value) => updateCustom("api_key_header", value)}
										placeholder="X-API-Key"
									/>
									<TextField
										label="API key prefix"
										value={draft.custom.api_key_prefix}
										onChange={(value) => updateCustom("api_key_prefix", value)}
										placeholder="Bearer "
									/>
								</div>

								<details className="rounded-md border border-border bg-surface-alt px-3 py-3">
									<summary className="cursor-pointer text-xs font-medium text-text-secondary">
										Response mapping
									</summary>
									<div className="mt-4 grid gap-4 sm:grid-cols-2">
										<TextField
											label="Results array path"
											value={draft.custom.results_path}
											onChange={(value) => updateCustom("results_path", value)}
										/>
										<TextField
											label="Title field path"
											value={draft.custom.title_path}
											onChange={(value) => updateCustom("title_path", value)}
										/>
										<TextField
											label="URL field path"
											value={draft.custom.url_path}
											onChange={(value) => updateCustom("url_path", value)}
										/>
										<TextField
											label="Snippet field path"
											value={draft.custom.snippet_path}
											onChange={(value) => updateCustom("snippet_path", value)}
										/>
									</div>
								</details>
							</section>
						)}
					</div>
				</div>

				<div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-border bg-surface px-5 py-3">
					<button
						type="button"
						onClick={() => void handleTest()}
						disabled={testing || saving}
						className="inline-flex min-h-9 items-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-medium text-text-secondary hover:bg-surface-hover hover:text-text-primary disabled:opacity-50"
					>
						{testing ? (
							<Loader2 className="h-3.5 w-3.5 animate-spin" />
						) : (
							<Search className="h-3.5 w-3.5" />
						)}
						Test connection
					</button>
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

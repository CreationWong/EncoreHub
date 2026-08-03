import {
	Activity,
	AlertCircle,
	ArrowDown,
	ArrowUp,
	Bug,
	CheckCircle2,
	Eye,
	Info,
	KeyRound,
	Loader2,
	Lock,
	LockOpen,
	Plus,
	RefreshCw,
	Save,
	Search,
	Server,
	Trash2,
	XCircle,
} from "lucide-react";
import {
	type FormEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { API_FORMATS } from "../../constants/providers";
import {
	type ProviderEndpoint,
	type ProviderEndpointValidationResult,
	type ProviderKeyValidationResult,
	type ProviderModelConfig,
	type ProviderProfile,
	type ProviderProtocol,
	type ProviderRoutingStrategy,
	providersApi,
} from "../../services/providers";
import {
	modelMetadataForId,
	useModelMetadataStore,
} from "../../stores/modelMetadataStore";
import { useSecretsStore } from "../../stores/secretsStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { toast } from "../../stores/toastStore";
import ProviderDiscoveryReview from "./ProviderDiscoveryReview";
import ProviderKeyPoolEditor from "./ProviderKeyPoolEditor";
import ProviderModelModal from "./ProviderModelModal";
import {
	chatRequestPreview,
	createEndpoint,
	defaultBaseUrl,
	isValidBaseUrl,
	modelDiscoveryPreview,
	normalizeBaseUrl,
	profileEndpoints,
	profileModelConfigs,
} from "./providerConfig";
import {
	type ProviderModelDiscoveryDiff,
	buildProviderModelDiscoveryDiff,
} from "./providerDiscovery";
import {
	MAX_PROVIDER_API_KEYS,
	type ProviderAPIKey,
	normalizeProviderAPIKeys,
	parseProviderAPIKeys,
	providerAPIKeySignature,
	serializeProviderAPIKeys,
} from "./providerKeys";
import {
	type ProviderRuntimeStatus,
	defaultProviderRuntimeStatus,
	isTimeoutError,
	providerRuntimeStatusPresentation,
	statusFromValidation,
	validationResultRuntimeStatus,
} from "./providerRuntimeStatus";

interface DetailProps {
	profile: ProviderProfile;
	isDraft: boolean;
	apiKey: string;
	vaultLocked: boolean;
	keyStored: boolean;
	onSetKey: (value: string) => void;
	onClearKey: () => Promise<void>;
	onSave: (next: ProviderProfile) => Promise<void>;
	onDelete: () => void;
	onOpenDebug?: (matchers: string[]) => void;
	onStatusChange: (providerId: string, status: ProviderRuntimeStatus) => void;
	onDraftControllerChange?: (
		providerId: string,
		controller: ProviderDraftController | null,
	) => void;
}

export interface ProviderDraftController {
	dirty: boolean;
	save: () => Promise<boolean>;
	discard: () => void;
}

interface ProviderDraft {
	protocol: ProviderProtocol;
	enabled: boolean;
	routingStrategy: ProviderRoutingStrategy;
	keyRoutingStrategy: ProviderRoutingStrategy;
	endpoints: ProviderEndpoint[];
	models: ProviderModelConfig[];
}

interface DiscoveryNotice {
	tone: "success" | "warning" | "error";
	text: string;
}

function draftFromProfile(profile: ProviderProfile): ProviderDraft {
	return {
		protocol: profile.protocol,
		enabled: profile.enabled,
		routingStrategy: profile.routing_strategy ?? "failover",
		keyRoutingStrategy: profile.key_routing_strategy ?? "failover",
		endpoints: profileEndpoints(profile),
		models: profileModelConfigs(profile),
	};
}

function draftSignature(draft: ProviderDraft): string {
	return JSON.stringify(draft);
}

function connectionSignature(draft: ProviderDraft): string {
	return JSON.stringify({
		protocol: draft.protocol,
		keyRoutingStrategy: draft.keyRoutingStrategy,
		endpoints: draft.endpoints
			.filter((endpoint) => endpoint.enabled)
			.map((endpoint) => [endpoint.id, normalizeBaseUrl(endpoint.base_url)]),
	});
}

function normalizeModelConfigs(
	models: ProviderModelConfig[],
): ProviderModelConfig[] {
	return models.map((model) => ({
		...model,
		id: model.id.trim(),
		name: model.name?.trim() || model.id.trim(),
		group: model.group?.trim() || "Models",
		capabilities: model.capabilities ?? [],
		currency: model.currency || "USD",
		input_price: Number(model.input_price) || 0,
		output_price: Number(model.output_price) || 0,
		dimensions:
			model.dimensions && model.dimensions > 0 ? model.dimensions : undefined,
		context_window:
			model.context_window && model.context_window > 0
				? Math.trunc(model.context_window)
				: undefined,
	}));
}

function modelConfigSignature(models: ProviderModelConfig[]): string {
	return JSON.stringify(models);
}

export default function ProviderDetail({
	profile,
	isDraft,
	apiKey,
	vaultLocked,
	keyStored,
	onSetKey,
	onClearKey,
	onSave,
	onDelete,
	onOpenDebug,
	onStatusChange,
	onDraftControllerChange,
}: DetailProps) {
	const persistedDraft = useMemo(() => draftFromProfile(profile), [profile]);
	const persistedKeys = useMemo(() => parseProviderAPIKeys(apiKey), [apiKey]);
	const [draft, setDraft] = useState<ProviderDraft>(persistedDraft);
	const [keyDraft, setKeyDraft] = useState<ProviderAPIKey[]>(persistedKeys);
	const [pendingKeyClear, setPendingKeyClear] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [modelSearch, setModelSearch] = useState("");
	const [modelEditor, setModelEditor] = useState<{
		model: ProviderModelConfig | null;
	} | null>(null);
	const [discovering, setDiscovering] = useState(false);
	const [validating, setValidating] = useState(false);
	const [discoveryNotice, setDiscoveryNotice] =
		useState<DiscoveryNotice | null>(null);
	const [validationNotice, setValidationNotice] =
		useState<DiscoveryNotice | null>(null);
	const [discoveryReview, setDiscoveryReview] =
		useState<ProviderModelDiscoveryDiff | null>(null);
	const [keyValidationResults, setKeyValidationResults] = useState<
		Record<string, ProviderKeyValidationResult>
	>({});
	const [endpointValidationResults, setEndpointValidationResults] = useState<
		Record<string, ProviderEndpointValidationResult>
	>({});
	const [connectionRevision, setConnectionRevision] = useState(0);
	const lastDiscoveryRef = useRef<{ keys: string; connection: string } | null>(
		null,
	);
	const lastValidationRef = useRef<{
		keys: string;
		connection: string;
	} | null>(null);
	const validationRequestRef = useRef(0);
	const discoveryRequestRef = useRef(0);
	const pendingModelSaveRef = useRef<string | null>(null);
	const reportStatus = useCallback(
		(status: ProviderRuntimeStatus) => onStatusChange(profile.id, status),
		[onStatusChange, profile.id],
	);

	const unlock = useSecretsStore((state) => state.unlock);
	const loadKeys = useSettingsStore((state) => state.loadKeys);
	const [unlocking, setUnlocking] = useState(false);
	const [password, setPassword] = useState("");
	const [unlockBusy, setUnlockBusy] = useState(false);

	useEffect(() => {
		// A model-only save refreshes the profile too. Reconcile that confirmed model set
		// without replacing unrelated endpoint, routing, or key edits still in the draft.
		if (
			pendingModelSaveRef.current ===
			modelConfigSignature(persistedDraft.models)
		) {
			pendingModelSaveRef.current = null;
			setDraft((current) => ({ ...current, models: persistedDraft.models }));
			return;
		}
		setDraft(persistedDraft);
		setError(null);
		setDiscoveryNotice(null);
		setValidationNotice(null);
		setDiscoveryReview(null);
		setKeyValidationResults({});
		setEndpointValidationResults({});
		setValidating(false);
		setDiscovering(false);
		setConnectionRevision(0);
		validationRequestRef.current += 1;
		discoveryRequestRef.current += 1;
		lastDiscoveryRef.current = null;
		lastValidationRef.current = null;
	}, [persistedDraft]);

	useEffect(() => {
		setKeyDraft(persistedKeys);
		setPendingKeyClear(false);
	}, [persistedKeys]);

	const lockedStored = vaultLocked && keyStored && !pendingKeyClear;
	const profileDirty = draftSignature(draft) !== draftSignature(persistedDraft);
	// A new provider is immediately actionable, while a locked stored key remains
	// authoritative even though its plaintext cannot be compared with the draft.
	const keyDirty =
		pendingKeyClear ||
		(!lockedStored &&
			providerAPIKeySignature(keyDraft) !==
				providerAPIKeySignature(persistedKeys));
	const dirty = isDraft || profileDirty || keyDirty;

	const enabledEndpoints = useMemo(
		() => draft.endpoints.filter((endpoint) => endpoint.enabled),
		[draft.endpoints],
	);
	const enabledKeys = useMemo(
		() => keyDraft.filter((key) => key.enabled && key.value.trim()),
		[keyDraft],
	);
	const keysReadyForDiscovery = useMemo(() => {
		if (keyDraft.length === 0 || enabledKeys.length === 0) return false;
		const normalized = normalizeProviderAPIKeys(keyDraft);
		if (normalized.some((key) => !key.id || !key.value)) return false;
		return (
			new Set(normalized.map((key) => key.id)).size === normalized.length &&
			new Set(normalized.map((key) => key.value)).size === normalized.length
		);
	}, [enabledKeys.length, keyDraft]);
	const endpointsValid =
		draft.endpoints.length > 0 &&
		draft.endpoints.every((endpoint) => isValidBaseUrl(endpoint.base_url));
	const canDiscover =
		!lockedStored &&
		!pendingKeyClear &&
		keysReadyForDiscovery &&
		enabledEndpoints.length > 0 &&
		endpointsValid;
	const canValidate = canDiscover;

	const validationError = useMemo(() => {
		if (!lockedStored) {
			if (keyDraft.length > MAX_PROVIDER_API_KEYS) {
				return `A provider can have at most ${MAX_PROVIDER_API_KEYS} API keys`;
			}
			const normalizedKeys = normalizeProviderAPIKeys(keyDraft);
			if (normalizedKeys.some((key) => !key.id || !key.value)) {
				return "Every API key row needs a key value";
			}
			const keyIds = normalizedKeys.map((key) => key.id);
			if (new Set(keyIds).size !== keyIds.length) {
				return "API key IDs must be unique";
			}
			const keyValues = normalizedKeys.map((key) => key.value);
			if (new Set(keyValues).size !== keyValues.length) {
				return "API key values must be unique";
			}
			if (normalizedKeys.length > 0 && enabledKeys.length === 0) {
				return "Enable at least one API key or remove the key pool";
			}
		}
		if (draft.endpoints.length === 0) return "Add at least one endpoint";
		if (draft.endpoints.length > 16)
			return "A provider can have at most 16 endpoints";
		if (enabledEndpoints.length === 0) return "Enable at least one endpoint";
		if (!endpointsValid) {
			return "Every endpoint must be an absolute HTTP(S) URL without credentials, query, or fragment";
		}
		const urls = draft.endpoints.map((endpoint) =>
			normalizeBaseUrl(endpoint.base_url).toLowerCase(),
		);
		if (new Set(urls).size !== urls.length)
			return "Endpoint URLs must be unique";
		if (draft.models.length === 0) return "Add at least one model";
		const modelIds = draft.models.map((model) => model.id.trim());
		if (modelIds.some((id) => !id)) return "Every model needs an ID";
		if (new Set(modelIds).size !== modelIds.length)
			return "Model IDs must be unique";
		return null;
	}, [
		draft.endpoints,
		draft.models,
		enabledEndpoints.length,
		enabledKeys.length,
		endpointsValid,
		keyDraft,
		lockedStored,
	]);

	const updateConnection = (enabled = draft.enabled) => {
		validationRequestRef.current += 1;
		discoveryRequestRef.current += 1;
		setValidating(false);
		setDiscovering(false);
		setConnectionRevision((revision) => revision + 1);
		setDiscoveryNotice(null);
		setValidationNotice(null);
		setDiscoveryReview(null);
		setKeyValidationResults({});
		setEndpointValidationResults({});
		lastValidationRef.current = null;
		lastDiscoveryRef.current = null;
		reportStatus(enabled ? "waiting" : "disabled");
	};

	const updateKeys = (keys: ProviderAPIKey[], connectionChanged: boolean) => {
		setKeyDraft(keys);
		setPendingKeyClear(
			keyStored && (keys.length === 0 || (vaultLocked && pendingKeyClear)),
		);
		if (connectionChanged) updateConnection();
	};

	const updateEndpoint = (
		index: number,
		patch: Partial<ProviderEndpoint>,
		connectionChanged = false,
	) => {
		setDraft((current) => ({
			...current,
			endpoints: current.endpoints.map((endpoint, endpointIndex) =>
				endpointIndex === index ? { ...endpoint, ...patch } : endpoint,
			),
		}));
		if (connectionChanged) updateConnection();
	};

	const moveEndpoint = (from: number, to: number) => {
		if (to < 0 || to >= draft.endpoints.length) return;
		setDraft((current) => {
			const endpoints = [...current.endpoints];
			const [moved] = endpoints.splice(from, 1);
			endpoints.splice(to, 0, moved);
			return { ...current, endpoints };
		});
	};

	const persistProviderDraft = useCallback(
		async (nextDraft: ProviderDraft) => {
			const normalizedKeys = normalizeProviderAPIKeys(keyDraft);
			const endpoints = nextDraft.endpoints.map((endpoint) => ({
				...endpoint,
				name: endpoint.name?.trim() || endpoint.id,
				base_url: normalizeBaseUrl(endpoint.base_url),
			}));
			const models = normalizeModelConfigs(nextDraft.models);
			const primary =
				endpoints.find((endpoint) => endpoint.enabled) ?? endpoints[0];
			await onSave({
				...profile,
				protocol: nextDraft.protocol,
				base_url: primary.base_url,
				endpoints,
				routing_strategy: nextDraft.routingStrategy,
				key_routing_strategy: nextDraft.keyRoutingStrategy,
				models: models.map((model) => model.id),
				model_configs: models,
				enabled: nextDraft.enabled,
			});

			if (pendingKeyClear) {
				await onClearKey();
			}
			if (
				!pendingKeyClear &&
				!lockedStored &&
				normalizedKeys.length === 0 &&
				keyStored
			) {
				await onClearKey();
			}
			if (!lockedStored && keyDirty && normalizedKeys.length > 0) {
				onSetKey(serializeProviderAPIKeys(normalizedKeys));
			}
			setPendingKeyClear(false);
		},
		[
			keyDirty,
			keyDraft,
			keyStored,
			lockedStored,
			onClearKey,
			onSave,
			onSetKey,
			pendingKeyClear,
			profile,
		],
	);

	const persistProviderModels = useCallback(
		async (nextModels: ProviderModelConfig[]) => {
			// Discovery can persist its model selection independently of the rest of the
			// form, so unfinished connection settings remain local until the main save.
			const models = normalizeModelConfigs(nextModels);
			pendingModelSaveRef.current = modelConfigSignature(models);
			try {
				await onSave({
					...profile,
					models: models.map((model) => model.id),
					model_configs: models,
				});
			} catch (saveError) {
				pendingModelSaveRef.current = null;
				throw saveError;
			}
		},
		[onSave, profile],
	);

	const saveDiscoveredModels = useCallback(
		async (
			diff: ProviderModelDiscoveryDiff,
			nextModels: ProviderModelConfig[],
		) => {
			setSaving(true);
			try {
				const models = normalizeModelConfigs(nextModels);
				if (!isDraft) {
					await persistProviderModels(models);
				}
				setDraft((current) => ({ ...current, models }));
				setDiscoveryReview(null);
				setDiscoveryNotice({
					tone: "success",
					text: isDraft
						? `${models.length} models mapped to this provider draft`
						: `${models.length} models mapped and saved`,
				});
				toast.success(
					isDraft
						? "Discovered models added to the provider draft"
						: "Discovered models mapped and saved",
				);
			} catch {
				setDiscoveryReview(diff);
				setDiscoveryNotice({
					tone: "error",
					text: "Models were found but could not be saved. Review the staged changes and try again.",
				});
				toast.error("Failed to save fetched models");
			} finally {
				setSaving(false);
			}
		},
		[isDraft, persistProviderModels],
	);

	const runValidation = useCallback(async () => {
		if (!canValidate) {
			setValidationNotice({
				tone: "warning",
				text: lockedStored
					? "Unlock the key vault before testing connections"
					: "Enter an API key and valid endpoint before testing connections",
			});
			if (draft.enabled) reportStatus("waiting");
			return;
		}

		lastValidationRef.current = {
			keys: providerAPIKeySignature(keyDraft),
			connection: connectionSignature(draft),
		};
		const requestID = validationRequestRef.current + 1;
		validationRequestRef.current = requestID;
		setValidating(true);
		setValidationNotice(null);
		if (draft.enabled) reportStatus("waiting");
		try {
			const response = await providersApi.validateKey(
				profile.id,
				draft.protocol,
				draft.endpoints,
				serializeProviderAPIKeys(keyDraft),
			);
			if (requestID !== validationRequestRef.current) return;

			setKeyValidationResults(
				Object.fromEntries(
					response.key_results.map((result) => [result.key_id, result]),
				),
			);
			setEndpointValidationResults(
				Object.fromEntries(
					response.endpoint_results.map((result) => [
						result.endpoint_id,
						result,
					]),
				),
			);

			const testedKeys = response.key_results.filter(
				(result) => result.status !== "skipped",
			).length;
			const failedKeys = Math.max(0, testedKeys - response.success_count);
			const reachableEndpoints = response.endpoint_results.filter(
				(result) => result.status === "valid" || result.status === "reachable",
			).length;
			setValidationNotice({
				tone: response.valid
					? failedKeys > 0
						? "warning"
						: "success"
					: "error",
				text: response.valid
					? `${response.success_count} of ${testedKeys} keys valid; ${reachableEndpoints} endpoints reachable`
					: `No key could be validated; ${reachableEndpoints} endpoints responded`,
			});
			if (draft.enabled) reportStatus(statusFromValidation(response));
			if (response.valid) toast.success("Connection test completed");
			else toast.error("Connection test did not validate any key");
		} catch (validationFailure) {
			if (requestID !== validationRequestRef.current) return;
			setValidationNotice({
				tone: "error",
				text: "Connection test failed without changing keys or endpoints",
			});
			if (draft.enabled) {
				reportStatus(isTimeoutError(validationFailure) ? "timeout" : "error");
			}
			toast.error("Connection test failed");
		} finally {
			if (requestID === validationRequestRef.current) setValidating(false);
		}
	}, [
		canValidate,
		draft,
		draft.endpoints,
		draft.protocol,
		keyDraft,
		lockedStored,
		profile.id,
		reportStatus,
	]);

	const runDiscovery = useCallback(
		async (manual: boolean) => {
			if (!canDiscover) {
				if (manual) {
					setDiscoveryNotice({
						tone: "warning",
						text: lockedStored
							? "Unlock the key vault before fetching models"
							: "Enter an API key and valid endpoint before fetching models",
					});
				}
				return;
			}

			const connection = connectionSignature(draft);
			const keys = providerAPIKeySignature(keyDraft);
			lastDiscoveryRef.current = { keys, connection };
			const requestID = discoveryRequestRef.current + 1;
			discoveryRequestRef.current = requestID;
			setDiscovering(true);
			setDiscoveryNotice(null);
			setDiscoveryReview(null);
			try {
				const response = await providersApi.discoverModels(
					profile.id,
					draft.protocol,
					draft.endpoints,
					serializeProviderAPIKeys(keyDraft),
					draft.keyRoutingStrategy,
				);
				// Only the newest request may describe the current draft; slower responses
				// from an earlier endpoint or key revision are deliberately ignored.
				if (requestID !== discoveryRequestRef.current) return;

				const failedResults = response.endpoint_results.filter(
					(result) => result.status === "error",
				);
				const failed = failedResults.length;
				if (!response.discovery_supported) {
					setDiscoveryNotice({
						tone: "warning",
						text: "This provider does not expose model discovery. Add models manually.",
					});
				} else if (
					response.success_count === 0 ||
					response.models.length === 0
				) {
					// Transport success is not discovery success: an empty body or an
					// unrecognized JSON shape cannot supply a usable model list.
					const unsupportedPayload =
						failedResults.length > 0 &&
						failedResults.every(
							(result) => result.error_category === "unsupported_response",
						);
					setDiscoveryNotice({
						tone: "error",
						text: unsupportedPayload
							? "The model endpoint responded successfully, but its response body was empty or not a supported JSON model list. Check the /models route or add models manually."
							: "No endpoint returned a model list. Local models were kept unchanged.",
					});
				} else {
					if (!useModelMetadataStore.getState().loaded) {
						await useModelMetadataStore.getState().load();
					}
					const metadataState = useModelMetadataStore.getState();
					const diff = buildProviderModelDiscoveryDiff(
						draft.models,
						response.models,
						failed === 0,
						(model) => modelMetadataForId(metadataState, model.id),
					);
					if (manual) {
						if (diff.selectionRequired && diff.additions.length > 0) {
							setDiscoveryReview(diff);
							setDiscoveryNotice({
								tone: failed > 0 ? "warning" : "success",
								text: `${response.models.length} models found across ${Math.max(diff.owners.length, 1)} owners. Choose which new models to save.`,
							});
							return;
						}
						await saveDiscoveredModels(diff, diff.nextModels);
						return;
					}
					setDiscoveryReview(diff);
					setDiscoveryNotice({
						tone: failed > 0 ? "warning" : "success",
						text: `${response.models.length} remote models ready for review${
							failed > 0 ? `; ${failed} endpoint failed` : ""
						}`,
					});
				}
			} catch {
				if (requestID !== discoveryRequestRef.current) return;
				setDiscoveryNotice({
					tone: "error",
					text: "Model discovery failed. Local models were kept unchanged.",
				});
			} finally {
				if (requestID === discoveryRequestRef.current) setDiscovering(false);
			}
		},
		[
			canDiscover,
			draft,
			keyDraft,
			lockedStored,
			profile.id,
			saveDiscoveredModels,
		],
	);

	useEffect(() => {
		if (connectionRevision === 0 || !canDiscover) return;
		const connection = connectionSignature(draft);
		const keys = providerAPIKeySignature(keyDraft);
		const timer = window.setTimeout(() => {
			if (
				lastValidationRef.current?.keys !== keys ||
				lastValidationRef.current.connection !== connection
			) {
				void runValidation();
			}
			if (
				lastDiscoveryRef.current?.keys !== keys ||
				lastDiscoveryRef.current.connection !== connection
			) {
				void runDiscovery(false);
			}
		}, 900);
		return () => window.clearTimeout(timer);
	}, [
		canDiscover,
		connectionRevision,
		draft,
		keyDraft,
		runDiscovery,
		runValidation,
	]);

	const submitUnlock = async (event: FormEvent) => {
		event.preventDefault();
		setUnlockBusy(true);
		try {
			await unlock(password);
			await loadKeys();
			setPassword("");
			setUnlocking(false);
			toast.success("Unlocked; API keys are available");
		} catch (unlockError) {
			toast.error(
				unlockError instanceof Error
					? unlockError.message
					: "Incorrect password",
			);
		} finally {
			setUnlockBusy(false);
		}
	};

	const discard = useCallback(() => {
		pendingModelSaveRef.current = null;
		setDraft(persistedDraft);
		setKeyDraft(persistedKeys);
		setPendingKeyClear(false);
		setError(null);
		setDiscoveryNotice(null);
		setValidationNotice(null);
		setDiscoveryReview(null);
		setKeyValidationResults({});
		setEndpointValidationResults({});
		validationRequestRef.current += 1;
		discoveryRequestRef.current += 1;
		setValidating(false);
		setDiscovering(false);
		setConnectionRevision(0);
		lastValidationRef.current = null;
		lastDiscoveryRef.current = null;
		reportStatus(defaultProviderRuntimeStatus(persistedDraft.enabled, isDraft));
	}, [isDraft, persistedDraft, persistedKeys, reportStatus]);

	const handleSave = useCallback(async (): Promise<boolean> => {
		if (validationError) {
			setError(validationError);
			return false;
		}
		setSaving(true);
		setError(null);
		pendingModelSaveRef.current = null;
		try {
			await persistProviderDraft(draft);
			reportStatus(draft.enabled ? "healthy" : "disabled");
			toast.success(`Saved ${profile.name}`);
			return true;
		} catch (saveError) {
			setError(
				saveError instanceof Error
					? saveError.message
					: "Failed to save provider",
			);
			return false;
		} finally {
			setSaving(false);
		}
	}, [
		draft,
		persistProviderDraft,
		profile.name,
		reportStatus,
		validationError,
	]);

	useEffect(() => {
		if (!onDraftControllerChange) return;
		onDraftControllerChange(profile.id, {
			dirty,
			save: handleSave,
			discard,
		});
	}, [dirty, discard, handleSave, onDraftControllerChange, profile.id]);

	useEffect(
		() => () => onDraftControllerChange?.(profile.id, null),
		[onDraftControllerChange, profile.id],
	);

	const filteredModels = useMemo(() => {
		const query = modelSearch.trim().toLowerCase();
		if (!query) return draft.models;
		return draft.models.filter((model) =>
			[model.id, model.name, model.group].some((value) =>
				value?.toLowerCase().includes(query),
			),
		);
	}, [draft.models, modelSearch]);

	const modelGroups = useMemo(() => {
		const groups = new Map<string, ProviderModelConfig[]>();
		for (const model of filteredModels) {
			const group = model.group?.trim() || "Models";
			groups.set(group, [...(groups.get(group) ?? []), model]);
		}
		return [...groups.entries()];
	}, [filteredModels]);

	const selectedFormat =
		API_FORMATS.find((format) => format.value === draft.protocol) ??
		API_FORMATS[0];

	return (
		<div className="flex h-full min-h-0 flex-col bg-surface">
			{modelEditor && (
				<ProviderModelModal
					model={modelEditor.model}
					existingIds={draft.models.map((model) => model.id)}
					protocol={draft.protocol}
					onClose={() => setModelEditor(null)}
					onSave={(model) => {
						const originalId = modelEditor.model?.id;
						setDraft((current) => ({
							...current,
							models: originalId
								? current.models.map((item) =>
										item.id === originalId ? model : item,
									)
								: [...current.models, model],
						}));
						setDiscoveryReview(null);
						setModelEditor(null);
					}}
				/>
			)}

			<header className="flex min-h-16 items-center justify-between gap-3 border-b border-border px-5 py-3 max-[700px]:px-4">
				<div className="min-w-0">
					<div className="flex min-w-0 items-center gap-2">
						<h3 className="truncate text-base font-semibold text-text-primary">
							{profile.name}
						</h3>
						{profile.builtin && (
							<span className="rounded bg-surface-alt px-1.5 py-0.5 text-[10px] uppercase text-text-muted">
								builtin
							</span>
						)}
					</div>
					<p className="truncate text-xs text-text-muted">
						{selectedFormat.label} / {profile.id}
					</p>
				</div>
				<div className="flex shrink-0 items-center gap-2">
					{onOpenDebug && (
						<button
							type="button"
							onClick={() =>
								onOpenDebug([
									...draft.endpoints.map((endpoint) => endpoint.base_url),
									...draft.models.map((model) => model.id),
								])
							}
							aria-label={`Debug ${profile.name}`}
							title="Debug provider"
							className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-accent"
						>
							<Bug className="h-4 w-4" />
						</button>
					)}
					<button
						type="button"
						role="switch"
						aria-checked={draft.enabled}
						aria-label={draft.enabled ? "Disable provider" : "Enable provider"}
						title={draft.enabled ? "Disable provider" : "Enable provider"}
						onClick={() => {
							const enabled = !draft.enabled;
							setDraft((current) => ({ ...current, enabled }));
							updateConnection(enabled);
						}}
						className={`flex h-6 w-11 items-center rounded-full px-0.5 transition-colors ${
							draft.enabled ? "justify-end bg-accent" : "bg-border"
						}`}
					>
						<span className="h-5 w-5 rounded-full bg-white shadow-sm" />
					</button>
					<button
						type="button"
						disabled={profile.builtin}
						onClick={onDelete}
						aria-label={`Delete ${profile.name}`}
						title={
							profile.builtin
								? "Builtin providers cannot be deleted"
								: "Delete provider"
						}
						className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-danger-bg hover:text-danger disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-text-muted"
					>
						<Trash2 className="h-4 w-4" />
					</button>
				</div>
			</header>

			<div className="min-h-0 flex-1 overflow-y-auto">
				<section className="border-b border-border px-5 py-5 max-[700px]:px-4 max-[700px]:py-4">
					<div className="mb-3 flex items-center justify-between gap-3">
						<div>
							<h4 className="text-sm font-semibold text-text-primary">
								API format
							</h4>
							<p className="text-xs text-text-muted">
								One format applies to every endpoint below.
							</p>
						</div>
						<select
							value={draft.protocol}
							onChange={(event) => {
								const protocol = event.target.value as ProviderProtocol;
								setDraft((current) => {
									const previousDefault = defaultBaseUrl(current.protocol);
									return {
										...current,
										protocol,
										endpoints: current.endpoints.map((endpoint) => ({
											...endpoint,
											base_url:
												normalizeBaseUrl(endpoint.base_url) === previousDefault
													? defaultBaseUrl(protocol)
													: endpoint.base_url,
										})),
									};
								});
								updateConnection();
							}}
							aria-label="Provider API format"
							className="max-w-72 rounded-md border border-border bg-surface-alt px-3 py-2 text-sm text-text-primary"
						>
							{API_FORMATS.map((format) => (
								<option key={format.value} value={format.value}>
									{format.label}
								</option>
							))}
						</select>
					</div>
				</section>

				<section className="border-b border-border px-5 py-5 max-[700px]:px-4 max-[700px]:py-4">
					<div className="mb-3 flex flex-wrap items-start justify-between gap-3">
						<div>
							<div className="flex items-center gap-2">
								<KeyRound className="h-4 w-4 text-text-muted" />
								<h4 className="text-sm font-semibold text-text-primary">
									API keys
								</h4>
							</div>
							<p className="mt-1 text-xs text-text-muted">
								Multiple keys must belong to this provider and use the selected
								API format.
							</p>
						</div>
						<div className="flex flex-wrap items-center justify-end gap-2">
							<button
								type="button"
								onClick={() => void runValidation()}
								disabled={validating || !canValidate}
								aria-label="Test API keys and endpoints"
								title={
									canValidate
										? "Test API keys and endpoints"
										: "Enter a key and valid endpoint first"
								}
								className="flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs text-text-secondary hover:bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
							>
								{validating ? (
									<Loader2 className="h-3.5 w-3.5 animate-spin" />
								) : (
									<Activity className="h-3.5 w-3.5" />
								)}
								Test connections
							</button>
							<fieldset
								className="m-0 flex rounded-md border-0 bg-surface-alt p-0.5"
								aria-label="API key routing strategy"
							>
								{(
									[
										["failover", "Failover"],
										["round_robin", "Round-robin"],
									] as const
								).map(([value, label]) => (
									<button
										key={value}
										type="button"
										aria-pressed={draft.keyRoutingStrategy === value}
										onClick={() => {
											setDraft((current) => ({
												...current,
												keyRoutingStrategy: value,
											}));
											updateConnection();
										}}
										className={`rounded px-2.5 py-1.5 text-xs ${
											draft.keyRoutingStrategy === value
												? "bg-surface text-text-primary shadow-sm"
												: "text-text-muted hover:text-text-primary"
										}`}
									>
										{label}
									</button>
								))}
							</fieldset>
						</div>
					</div>
					{lockedStored ? (
						<>
							<p className="mb-2 flex items-start gap-2 text-xs text-text-muted">
								<Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
								An API key pool is encrypted and the vault is locked. Unlock it
								to edit keys or fetch models.
							</p>
							<div className="flex gap-2">
								<div className="flex min-w-0 flex-1 items-center rounded-md border border-border bg-surface-alt px-3 py-2">
									<span className="min-w-0 flex-1 truncate font-mono text-xs text-text-muted">
										****************
									</span>
									<span className="text-[10px] uppercase text-text-muted">
										encrypted
									</span>
								</div>
								<button
									type="button"
									onClick={() => setUnlocking((value) => !value)}
									aria-label="Unlock to edit API keys"
									title="Unlock key pool"
									className="flex h-9 w-9 items-center justify-center rounded-md border border-border text-text-muted hover:bg-surface-hover hover:text-text-primary"
								>
									<Eye className="h-4 w-4" />
								</button>
								<button
									type="button"
									onClick={() => {
										setKeyDraft([]);
										setPendingKeyClear(true);
									}}
									aria-label="Remove stored API key pool on save"
									title="Remove key pool on save"
									className="flex h-9 w-9 items-center justify-center rounded-md border border-border text-text-muted hover:bg-danger-bg hover:text-danger"
								>
									<Trash2 className="h-4 w-4" />
								</button>
							</div>
							{unlocking && (
								<form onSubmit={submitUnlock} className="mt-2 flex gap-2">
									<input
										autoComplete="off"
										type="password"
										value={password}
										onChange={(event) => setPassword(event.target.value)}
										placeholder="Master password"
										// biome-ignore lint/a11y/noAutofocus: reveal prompt should focus immediately
										autoFocus
										className="min-w-0 flex-1 rounded-md border border-border bg-surface-alt px-3 py-2 text-sm text-text-primary"
									/>
									<button
										type="submit"
										disabled={unlockBusy || !password}
										className="flex items-center gap-2 rounded-md bg-accent px-3 text-sm text-white disabled:opacity-40"
									>
										{unlockBusy ? (
											<Loader2 className="h-4 w-4 animate-spin" />
										) : (
											<LockOpen className="h-4 w-4" />
										)}
										Unlock
									</button>
								</form>
							)}
						</>
					) : (
						<>
							{pendingKeyClear && (
								<div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-warning bg-warning-bg px-3 py-2 text-xs text-warning">
									<span>
										The stored key pool will be removed unless a new key is
										added.
									</span>
									<button
										type="button"
										onClick={() => {
											setKeyDraft(persistedKeys);
											setPendingKeyClear(false);
										}}
										className="font-medium underline underline-offset-2"
									>
										Undo
									</button>
								</div>
							)}
							<ProviderKeyPoolEditor
								keys={keyDraft}
								protocol={draft.protocol}
								results={keyValidationResults}
								validating={validating}
								waiting={isDraft || connectionRevision > 0}
								onChange={updateKeys}
							/>
						</>
					)}
					{validationNotice && (
						<p
							aria-live="polite"
							className={`mt-3 flex items-center gap-2 rounded-md px-3 py-2 text-xs ${
								validationNotice.tone === "success"
									? "bg-success-bg text-success"
									: validationNotice.tone === "warning"
										? "bg-warning-bg text-warning"
										: "bg-danger-bg text-danger"
							}`}
						>
							{validationNotice.tone === "success" ? (
								<CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
							) : validationNotice.tone === "warning" ? (
								<AlertCircle className="h-3.5 w-3.5 shrink-0" />
							) : (
								<XCircle className="h-3.5 w-3.5 shrink-0" />
							)}
							{validationNotice.text}
						</p>
					)}
					<p className="mt-3 flex items-center gap-1.5 text-xs text-text-muted">
						<Info className="h-3.5 w-3.5" />
						{draft.keyRoutingStrategy === "failover"
							? "The primary key is used first; backup keys are tried in order when the request cannot be established."
							: "Each request starts with the next enabled key; failures continue through the remaining pool."}
					</p>
				</section>

				<section className="border-b border-border px-5 py-5 max-[700px]:px-4 max-[700px]:py-4">
					<div className="mb-3 flex flex-wrap items-start justify-between gap-3">
						<div>
							<div className="flex items-center gap-2">
								<Server className="h-4 w-4 text-text-muted" />
								<h4 className="text-sm font-semibold text-text-primary">
									API endpoints
								</h4>
							</div>
							<p className="mt-1 max-w-2xl text-xs leading-5 text-text-muted">
								Only different endpoints for the same provider are supported. Do
								not mix suppliers or API formats in one profile.
							</p>
						</div>
						<fieldset
							className="m-0 flex rounded-md border-0 bg-surface-alt p-0.5"
							aria-label="Endpoint routing strategy"
						>
							{(
								[
									["failover", "Failover"],
									["round_robin", "Round-robin"],
								] as const
							).map(([value, label]) => (
								<button
									key={value}
									type="button"
									aria-pressed={draft.routingStrategy === value}
									onClick={() =>
										setDraft((current) => ({
											...current,
											routingStrategy: value,
										}))
									}
									className={`rounded px-2.5 py-1.5 text-xs ${
										draft.routingStrategy === value
											? "bg-surface text-text-primary shadow-sm"
											: "text-text-muted hover:text-text-primary"
									}`}
								>
									{label}
								</button>
							))}
						</fieldset>
					</div>

					<div className="overflow-hidden rounded-md border border-border">
						{draft.endpoints.map((endpoint, index) => {
							const result = endpointValidationResults[endpoint.id];
							const runtimeStatus = validationResultRuntimeStatus(
								endpoint.enabled,
								validating || ((isDraft || connectionRevision > 0) && !result),
								result?.status,
								result?.error_category,
							);
							const statusPresentation =
								providerRuntimeStatusPresentation(runtimeStatus);
							const resultLabel =
								validating && endpoint.enabled
									? "Testing endpoint"
									: result
										? `${result.status.replaceAll("_", " ")}${
												result.error_category
													? `: ${result.error_category.replaceAll("_", " ")}`
													: ""
											}${result.latency_ms ? ` (${result.latency_ms} ms)` : ""}`
										: statusPresentation.label;
							return (
								<div
									key={endpoint.id}
									className="border-b border-border p-3 last:border-b-0"
								>
									<div className="flex items-center gap-2 max-[700px]:flex-wrap">
										<span
											className={`h-2 w-2 shrink-0 rounded-full ${
												statusPresentation.className
											} ${statusPresentation.pulse ? "animate-pulse" : ""}`}
											aria-label={`${endpoint.name || `Endpoint ${index + 1}`}: ${resultLabel}`}
											title={resultLabel}
										/>
										<input
											autoComplete="off"
											value={endpoint.name ?? ""}
											onChange={(event) =>
												updateEndpoint(index, { name: event.target.value })
											}
											aria-label={`Endpoint ${index + 1} name`}
											className="w-28 rounded-md border border-transparent bg-transparent px-2 py-1 text-xs font-medium text-text-secondary hover:border-border focus:border-border max-[700px]:min-w-0 max-[700px]:flex-1"
										/>
										<input
											autoComplete="off"
											value={endpoint.base_url}
											onChange={(event) =>
												updateEndpoint(
													index,
													{ base_url: event.target.value },
													true,
												)
											}
											placeholder={
												profile.builtin
													? defaultBaseUrl(draft.protocol)
													: "https://gateway.example.com"
											}
											aria-label={`Endpoint ${index + 1} URL`}
											className="min-w-0 flex-1 rounded-md border border-border bg-surface-alt px-3 py-2 font-mono text-xs text-text-primary placeholder:text-text-muted max-[700px]:order-last max-[700px]:w-full max-[700px]:flex-none"
										/>
										<button
											type="button"
											role="switch"
											aria-checked={endpoint.enabled}
											aria-label={`${endpoint.enabled ? "Disable" : "Enable"} endpoint ${index + 1}`}
											onClick={() =>
												updateEndpoint(
													index,
													{ enabled: !endpoint.enabled },
													true,
												)
											}
											className={`flex h-5 w-9 shrink-0 items-center rounded-full px-0.5 ${
												endpoint.enabled ? "justify-end bg-accent" : "bg-border"
											}`}
										>
											<span className="h-4 w-4 rounded-full bg-white" />
										</button>
										<button
											type="button"
											onClick={() => moveEndpoint(index, index - 1)}
											disabled={index === 0}
											aria-label={`Move endpoint ${index + 1} up`}
											title="Move up"
											className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-surface-hover disabled:opacity-25"
										>
											<ArrowUp className="h-3.5 w-3.5" />
										</button>
										<button
											type="button"
											onClick={() => moveEndpoint(index, index + 1)}
											disabled={index === draft.endpoints.length - 1}
											aria-label={`Move endpoint ${index + 1} down`}
											title="Move down"
											className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-surface-hover disabled:opacity-25"
										>
											<ArrowDown className="h-3.5 w-3.5" />
										</button>
										<button
											type="button"
											onClick={() => {
												setDraft((current) => ({
													...current,
													endpoints: current.endpoints.filter(
														(_, endpointIndex) => endpointIndex !== index,
													),
												}));
												updateConnection();
											}}
											disabled={draft.endpoints.length === 1}
											aria-label={`Remove endpoint ${index + 1}`}
											title="Remove endpoint"
											className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-danger-bg hover:text-danger disabled:opacity-25"
										>
											<Trash2 className="h-3.5 w-3.5" />
										</button>
									</div>
									{isValidBaseUrl(endpoint.base_url) && (
										<div className="mt-2 flex min-w-0 items-center gap-2 pl-4 text-[11px] text-text-muted max-[700px]:hidden">
											<span className="truncate">
												Chat:{" "}
												{chatRequestPreview(draft.protocol, endpoint.base_url)}
											</span>
											<span className="shrink-0 text-border">|</span>
											<span className="truncate">
												Models:{" "}
												{modelDiscoveryPreview(
													draft.protocol,
													endpoint.base_url,
												)}
											</span>
										</div>
									)}
								</div>
							);
						})}
					</div>
					<div className="mt-3 flex items-center justify-between gap-3 max-[700px]:flex-col max-[700px]:items-start">
						<p className="flex items-center gap-1.5 text-xs text-text-muted">
							<Info className="h-3.5 w-3.5" />
							{draft.routingStrategy === "failover"
								? "Requests use the first endpoint; backups are tried in order on connection failure."
								: "Each request starts at the next endpoint; failures continue through the remaining pool."}
						</p>
						<button
							type="button"
							onClick={() => {
								setDraft((current) => ({
									...current,
									endpoints: [
										...current.endpoints,
										createEndpoint(current.endpoints.length + 1),
									],
								}));
								updateConnection();
							}}
							disabled={draft.endpoints.length >= 16}
							className="flex shrink-0 items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs text-text-secondary hover:bg-surface-hover hover:text-text-primary disabled:opacity-40 max-[700px]:self-end"
						>
							<Plus className="h-3.5 w-3.5" />
							Add endpoint
						</button>
					</div>
				</section>

				<section className="px-5 py-5 max-[700px]:px-4 max-[700px]:py-4">
					<div className="mb-3 flex flex-wrap items-center justify-between gap-3">
						<div>
							<h4 className="text-sm font-semibold text-text-primary">
								Models
							</h4>
							<p className="text-xs text-text-muted">
								Automatic discovery stages a diff for review. Fetch models saves
								only the model list.
							</p>
						</div>
						<div className="flex items-center gap-2">
							<button
								type="button"
								onClick={() => void runDiscovery(true)}
								disabled={discovering || !canDiscover}
								aria-label="Fetch model list"
								title={
									canDiscover
										? "Fetch model list"
										: "Enter a key and valid endpoint first"
								}
								className="flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-xs text-text-secondary hover:bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
							>
								{discovering ? (
									<Loader2 className="h-3.5 w-3.5 animate-spin" />
								) : (
									<RefreshCw className="h-3.5 w-3.5" />
								)}
								Fetch models
							</button>
							<button
								type="button"
								onClick={() => {
									setDiscoveryReview(null);
									setModelEditor({ model: null });
								}}
								className="flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-xs text-text-secondary hover:bg-surface-hover hover:text-text-primary"
							>
								<Plus className="h-3.5 w-3.5" />
								Add model
							</button>
						</div>
					</div>

					{discoveryNotice && (
						<p
							aria-live="polite"
							className={`mb-3 flex items-center gap-2 rounded-md px-3 py-2 text-xs ${
								discoveryNotice.tone === "success"
									? "bg-success-bg text-success"
									: discoveryNotice.tone === "warning"
										? "bg-warning-bg text-warning"
										: "bg-danger-bg text-danger"
							}`}
						>
							{discoveryNotice.tone === "success" ? (
								<CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
							) : discoveryNotice.tone === "warning" ? (
								<AlertCircle className="h-3.5 w-3.5 shrink-0" />
							) : (
								<XCircle className="h-3.5 w-3.5 shrink-0" />
							)}
							{discoveryNotice.text}
						</p>
					)}
					{discoveryReview && (
						<ProviderDiscoveryReview
							diff={discoveryReview}
							onCancel={() => {
								setDiscoveryReview(null);
								setDiscoveryNotice({
									tone: "warning",
									text: "Remote model changes were dismissed. Local models are unchanged.",
								});
							}}
							onApply={(models) =>
								void saveDiscoveredModels(discoveryReview, models)
							}
						/>
					)}

					<div className="relative mb-3">
						<Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
						<input
							autoComplete="off"
							value={modelSearch}
							onChange={(event) => setModelSearch(event.target.value)}
							placeholder="Search models"
							aria-label="Search provider models"
							className="w-full rounded-md border border-border bg-surface-alt py-2 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted"
						/>
					</div>

					<div className="max-h-80 overflow-y-auto rounded-md border border-border">
						{modelGroups.length === 0 ? (
							<p className="px-3 py-8 text-center text-sm text-text-muted">
								No matching models
							</p>
						) : (
							modelGroups.map(([group, models]) => (
								<div
									key={group}
									className="border-b border-border last:border-b-0"
								>
									<div className="bg-surface-alt px-3 py-2 text-xs font-semibold text-text-secondary">
										{group}
									</div>
									{models.map((model) => (
										<div
											key={model.id}
											className="flex min-h-12 items-center gap-3 border-t border-border px-3 py-2 first:border-t-0"
										>
											<button
												type="button"
												onClick={() => setModelEditor({ model })}
												className="min-w-0 flex-1 text-left"
											>
												<span className="block truncate text-sm font-medium text-text-primary">
													{model.name || model.id}
												</span>
												<span className="block truncate font-mono text-[11px] text-text-muted">
													{model.id}
												</span>
											</button>
											<div className="hidden min-w-0 max-w-52 flex-wrap justify-end gap-1 lg:flex">
												{(model.type === "embedding" ||
													model.capabilities?.includes("embedding")) && (
													<span className="rounded bg-fuchsia-500/10 px-1.5 py-0.5 text-[10px] text-fuchsia-600 dark:text-fuchsia-300">
														Embedding only
													</span>
												)}
												{(model.capabilities ?? [])
													.slice(0, 4)
													.map((capability) => (
														<span
															key={capability}
															className="rounded bg-surface-alt px-1.5 py-0.5 text-[10px] capitalize text-text-muted"
														>
															{capability}
														</span>
													))}
											</div>
											<button
												type="button"
												onClick={() => {
													setDraft((current) => ({
														...current,
														models: current.models.filter(
															(item) => item.id !== model.id,
														),
													}));
													setDiscoveryReview(null);
												}}
												aria-label={`Remove model ${model.id}`}
												title="Remove model"
												className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-danger-bg hover:text-danger"
											>
												<Trash2 className="h-3.5 w-3.5" />
											</button>
										</div>
									))}
								</div>
							))
						)}
					</div>
				</section>
			</div>

			{error && (
				<p className="mx-5 mb-3 rounded-md bg-danger-bg px-3 py-2 text-xs text-danger">
					{error}
				</p>
			)}
			<footer className="flex min-h-16 items-center justify-between gap-3 border-t border-border bg-surface px-5 py-3 max-[700px]:justify-end max-[700px]:px-4">
				<p className="min-w-0 truncate text-xs text-text-muted max-[700px]:hidden">
					{validationError ?? (dirty ? "Unsaved changes" : "All changes saved")}
				</p>
				<div className="flex shrink-0 items-center gap-2">
					<button
						type="button"
						onClick={discard}
						disabled={!dirty || saving}
						className="rounded-md border border-border px-3 py-2 text-sm text-text-secondary hover:bg-surface-hover hover:text-text-primary disabled:opacity-35"
					>
						Discard
					</button>
					<button
						type="button"
						onClick={() => void handleSave()}
						disabled={!dirty || saving}
						className="flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
					>
						{saving ? (
							<Loader2 className="h-4 w-4 animate-spin" />
						) : (
							<Save className="h-4 w-4" />
						)}
						{saving
							? "Saving..."
							: isDraft
								? "Create provider"
								: "Save changes"}
					</button>
				</div>
			</footer>
		</div>
	);
}

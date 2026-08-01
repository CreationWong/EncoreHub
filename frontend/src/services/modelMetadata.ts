import { apiFetch } from "./api";
import type {
	DiscoveredModel,
	ProviderModelCapability,
	ProviderModelConfig,
	ProviderModelPrice,
	ProviderModelPricing,
} from "./providers";

export const MODEL_METADATA_SOURCE_URL = "https://models.dev/models.json";
export const MODEL_METADATA_CONFIG_KEY = "model_metadata_catalog";

export type ModelMetadataFormat = "object" | "array";
export type ModelMetadataPreset =
	| "custom"
	| "models-dev"
	| "openai-data"
	| "aimlapi";

export const MODEL_METADATA_FIELDS = [
	"id",
	"name",
	"description",
	"family",
	"ownedBy",
	"capabilities",
	"contextWindow",
	"maxOutputTokens",
	"inputModalities",
	"outputModalities",
	"apiEndpoints",
	"documentationUrl",
	"sourceUrl",
	"pricing",
	"knowledgeCutoff",
	"releaseDate",
	"lastUpdated",
	"reasoning",
	"toolCalling",
	"structuredOutput",
	"attachments",
	"temperature",
] as const;

export type ModelMetadataField = (typeof MODEL_METADATA_FIELDS)[number];
export type ModelMetadataMapping = Partial<Record<ModelMetadataField, string>>;

export interface ModelMetadataProvider {
	id: string;
	name: string;
	url: string;
	enabled: boolean;
	format: ModelMetadataFormat;
	/** Optional dot path to the object/array containing model entries. */
	dataPath?: string;
	preset?: ModelMetadataPreset;
	mapping: ModelMetadataMapping;
}

export interface NormalizedModelMetadata {
	id: string;
	name?: string;
	description?: string;
	family?: string;
	ownedBy?: string;
	capabilities?: string[];
	contextWindow?: number;
	maxOutputTokens?: number;
	inputModalities?: string[];
	outputModalities?: string[];
	apiEndpoints?: string[];
	documentationUrl?: string;
	sourceUrl?: string;
	pricing?: ProviderModelPricing;
	knowledgeCutoff?: string;
	releaseDate?: string;
	lastUpdated?: string;
	reasoning?: boolean;
	toolCalling?: boolean;
	structuredOutput?: boolean;
	attachments?: boolean;
	temperature?: boolean;
}

export interface ModelMetadataFetchResult {
	records: NormalizedModelMetadata[];
	sample: Record<string, unknown> | null;
	count: number;
}

export interface ModelMetadataDatabase {
	version: 1;
	providers: ModelMetadataProvider[];
	records_by_provider: Record<string, NormalizedModelMetadata[]>;
}

export const DEFAULT_MODEL_METADATA_MAPPING: ModelMetadataMapping = {
	id: "id",
	name: "name",
	description: "description",
	family: "family",
	ownedBy: "provider",
	capabilities: "capabilities",
	contextWindow: "limit.context",
	maxOutputTokens: "limit.output",
	inputModalities: "modalities.input",
	outputModalities: "modalities.output",
	knowledgeCutoff: "knowledge",
	releaseDate: "release_date",
	lastUpdated: "last_updated",
	reasoning: "reasoning",
	toolCalling: "tool_call",
	structuredOutput: "structured_output",
	attachments: "attachment",
	temperature: "temperature",
};

const OPENAI_DATA_MAPPING: ModelMetadataMapping = {
	id: "id",
	name: "display_name",
	ownedBy: "owned_by",
	capabilities: "capabilities",
	contextWindow: "context_length",
	inputModalities: "input_modalities",
	outputModalities: "output_modalities",
	pricing: "pricings",
	reasoning: "capabilities.reasoning",
};

const AIMLAPI_MAPPING: ModelMetadataMapping = {
	id: "id",
	name: "info.name",
	description: "info.description",
	family: "info.developer",
	ownedBy: "info.developer",
	capabilities: "features",
	contextWindow: "info.contextLength",
	maxOutputTokens: "info.maxTokens",
	apiEndpoints: "endpoints",
	documentationUrl: "info.docs_url",
	sourceUrl: "info.url",
};

export const DEFAULT_MODEL_METADATA_PROVIDER: ModelMetadataProvider = {
	id: "models-dev",
	name: "models.dev",
	url: MODEL_METADATA_SOURCE_URL,
	enabled: true,
	format: "object",
	dataPath: "",
	preset: "models-dev",
	mapping: { ...DEFAULT_MODEL_METADATA_MAPPING },
};

export const MODEL_METADATA_PRESETS: ReadonlyArray<{
	id: ModelMetadataPreset;
	label: string;
	description: string;
	format: ModelMetadataFormat;
	dataPath: string;
	mapping: ModelMetadataMapping;
}> = [
	{
		id: "custom",
		label: "Custom mapping",
		description: "Choose the collection path and map fields manually.",
		format: "array",
		dataPath: "",
		mapping: { id: "id", name: "name" },
	},
	{
		id: "models-dev",
		label: "models.dev",
		description: "Provider-keyed models.dev catalog.",
		format: "object",
		dataPath: "",
		mapping: DEFAULT_MODEL_METADATA_MAPPING,
	},
	{
		id: "openai-data",
		label: "OpenAI data envelope",
		description:
			"A { data: [...] } response with owner, modalities and pricing.",
		format: "array",
		dataPath: "data",
		mapping: OPENAI_DATA_MAPPING,
	},
	{
		id: "aimlapi",
		label: "AIML-style catalog",
		description: "A bare array with nested info, features and endpoints.",
		format: "array",
		dataPath: "",
		mapping: AIMLAPI_MAPPING,
	},
];

export function applyModelMetadataPreset(
	provider: ModelMetadataProvider,
	preset: ModelMetadataPreset,
): ModelMetadataProvider {
	const config =
		MODEL_METADATA_PRESETS.find((candidate) => candidate.id === preset) ??
		MODEL_METADATA_PRESETS[0];
	return {
		...provider,
		preset,
		format: config.format,
		dataPath: config.dataPath,
		mapping: { ...config.mapping },
	};
}

export const MODEL_METADATA_FIELD_LABELS: Record<ModelMetadataField, string> = {
	id: "Model ID",
	name: "Name",
	description: "Description",
	family: "Family",
	ownedBy: "Owned by",
	capabilities: "Capabilities",
	contextWindow: "Context window",
	maxOutputTokens: "Max output tokens",
	inputModalities: "Input modalities",
	outputModalities: "Output modalities",
	apiEndpoints: "API endpoints",
	documentationUrl: "Documentation URL",
	sourceUrl: "Source URL",
	pricing: "Pricing",
	knowledgeCutoff: "Knowledge cutoff",
	releaseDate: "Release date",
	lastUpdated: "Last updated",
	reasoning: "Reasoning",
	toolCalling: "Tool calling",
	structuredOutput: "Structured output",
	attachments: "Attachments",
	temperature: "Temperature",
};

const FIELD_ALIASES: Record<ModelMetadataField, string[]> = {
	id: ["id", "model", "model_id", "slug", "key"],
	name: ["name", "display_name", "displayName", "label", "title", "info.name"],
	description: ["description", "summary", "details", "info.description"],
	family: ["family", "model_family", "architecture", "info.developer"],
	ownedBy: ["owned_by", "ownedBy", "provider", "developer", "info.developer"],
	capabilities: ["capabilities", "features", "supported_features"],
	contextWindow: [
		"context_window",
		"context_length",
		"max_context_tokens",
		"limit.context",
		"info.contextLength",
	],
	maxOutputTokens: [
		"max_output_tokens",
		"output_limit",
		"limit.output",
		"info.maxTokens",
	],
	inputModalities: ["input_modalities", "modalities.input", "input"],
	outputModalities: ["output_modalities", "modalities.output", "output"],
	apiEndpoints: ["endpoints", "api_endpoints"],
	documentationUrl: ["docs_url", "documentation_url", "info.docs_url"],
	sourceUrl: ["url", "source_url", "info.url"],
	pricing: ["pricings", "pricing", "prices"],
	knowledgeCutoff: ["knowledge_cutoff", "knowledge", "training_cutoff"],
	releaseDate: ["release_date", "released", "releaseDate"],
	lastUpdated: ["last_updated", "updated_at", "lastUpdated"],
	reasoning: ["reasoning", "supports_reasoning", "capabilities.reasoning"],
	toolCalling: ["tool_call", "tool_calling", "tools", "supports_tools"],
	structuredOutput: ["structured_output", "json_mode", "supports_json"],
	attachments: ["attachment", "attachments", "vision", "supports_vision"],
	temperature: ["temperature", "supports_temperature"],
};

function pathParts(path: string): string[] {
	return path
		.trim()
		.replace(/\[(\d+)\]/g, ".$1")
		.split(".")
		.map((part) => part.trim())
		.filter(Boolean);
}

export function readMetadataPath(value: unknown, path: string): unknown {
	if (!path.trim()) return undefined;
	return pathParts(path).reduce<unknown>((current, part) => {
		if (current === null || current === undefined) return undefined;
		if (typeof current !== "object") return undefined;
		return (current as Record<string, unknown>)[part];
	}, value);
}

function firstPath(value: Record<string, unknown>, paths: string[]): string {
	return (
		paths.find((path) => readMetadataPath(value, path) !== undefined) ?? ""
	);
}

export function inferMetadataMapping(
	sample: Record<string, unknown> | null,
): ModelMetadataMapping {
	if (!sample) return {};
	const mapping: ModelMetadataMapping = {};
	for (const field of MODEL_METADATA_FIELDS) {
		const path = firstPath(sample, FIELD_ALIASES[field]);
		if (path) mapping[field] = path;
	}
	return mapping;
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim()) {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	return undefined;
}

function booleanValue(value: unknown): boolean | undefined {
	return typeof value === "boolean" ? value : undefined;
}

function stringArrayValue(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const values = value
		.filter((item): item is string => typeof item === "string")
		.map((item) => item.trim())
		.filter(Boolean);
	return values.length > 0 ? values : undefined;
}

function capabilitiesValue(value: unknown): string[] | undefined {
	const direct = stringArrayValue(value);
	if (direct) return direct;
	if (!value || typeof value !== "object" || Array.isArray(value))
		return undefined;
	const enabled = Object.entries(value)
		.filter(([, state]) => state === true)
		.map(([name]) => name);
	return enabled.length > 0 ? enabled : undefined;
}

function priceConditionValue(
	value: unknown,
): ProviderModelPrice["conditions"] | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value))
		return undefined;
	const conditions: NonNullable<ProviderModelPrice["conditions"]> = {};
	for (const [name, raw] of Object.entries(value)) {
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
		const condition = raw as Record<string, unknown>;
		conditions[name] = {
			unit: stringValue(condition.unit),
			gte: numberValue(condition.gte),
			lt: numberValue(condition.lt),
		};
	}
	return Object.keys(conditions).length > 0 ? conditions : undefined;
}

function pricingValue(value: unknown): ProviderModelPricing | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value))
		return undefined;
	const pricing: ProviderModelPricing = {};
	for (const [kind, rawTiers] of Object.entries(value)) {
		const tiers = Array.isArray(rawTiers) ? rawTiers : [rawTiers];
		const normalized = tiers.flatMap((raw): ProviderModelPrice[] => {
			if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
			const tier = raw as Record<string, unknown>;
			const amount = numberValue(tier.value);
			if (amount === undefined) return [];
			return [
				{
					value: amount,
					unit: stringValue(tier.unit),
					currency: stringValue(tier.currency),
					conditions: priceConditionValue(tier.conditions),
				},
			];
		});
		if (normalized.length > 0) pricing[kind] = normalized;
	}
	return Object.keys(pricing).length > 0 ? pricing : undefined;
}

export function normalizeModelMetadata(
	raw: Record<string, unknown>,
	mapping: ModelMetadataMapping,
	key?: string,
): NormalizedModelMetadata | null {
	const read = (field: ModelMetadataField) =>
		readMetadataPath(raw, mapping[field] ?? "");
	const id = stringValue(read("id")) ?? key?.trim();
	if (!id) return null;
	const reasoning = booleanValue(read("reasoning"));
	const toolCalling = booleanValue(read("toolCalling"));
	const structuredOutput = booleanValue(read("structuredOutput"));
	const attachments = booleanValue(read("attachments"));
	const derivedCapabilities = [
		reasoning ? "reasoning" : null,
		toolCalling ? "tools" : null,
		structuredOutput ? "structured_output" : null,
		attachments ? "vision" : null,
	].filter((value): value is string => value !== null);
	const capabilities =
		capabilitiesValue(read("capabilities")) ??
		(derivedCapabilities.length > 0 ? derivedCapabilities : undefined);
	return {
		id,
		name: stringValue(read("name")),
		description: stringValue(read("description")),
		family: stringValue(read("family")),
		ownedBy: stringValue(read("ownedBy")),
		capabilities,
		contextWindow: numberValue(read("contextWindow")),
		maxOutputTokens: numberValue(read("maxOutputTokens")),
		inputModalities: stringArrayValue(read("inputModalities")),
		outputModalities: stringArrayValue(read("outputModalities")),
		apiEndpoints: stringArrayValue(read("apiEndpoints")),
		documentationUrl: stringValue(read("documentationUrl")),
		sourceUrl: stringValue(read("sourceUrl")),
		pricing: pricingValue(read("pricing")),
		knowledgeCutoff: stringValue(read("knowledgeCutoff")),
		releaseDate: stringValue(read("releaseDate")),
		lastUpdated: stringValue(read("lastUpdated")),
		reasoning,
		toolCalling,
		structuredOutput,
		attachments,
		temperature: booleanValue(read("temperature")),
	};
}

export function parseModelMetadata(
	payload: unknown,
	provider: Pick<ModelMetadataProvider, "format" | "mapping" | "dataPath">,
): ModelMetadataFetchResult {
	const collection = provider.dataPath?.trim()
		? readMetadataPath(payload, provider.dataPath)
		: payload;
	const entries: Array<[string | undefined, Record<string, unknown>]> = [];
	if (provider.format === "array" && Array.isArray(collection)) {
		for (const item of collection) {
			if (item && typeof item === "object" && !Array.isArray(item)) {
				entries.push([undefined, item as Record<string, unknown>]);
			}
		}
	} else if (
		provider.format === "object" &&
		collection &&
		typeof collection === "object" &&
		!Array.isArray(collection)
	) {
		for (const [key, item] of Object.entries(collection)) {
			if (item && typeof item === "object" && !Array.isArray(item)) {
				entries.push([key, item as Record<string, unknown>]);
			}
		}
	}
	const records = entries.flatMap(([key, raw]) => {
		const record = normalizeModelMetadata(raw, provider.mapping, key);
		return record ? [record] : [];
	});
	return {
		records,
		sample: entries[0]?.[1] ?? null,
		count: records.length,
	};
}

export async function fetchModelMetadata(
	provider: Pick<
		ModelMetadataProvider,
		"url" | "format" | "mapping" | "dataPath"
	>,
	signal?: AbortSignal,
): Promise<ModelMetadataFetchResult> {
	const response = await fetch(provider.url, { signal });
	if (!response.ok) {
		throw new Error(`Metadata request failed (${response.status})`);
	}
	return parseModelMetadata(await response.json(), provider);
}

export const modelMetadataApi = {
	load(): Promise<ModelMetadataDatabase | null> {
		return apiFetch<ModelMetadataDatabase | null>(
			`/config/${MODEL_METADATA_CONFIG_KEY}`,
		);
	},
	save(database: ModelMetadataDatabase): Promise<void> {
		return apiFetch<void>(`/config/${MODEL_METADATA_CONFIG_KEY}`, {
			method: "PUT",
			body: JSON.stringify(database),
		});
	},
};

const METADATA_MANAGED_CAPABILITIES = new Set<ProviderModelCapability>([
	"vision",
	"reasoning",
	"tools",
]);

function capabilityMatches(capabilities: Set<string>, needle: string): boolean {
	return [...capabilities].some((capability) =>
		capability.toLowerCase().includes(needle),
	);
}

function firstPrice(
	pricing: ProviderModelPricing | undefined,
	kind: string,
): ProviderModelPrice | undefined {
	return pricing?.[kind]?.[0];
}

/** Apply authoritative metadata while preserving capabilities the catalog does not model. */
export function applyMetadataToModelConfig(
	model: ProviderModelConfig,
	metadata: NormalizedModelMetadata,
): ProviderModelConfig {
	const capabilities = new Set(
		(model.capabilities ?? []).filter(
			(capability) => !METADATA_MANAGED_CAPABILITIES.has(capability),
		),
	);
	const sourceCapabilities = new Set(metadata.capabilities ?? []);
	if (
		metadata.attachments ||
		metadata.inputModalities?.some((modality) =>
			["image", "video", "pdf", "file"].includes(modality.toLowerCase()),
		) ||
		capabilityMatches(sourceCapabilities, "vision") ||
		capabilityMatches(sourceCapabilities, "image")
	) {
		capabilities.add("vision");
	}
	if (
		metadata.reasoning ||
		capabilityMatches(sourceCapabilities, "reasoning")
	) {
		capabilities.add("reasoning");
	}
	if (
		metadata.toolCalling ||
		capabilityMatches(sourceCapabilities, "function") ||
		capabilityMatches(sourceCapabilities, "tool")
	) {
		capabilities.add("tools");
	}
	const promptPrice = firstPrice(metadata.pricing, "prompt");
	const completionPrice = firstPrice(metadata.pricing, "completion");
	const name =
		!model.name || model.name === model.id
			? (metadata.name ?? model.name)
			: model.name;
	const group =
		!model.group || model.group === "Models" || model.group === "Discovered"
			? (metadata.family ?? metadata.ownedBy ?? model.group)
			: model.group;
	return {
		...model,
		name,
		description: metadata.description ?? model.description,
		group,
		owned_by: metadata.ownedBy ?? model.owned_by,
		capabilities: [...capabilities],
		context_window: metadata.contextWindow ?? model.context_window,
		max_output_tokens: metadata.maxOutputTokens ?? model.max_output_tokens,
		input_modalities: metadata.inputModalities ?? model.input_modalities,
		output_modalities: metadata.outputModalities ?? model.output_modalities,
		api_endpoints: metadata.apiEndpoints ?? model.api_endpoints,
		documentation_url: metadata.documentationUrl ?? model.documentation_url,
		source_url: metadata.sourceUrl ?? model.source_url,
		pricing: metadata.pricing ?? model.pricing,
		currency:
			promptPrice?.currency ?? completionPrice?.currency ?? model.currency,
		input_price: promptPrice?.value ?? model.input_price,
		output_price: completionPrice?.value ?? model.output_price,
	};
}

export function discoveredModelMetadata(
	model: DiscoveredModel,
): NormalizedModelMetadata {
	return {
		id: model.id,
		name: model.name,
		description: model.description,
		ownedBy: model.owned_by,
		capabilities: model.capabilities,
		contextWindow: model.context_limit,
		maxOutputTokens: model.max_output_tokens,
		inputModalities: model.input_modalities,
		outputModalities: model.output_modalities,
		apiEndpoints: model.api_endpoints,
		documentationUrl: model.documentation_url,
		sourceUrl: model.source_url,
		pricing: model.pricing,
	};
}

export const MODEL_METADATA_SOURCE_URL = "https://models.dev/models.json";

export type ModelMetadataFormat = "object" | "array";

export const MODEL_METADATA_FIELDS = [
	"id",
	"name",
	"description",
	"family",
	"capabilities",
	"contextWindow",
	"maxOutputTokens",
	"inputModalities",
	"outputModalities",
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
	mapping: ModelMetadataMapping;
}

export interface NormalizedModelMetadata {
	id: string;
	name?: string;
	description?: string;
	family?: string;
	capabilities?: string[];
	contextWindow?: number;
	maxOutputTokens?: number;
	inputModalities?: string[];
	outputModalities?: string[];
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

export const DEFAULT_MODEL_METADATA_MAPPING: ModelMetadataMapping = {
	id: "id",
	name: "name",
	description: "description",
	family: "family",
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

export const DEFAULT_MODEL_METADATA_PROVIDER: ModelMetadataProvider = {
	id: "models-dev",
	name: "models.dev",
	url: MODEL_METADATA_SOURCE_URL,
	enabled: true,
	format: "object",
	mapping: { ...DEFAULT_MODEL_METADATA_MAPPING },
};

export const MODEL_METADATA_FIELD_LABELS: Record<ModelMetadataField, string> = {
	id: "Model ID",
	name: "Name",
	description: "Description",
	family: "Family",
	capabilities: "Capabilities",
	contextWindow: "Context window",
	maxOutputTokens: "Max output tokens",
	inputModalities: "Input modalities",
	outputModalities: "Output modalities",
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
	name: ["name", "display_name", "label", "title"],
	description: ["description", "summary", "details"],
	family: ["family", "model_family", "architecture"],
	capabilities: ["capabilities", "features", "supported_features"],
	contextWindow: [
		"context_window",
		"context_length",
		"max_context_tokens",
		"limit.context",
	],
	maxOutputTokens: ["max_output_tokens", "output_limit", "limit.output"],
	inputModalities: ["input_modalities", "modalities.input", "input"],
	outputModalities: ["output_modalities", "modalities.output", "output"],
	knowledgeCutoff: ["knowledge_cutoff", "knowledge", "training_cutoff"],
	releaseDate: ["release_date", "released", "releaseDate"],
	lastUpdated: ["last_updated", "updated_at", "lastUpdated"],
	reasoning: ["reasoning", "supports_reasoning"],
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
	const values = value.filter(
		(item): item is string => typeof item === "string",
	);
	return values.length > 0 ? values : undefined;
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
	// Some catalogs expose capability flags instead of a shared array.
	const derivedCapabilities = [
		reasoning ? "reasoning" : null,
		toolCalling ? "tools" : null,
		structuredOutput ? "structured_output" : null,
		attachments ? "vision" : null,
	].filter((value): value is string => value !== null);
	const capabilities =
		stringArrayValue(read("capabilities")) ??
		(derivedCapabilities.length > 0 ? derivedCapabilities : undefined);
	return {
		id,
		name: stringValue(read("name")),
		description: stringValue(read("description")),
		family: stringValue(read("family")),
		capabilities,
		contextWindow: numberValue(read("contextWindow")),
		maxOutputTokens: numberValue(read("maxOutputTokens")),
		inputModalities: stringArrayValue(read("inputModalities")),
		outputModalities: stringArrayValue(read("outputModalities")),
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
	provider: Pick<ModelMetadataProvider, "format" | "mapping">,
): ModelMetadataFetchResult {
	const entries: Array<[string | undefined, Record<string, unknown>]> = [];
	if (provider.format === "array" && Array.isArray(payload)) {
		for (const item of payload) {
			if (item && typeof item === "object" && !Array.isArray(item)) {
				entries.push([undefined, item as Record<string, unknown>]);
			}
		}
	} else if (
		provider.format === "object" &&
		payload &&
		typeof payload === "object"
	) {
		for (const [key, item] of Object.entries(payload)) {
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
	provider: Pick<ModelMetadataProvider, "url" | "format" | "mapping">,
	signal?: AbortSignal,
): Promise<ModelMetadataFetchResult> {
	const response = await fetch(provider.url, { signal });
	if (!response.ok)
		throw new Error(`Metadata request failed (${response.status})`);
	return parseModelMetadata(await response.json(), provider);
}

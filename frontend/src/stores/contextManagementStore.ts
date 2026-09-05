// Context management store.
//
// Owns the user-visible context meter: per-message token estimation, provider
// snapshot reconciliation, auto/manual compaction, advanced sampling
// parameters, and usage/cost records. Token estimates are produced by the
// small linear model in `services/tokenModel` and validated against the
// provider-reported snapshot after each completed turn.

import { create } from "zustand";
import type { CharacterSnapshot } from "../services/characters";
import type { Message } from "../services/conversation";
import type {
	ProviderModelConfig,
	ProviderModelPrice,
} from "../services/providers";
import {
	DEFAULT_COEFFICIENTS,
	DEFAULT_OUTPUT_COEFFICIENTS,
	type TokenCoefficients,
	type TokenFeatures,
	type TokenTextStats,
	addTextStats,
	countTextStats,
	loadModel,
	recordOutputSample,
	recordSample,
	splitOutputTokens,
} from "../services/tokenModel";

export interface UsageRecord {
	id: string;
	conversationId: string;
	conversationTitle: string;
	provider: string;
	model: string;
	inputTokens: number;
	outputTokens: number;
	durationMs: number;
	cost: number | null;
	currency: string;
	status: "completed" | "failed" | "stopped";
	createdAt: string;
}

export interface AdvancedParameters {
	temperature: number;
	topP: number;
	maxCompletionTokens: number;
	seed: string;
	stopSequences: string;
	frequencyPenalty: number;
	presencePenalty: number;
	logprobs: boolean;
	topLogprobs: number;
	responseFormat: "text" | "json_object";
}

export interface CompactionState {
	summary: string;
	keepRecent: number;
	sourceTokens: number;
	createdAt: string;
}

export interface ContextBreakdown {
	usedTokens: number;
	contextTokens: number;
	limit: number | null;
	percentage: number | null;
	freeTokens: number | null;
	reservedTokens: number;
	source: "provider" | "estimated";
	snapshotInputTokens: number | null;
	snapshotOutputTokens: number | null;
	categories: {
		system: number;
		tools: number;
		skills: number;
		messages: number;
		other: number;
	};
	/** Calibration metadata of the token model backing this estimate. */
	modelSamples: number;
	modelTrusted: boolean;
	outputModelSamples: number;
	outputModelTrusted: boolean;
}

export const DEFAULT_ADVANCED_PARAMETERS: AdvancedParameters = {
	temperature: 0.7,
	topP: 1,
	maxCompletionTokens: 4096,
	seed: "",
	stopSequences: "",
	frequencyPenalty: 0,
	presencePenalty: 0,
	logprobs: false,
	topLogprobs: 0,
	responseFormat: "text",
};

const USAGE_STORAGE_KEY = "encorehub-usage-records";
const PARAMETERS_STORAGE_KEY = "encorehub-advanced-parameters";
const AUTO_COMPACT_STORAGE_KEY = "encorehub-auto-compact-context";
const MAX_USAGE_RECORDS = 500;
const MAX_COMPACTION_OUTPUT_RESERVE = 20_000;
const AUTO_COMPACT_BUFFER_TOKENS = 13_000;
export const MANUAL_COMPACT_BUFFER_TOKENS = 3_000;

export function autoCompactReserve(maxCompletionTokens: number): number {
	// Claude Code reserves bounded summary output plus a fixed safety margin;
	// this stays stable across 200K and 1M context windows unlike a percentage.
	return (
		Math.min(Math.max(0, maxCompletionTokens), MAX_COMPACTION_OUTPUT_RESERVE) +
		AUTO_COMPACT_BUFFER_TOKENS
	);
}

export function autoCompactThreshold(
	limit: number,
	maxCompletionTokens: number,
): number {
	return Math.max(0, limit - autoCompactReserve(maxCompletionTokens));
}

function readJson<T>(key: string, fallback: T): T {
	if (typeof window === "undefined") return fallback;
	try {
		const raw = localStorage.getItem(key);
		return raw ? (JSON.parse(raw) as T) : fallback;
	} catch {
		return fallback;
	}
}

function persistJson(key: string, value: unknown): void {
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {
		/* Storage is optional in restricted webviews. */
	}
}

export function estimateTokens(text: string): number {
	const normalized = text.trim();
	if (!normalized) return 0;
	// ASCII prose averages roughly four bytes per token, while CJK and other
	// non-ASCII scripts are conservatively treated as one token per code point.
	let asciiBytes = 0;
	let nonAsciiCodePoints = 0;
	for (const codePoint of normalized) {
		if ((codePoint.codePointAt(0) ?? 0) <= 0x7f) asciiBytes += 1;
		else nonAsciiCodePoints += 1;
	}
	return Math.max(1, Math.ceil(asciiBytes / 4) + nonAsciiCodePoints);
}

type ContextCategories = ContextBreakdown["categories"];

/** Extra data the frontend can observe to mirror the gateway's system prompt. */
export interface SystemContextEstimate {
	character?: CharacterSnapshot;
	modelKey?: string;
	now?: Date;
}

function emptyCategories(): ContextCategories {
	return { system: 0, tools: 0, skills: 0, messages: 0, other: 0 };
}

function categoryTotal(categories: ContextCategories): number {
	return Object.values(categories).reduce((sum, value) => sum + value, 0);
}

/** Text features of one message's tool calls (name + arguments + result). */
function toolPayloadStats(toolCalls: Message["tool_calls"]): TokenTextStats {
	let stats: TokenTextStats = { asciiBytes: 0, nonAsciiChars: 0 };
	for (const call of toolCalls) {
		stats = addTextStats(
			stats,
			countTextStats(`${call.name}${call.arguments}${call.result ?? ""}`),
		);
	}
	return stats;
}

function toolPayloadTokens(
	toolCalls: Message["tool_calls"],
	coeffs: TokenCoefficients,
): number {
	const stats = toolPayloadStats(toolCalls);
	return Math.max(
		0,
		Math.round(
			coeffs.asciiPerByte * stats.asciiBytes +
				coeffs.nonAsciiPerChar * stats.nonAsciiChars,
		),
	);
}

/** Mirror the gateway's character prompt section (name/description/instructions). */
function characterPromptText(snapshot: CharacterSnapshot | undefined): string {
	if (!snapshot) return "";
	const parts: string[] = [];
	if (snapshot.name.trim()) parts.push(`Name: ${snapshot.name}`);
	if (snapshot.description.trim())
		parts.push(`Description:\n${snapshot.description}`);
	if (snapshot.system_prompt.trim())
		parts.push(`Character instructions:\n${snapshot.system_prompt}`);
	return parts.join("\n\n");
}

/**
 * Mirror the gateway's date/time/timezone context section. UTC is used as a
 * fixed-width approximation: the real zone name differs by only a few bytes,
 * and that constant bias is absorbed by the fitted model intercept.
 */
function timeContextText(now: Date): string {
	const date = now.toISOString().slice(0, 10);
	const time = now.toISOString().slice(11, 19);
	return `Current date: ${date}\nCurrent time: ${time}\nTime zone: UTC`;
}

/**
 * Assemble the observable system-prompt text. The base prompt, application
 * constraints, and tool instructions are gateway constants the frontend never
 * sees, so they are left for the model's intercept to absorb.
 */
function composeSystemPromptText(
	character: CharacterSnapshot | undefined,
	now: Date,
	compactionSummary: string | undefined,
): string {
	const parts = [characterPromptText(character), timeContextText(now)];
	if (compactionSummary) parts.push(compactionSummary);
	return parts.filter(Boolean).join("\n\n");
}

interface UsageFeatureSet {
	aggregate: TokenFeatures;
	system: TokenTextStats;
	messages: TokenTextStats;
	tools: TokenTextStats;
	messageCount: number;
}

function buildUsageFeatures(
	messages: Message[],
	systemText: string,
): UsageFeatureSet {
	const system = countTextStats(systemText);
	let messagesStats: TokenTextStats = { asciiBytes: 0, nonAsciiChars: 0 };
	let tools: TokenTextStats = { asciiBytes: 0, nonAsciiChars: 0 };
	for (const message of messages) {
		// Reasoning never re-enters provider input between rounds, so it must
		// not count toward retained context occupancy.
		messagesStats = addTextStats(
			messagesStats,
			countTextStats(message.content),
		);
		tools = addTextStats(tools, toolPayloadStats(message.tool_calls));
	}
	const aggregate: TokenFeatures = {
		asciiBytes: system.asciiBytes + messagesStats.asciiBytes + tools.asciiBytes,
		nonAsciiChars:
			system.nonAsciiChars + messagesStats.nonAsciiChars + tools.nonAsciiChars,
		messageCount: messages.length,
	};
	return {
		aggregate,
		system,
		messages: messagesStats,
		tools,
		messageCount: messages.length,
	};
}

/** Split a feature set into the four display categories using one coefficient set. */
function categoriesFromFeatures(
	features: UsageFeatureSet,
	coeffs: TokenCoefficients,
): ContextCategories {
	return {
		system: Math.max(
			0,
			Math.round(
				coeffs.intercept +
					coeffs.asciiPerByte * features.system.asciiBytes +
					coeffs.nonAsciiPerChar * features.system.nonAsciiChars,
			),
		),
		tools: Math.max(
			0,
			Math.round(
				coeffs.asciiPerByte * features.tools.asciiBytes +
					coeffs.nonAsciiPerChar * features.tools.nonAsciiChars,
			),
		),
		// Skill instruction bodies are still an empty contract in the gateway,
		// so no skill text exists to attribute.
		skills: 0,
		messages: Math.max(
			0,
			Math.round(
				coeffs.asciiPerByte * features.messages.asciiBytes +
					coeffs.nonAsciiPerChar * features.messages.nonAsciiChars +
					coeffs.perMessage * features.messageCount,
			),
		),
		other: 0,
	};
}

function reconcileSnapshotCategories(
	estimated: ContextCategories,
	snapshotTokens: number,
): ContextCategories {
	const estimatedTotal = categoryTotal(estimated);
	if (estimatedTotal <= snapshotTokens) {
		return { ...estimated, other: snapshotTokens - estimatedTotal };
	}
	if (estimatedTotal === 0) return { ...estimated, other: snapshotTokens };

	// Provider tokenization is authoritative. Scale rough category estimates
	// down when they exceed the measured snapshot so the rows still sum exactly.
	const scale = snapshotTokens / estimatedTotal;
	const reconciled = emptyCategories();
	for (const key of ["system", "tools", "skills", "messages"] as const) {
		reconciled[key] = Math.floor(estimated[key] * scale);
	}
	reconciled.other = snapshotTokens - categoryTotal(reconciled);
	return reconciled;
}

function latestContextSnapshotIndex(messages: Message[]): number {
	// ES2021 desktop targets do not expose Array.findLastIndex, so scan from
	// the tail while preserving the same newest-snapshot semantics.
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (
			message.role === "assistant" &&
			Number.isFinite(message.context_input_tokens) &&
			Number.isFinite(message.context_output_tokens) &&
			(message.context_input_tokens ?? -1) >= 0 &&
			(message.context_output_tokens ?? -1) >= 0
		) {
			return index;
		}
	}
	return -1;
}

export function estimateContextUsage(
	messages: Message[],
	limit: number | undefined,
	compaction?: CompactionState,
	reservedTokens = 0,
	systemContext?: SystemContextEstimate,
): ContextBreakdown {
	const model = systemContext?.modelKey
		? loadModel(systemContext.modelKey)
		: {
				coeffs: DEFAULT_COEFFICIENTS,
				sampleCount: 0,
				trusted: false,
				outputCoeffs: DEFAULT_OUTPUT_COEFFICIENTS,
				outputSampleCount: 0,
				outputTrusted: false,
			};
	const coeffs = model.coeffs;
	const outputCoeffs = model.outputCoeffs;

	// A local compaction created after the latest response changes the next
	// provider request, so the earlier provider snapshot is no longer applicable.
	const latestSnapshotIndex = latestContextSnapshotIndex(messages);
	const snapshotMessage =
		latestSnapshotIndex >= 0 ? messages[latestSnapshotIndex] : undefined;
	const compactionAfterSnapshot = Boolean(
		compaction?.summary &&
			snapshotMessage &&
			Date.parse(compaction.createdAt) > Date.parse(snapshotMessage.created_at),
	);

	const activeMessages = compaction?.summary
		? compaction.keepRecent > 0
			? messages.slice(-compaction.keepRecent)
			: []
		: messages;

	const now = systemContext?.now ?? new Date();
	const systemText = composeSystemPromptText(
		systemContext?.character,
		now,
		compaction?.summary,
	);

	let source: ContextBreakdown["source"] = "estimated";
	let snapshotInputTokens: number | null = null;
	let snapshotOutputTokens: number | null = null;
	let usedTokens: number;
	let contextTokens: number;
	let categories: ContextCategories;
	if (snapshotMessage && !compactionAfterSnapshot) {
		source = "provider";
		snapshotInputTokens = Math.trunc(snapshotMessage.context_input_tokens ?? 0);
		snapshotOutputTokens = Math.trunc(
			snapshotMessage.context_output_tokens ?? 0,
		);
		// Provider input usage covers every message before the assistant reply,
		// while that reply's output becomes input only on the following round.
		const covered = categoriesFromFeatures(
			buildUsageFeatures(messages.slice(0, latestSnapshotIndex), systemText),
			coeffs,
		);
		// Gateway stores earlier tool rounds on the final assistant message even
		// though their payloads are part of the final provider request input.
		covered.tools += toolPayloadTokens(snapshotMessage.tool_calls, coeffs);
		categories = reconcileSnapshotCategories(covered, snapshotInputTokens);

		// Only visible output is re-sent next round; reasoning stays discarded.
		// The output model splits the provider-reported total proportionally to
		// the fitted token weights of the visible text and the reasoning text.
		const { visible: visibleOutput } = splitOutputTokens(
			outputCoeffs,
			snapshotMessage.content,
			snapshotMessage.reasoning ?? "",
			snapshotOutputTokens,
		);
		categories.messages += visibleOutput;

		const after = categoriesFromFeatures(
			buildUsageFeatures(messages.slice(latestSnapshotIndex + 1), ""),
			coeffs,
		);
		categories.messages += after.messages;
		categories.tools += after.tools;
		const appendedTokens = after.messages + after.tools;

		usedTokens = snapshotInputTokens + appendedTokens;
		contextTokens = snapshotInputTokens + visibleOutput + appendedTokens;
	} else {
		const features = buildUsageFeatures(activeMessages, systemText);
		categories = categoriesFromFeatures(features, coeffs);
		usedTokens = categoryTotal(categories);
		contextTokens = usedTokens;
	}

	// Retained model output occupies the same context window as request input,
	// so the displayed occupancy must use the complete retained token count.
	const percentage = limit
		? Math.min(100, (contextTokens / limit) * 100)
		: null;
	return {
		usedTokens,
		contextTokens,
		limit: limit ?? null,
		percentage,
		freeTokens: limit
			? Math.max(0, limit - contextTokens - reservedTokens)
			: null,
		reservedTokens,
		source,
		snapshotInputTokens,
		snapshotOutputTokens,
		categories,
		modelSamples: model.sampleCount,
		modelTrusted: model.trusted,
		outputModelSamples: model.outputSampleCount,
		outputModelTrusted: model.outputTrusted,
	};
}

export function modelPricePerToken(
	config: ProviderModelConfig | undefined,
	kind: "prompt" | "completion",
	promptTokens = 0,
): number | null {
	// Provider metadata may express rates per token, thousand tokens, or million tokens.
	if (!config) return null;
	const direct = kind === "prompt" ? config.input_price : config.output_price;
	const candidates = config.pricing?.[kind] ?? [];
	// Conditional tiers in provider catalogs are usually selected by prompt size.
	const pricing =
		candidates.find((candidate) =>
			priceConditionMatches(candidate, promptTokens),
		) ??
		candidates.find(
			(candidate) => candidate.conditions?.prompt_tokens == null,
		) ??
		candidates[0];
	if (pricing) {
		const unit = (pricing.unit ?? "").toLowerCase();
		const divisor =
			unit.includes("mtoken") || unit.includes("million")
				? 1_000_000
				: unit.includes("ktoken") || unit.includes("thousand")
					? 1_000
					: unit.includes("token")
						? 1
						: 1_000_000;
		return pricing.value / divisor;
	}
	return typeof direct === "number" && Number.isFinite(direct)
		? direct / 1_000_000
		: null;
}

function priceConditionMatches(
	pricing: ProviderModelPrice,
	promptTokens: number,
): boolean {
	const condition = pricing.conditions?.prompt_tokens;
	if (!condition) return false;
	const unit = (condition.unit ?? "").toLowerCase();
	const value =
		unit.includes("mtoken") || unit.includes("million")
			? promptTokens / 1_000_000
			: unit.includes("ktoken") || unit.includes("thousand")
				? promptTokens / 1_000
				: promptTokens;
	return (
		(condition.gte == null || value >= condition.gte) &&
		(condition.lt == null || value < condition.lt)
	);
}

export function calculateUsageCost(
	config: ProviderModelConfig | undefined,
	inputTokens: number,
	outputTokens: number,
): { cost: number | null; currency: string } {
	const inputRate = modelPricePerToken(config, "prompt", inputTokens);
	const outputRate = modelPricePerToken(config, "completion", inputTokens);
	if (inputRate == null && outputRate == null) {
		return { cost: null, currency: config?.currency ?? "USD" };
	}
	return {
		cost: inputTokens * (inputRate ?? 0) + outputTokens * (outputRate ?? 0),
		currency: config?.currency ?? "USD",
	};
}

export function buildCompactionSummary(
	messages: Message[],
): CompactionState | null {
	// The summary is derived locally; the gateway still persists the complete transcript.
	if (messages.length < 4) return null;
	const keepRecent = Math.min(6, Math.max(2, Math.floor(messages.length / 3)));
	const archived = messages.slice(0, -keepRecent);
	const lines = archived
		.filter(
			(message) => message.role === "user" || message.role === "assistant",
		)
		.slice(-12)
		.map((message) => {
			const preview = message.content.replace(/\s+/g, " ").trim().slice(0, 180);
			return `${message.role === "user" ? "User" : "Assistant"}: ${preview}`;
		});
	if (lines.length === 0) return null;
	return {
		summary: `Earlier conversation context (${archived.length} messages):\n${lines.join("\n")}`,
		keepRecent,
		sourceTokens: archived.reduce(
			(sum, message) => sum + estimateTokens(message.content),
			0,
		),
		createdAt: new Date().toISOString(),
	};
}

export type ContextPanelTab = "context" | "memory" | "parameters";

interface ContextManagementState {
	records: UsageRecord[];
	autoCompact: boolean;
	advanced: AdvancedParameters;
	compactions: Record<string, CompactionState>;
	contextPanelOpen: boolean;
	contextPanelTab: ContextPanelTab;
	recordUsage: (record: Omit<UsageRecord, "id">) => void;
	clearUsage: () => void;
	setAutoCompact: (enabled: boolean) => void;
	setAdvanced: (patch: Partial<AdvancedParameters>) => void;
	compactConversation: (
		conversationId: string,
		messages: Message[],
	) => CompactionState | null;
	clearCompaction: (conversationId: string) => void;
	setContextPanelOpen: (open: boolean) => void;
	setContextPanelTab: (tab: ContextPanelTab) => void;
	/**
	 * Validate the estimator against the provider-reported snapshot on a
	 * finished turn and refit the token model for the given provider/model.
	 */
	learnFromSnapshot: (
		modelKey: string,
		messages: Message[],
		compaction: CompactionState | undefined,
		character: CharacterSnapshot | undefined,
	) => void;
}

export const useContextManagementStore = create<ContextManagementState>(
	(set, get) => ({
		records: readJson<UsageRecord[]>(USAGE_STORAGE_KEY, []),
		autoCompact:
			typeof window !== "undefined" &&
			localStorage.getItem(AUTO_COMPACT_STORAGE_KEY) !== "0",
		advanced: {
			...DEFAULT_ADVANCED_PARAMETERS,
			...readJson<Partial<AdvancedParameters>>(PARAMETERS_STORAGE_KEY, {}),
		},
		compactions: {},
		contextPanelOpen: false,
		contextPanelTab: "context",
		recordUsage: (record) => {
			const next = [
				{
					...record,
					id: `usage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
				},
				...get().records,
			].slice(0, MAX_USAGE_RECORDS);
			set({ records: next });
			persistJson(USAGE_STORAGE_KEY, next);
		},
		clearUsage: () => {
			set({ records: [] });
			persistJson(USAGE_STORAGE_KEY, []);
		},
		setAutoCompact: (enabled) => {
			set({ autoCompact: enabled });
			try {
				localStorage.setItem(AUTO_COMPACT_STORAGE_KEY, enabled ? "1" : "0");
			} catch {
				/* ignore */
			}
		},
		setAdvanced: (patch) => {
			const advanced = { ...get().advanced, ...patch };
			set({ advanced });
			persistJson(PARAMETERS_STORAGE_KEY, advanced);
		},
		compactConversation: (conversationId, messages) => {
			const result = buildCompactionSummary(messages);
			if (!result) return null;
			set((state) => ({
				compactions: { ...state.compactions, [conversationId]: result },
			}));
			return result;
		},
		clearCompaction: (conversationId) =>
			set((state) => {
				const compactions = { ...state.compactions };
				delete compactions[conversationId];
				return { compactions };
			}),
		setContextPanelOpen: (open) => set({ contextPanelOpen: open }),
		setContextPanelTab: (tab) => set({ contextPanelTab: tab }),
		learnFromSnapshot: (modelKey, messages, compaction, character) => {
			if (!modelKey) return;
			const snapshotIndex = latestContextSnapshotIndex(messages);
			if (snapshotIndex < 0) return;
			const snapshot = messages[snapshotIndex];
			const input = snapshot.context_input_tokens;
			if (typeof input !== "number" || !Number.isFinite(input) || input < 0)
				return;

			// Features must describe exactly what the provider received: the
			// system sections plus every message except the snapshot itself.
			const systemText = composeSystemPromptText(
				character,
				new Date(),
				compaction?.summary,
			);
			const before = messages.filter((message) => message.id !== snapshot.id);
			const base = buildUsageFeatures(before, systemText);
			const snapshotTools = toolPayloadStats(snapshot.tool_calls ?? []);
			const features: TokenFeatures = {
				asciiBytes: base.aggregate.asciiBytes + snapshotTools.asciiBytes,
				nonAsciiChars:
					base.aggregate.nonAsciiChars + snapshotTools.nonAsciiChars,
				messageCount: base.aggregate.messageCount,
			};
			recordSample(modelKey, snapshot.id, features, Math.trunc(input));

			// Output calibration: fit generated-token counts against the full
			// generated text (visible content plus reasoning).
			const output = snapshot.context_output_tokens;
			if (
				typeof output === "number" &&
				Number.isFinite(output) &&
				output >= 0
			) {
				const generated = addTextStats(
					countTextStats(snapshot.content),
					countTextStats(snapshot.reasoning ?? ""),
				);
				if (generated.asciiBytes > 0 || generated.nonAsciiChars > 0) {
					recordOutputSample(
						modelKey,
						snapshot.id,
						generated,
						Math.trunc(output),
					);
				}
			}
		},
	}),
);

import {create} from "zustand";
import type {Message} from "../services/conversation";
import type {
    ProviderModelConfig,
    ProviderModelPrice,
} from "../services/providers";

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

function emptyCategories(): ContextCategories {
	return { system: 0, tools: 0, skills: 0, messages: 0, other: 0 };
}

function addToolCallEstimates(
	categories: ContextCategories,
	toolCalls: Message["tool_calls"],
): void {
	for (const toolCall of toolCalls) {
		const serialized = `${toolCall.name}${toolCall.arguments}${toolCall.result ?? ""}`;
		categories.tools += Math.max(1, Math.ceil(serialized.length / 2));
	}
}

function addMessageEstimate(
	categories: ContextCategories,
	message: Message,
): void {
	// Content, reasoning, and tool payloads enter provider requests through
	// different protocol fields, so they must not be classified as one blob.
	const contentTokens =
		estimateTokens(message.content) + estimateTokens(message.reasoning ?? "");
	if (message.role === "system") categories.system += contentTokens;
	else if (message.role === "tool") categories.tools += contentTokens;
	else categories.messages += contentTokens;

	addToolCallEstimates(categories, message.tool_calls);
}

function categoryTotal(categories: ContextCategories): number {
	return Object.values(categories).reduce((sum, value) => sum + value, 0);
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
): ContextBreakdown {
	let categories = emptyCategories();
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

	let source: ContextBreakdown["source"] = "estimated";
	let snapshotInputTokens: number | null = null;
	let snapshotOutputTokens: number | null = null;
	let usedTokens: number;
	let contextTokens: number;
	if (snapshotMessage && !compactionAfterSnapshot) {
		source = "provider";
		snapshotInputTokens = Math.trunc(snapshotMessage.context_input_tokens ?? 0);
		snapshotOutputTokens = Math.trunc(
			snapshotMessage.context_output_tokens ?? 0,
		);
		const covered = emptyCategories();
		// Provider input usage covers every message before the assistant reply,
		// while that reply's output becomes input only on the following round.
		for (const message of messages.slice(0, latestSnapshotIndex)) {
			addMessageEstimate(covered, message);
		}
		// Gateway stores earlier tool rounds on the final assistant message even
		// though their payloads are part of the final provider request input.
		addToolCallEstimates(covered, snapshotMessage.tool_calls);
		categories = reconcileSnapshotCategories(covered, snapshotInputTokens);
		categories.messages += snapshotOutputTokens;
		const afterSnapshot = emptyCategories();
		for (const message of messages.slice(latestSnapshotIndex + 1)) {
			addMessageEstimate(afterSnapshot, message);
		}
		for (const key of Object.keys(categories) as (keyof ContextCategories)[]) {
			categories[key] += afterSnapshot[key];
		}
		const appendedTokens = categoryTotal(afterSnapshot);
		usedTokens = snapshotInputTokens + appendedTokens;
		contextTokens = snapshotInputTokens + snapshotOutputTokens + appendedTokens;
	} else {
		for (const message of activeMessages)
			addMessageEstimate(categories, message);
		if (compaction?.summary)
        categories.system += estimateTokens(compaction.summary);
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
        return {cost: null, currency: config?.currency ?? "USD"};
    }
    return {
        cost:
            inputTokens * (inputRate ?? 0) + outputTokens * (outputRate ?? 0),
        currency: config?.currency ?? "USD",
    };
}

export function buildCompactionSummary(messages: Message[]): CompactionState | null {
    // The summary is derived locally; the gateway still persists the complete transcript.
    if (messages.length < 4) return null;
    const keepRecent = Math.min(6, Math.max(2, Math.floor(messages.length / 3)));
    const archived = messages.slice(0, -keepRecent);
    const lines = archived
        .filter((message) => message.role === "user" || message.role === "assistant")
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

interface ContextManagementState {
    records: UsageRecord[];
    autoCompact: boolean;
    advanced: AdvancedParameters;
    compactions: Record<string, CompactionState>;
    contextPanelOpen: boolean;
    contextPanelTab: "parameters" | "context";
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
    setContextPanelTab: (tab: "parameters" | "context") => void;
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
            {...record, id: `usage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`},
            ...get().records,
        ].slice(0, MAX_USAGE_RECORDS);
        set({records: next});
        persistJson(USAGE_STORAGE_KEY, next);
    },
    clearUsage: () => {
        set({records: []});
        persistJson(USAGE_STORAGE_KEY, []);
    },
    setAutoCompact: (enabled) => {
        set({autoCompact: enabled});
        try {
            localStorage.setItem(AUTO_COMPACT_STORAGE_KEY, enabled ? "1" : "0");
        } catch {
            /* ignore */
        }
    },
    setAdvanced: (patch) => {
        const advanced = {...get().advanced, ...patch};
        set({advanced});
        persistJson(PARAMETERS_STORAGE_KEY, advanced);
    },
    compactConversation: (conversationId, messages) => {
        const result = buildCompactionSummary(messages);
        if (!result) return null;
        set((state) => ({
            compactions: {...state.compactions, [conversationId]: result},
        }));
        return result;
    },
    clearCompaction: (conversationId) =>
        set((state) => {
            const compactions = {...state.compactions};
            delete compactions[conversationId];
            return {compactions};
        }),
    setContextPanelOpen: (open) => set({contextPanelOpen: open}),
    setContextPanelTab: (tab) => set({contextPanelTab: tab}),
}));

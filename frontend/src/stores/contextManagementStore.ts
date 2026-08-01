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
    limit: number | null;
    percentage: number | null;
    freeTokens: number | null;
    categories: {
        system: number;
        tools: number;
        skills: number;
        messages: number;
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
    // A deterministic estimate keeps the live meter responsive without a model-specific tokenizer.
    const normalized = text.trim();
    return normalized ? Math.max(1, Math.ceil(normalized.length / 4)) : 0;
}

export function estimateContextUsage(
    messages: Message[],
    limit: number | undefined,
    compaction?: CompactionState,
): ContextBreakdown {
    const categories = {system: 0, tools: 0, skills: 0, messages: 0};
    // Once compacted, provider input contains the summary plus only the retained tail.
    const activeMessages = compaction?.summary
        ? compaction.keepRecent > 0
            ? messages.slice(-compaction.keepRecent)
            : []
        : messages;
    for (const message of activeMessages) {
        const tokens = estimateTokens(message.content);
        if (message.role === "system") categories.system += tokens;
        else if (message.role === "tool" || message.tool_calls.length > 0)
            categories.tools += tokens;
        else categories.messages += tokens;
    }
    if (compaction?.summary) {
        categories.system += estimateTokens(compaction.summary);
    }
    const usedTokens = Object.values(categories).reduce((sum, value) => sum + value, 0);
    const percentage = limit ? Math.min(100, (usedTokens / limit) * 100) : null;
    return {
        usedTokens,
        limit: limit ?? null,
        percentage,
        freeTokens: limit ? Math.max(0, limit - usedTokens) : null,
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
        const divisor = unit.includes("mtoken") || unit.includes("million")
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
        sourceTokens: archived.reduce((sum, message) => sum + estimateTokens(message.content), 0),
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
    compactConversation: (conversationId: string, messages: Message[]) => CompactionState | null;
    clearCompaction: (conversationId: string) => void;
    setContextPanelOpen: (open: boolean) => void;
    setContextPanelTab: (tab: "parameters" | "context") => void;
}

export const useContextManagementStore = create<ContextManagementState>((set, get) => ({
    records: readJson<UsageRecord[]>(USAGE_STORAGE_KEY, []),
    autoCompact:
        typeof window !== "undefined" && localStorage.getItem(AUTO_COMPACT_STORAGE_KEY) !== "0",
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

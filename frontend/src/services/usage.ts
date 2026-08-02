import { apiFetch } from "./api";

export type UsageRange =
	| "15m"
	| "30m"
	| "1h"
	| "3h"
	| "day"
	| "week"
	| "3w"
	| "month"
	| "quarter"
	| "year"
	| "custom"
	| "all";

export interface UsageReportQuery {
	range: UsageRange;
	from?: string;
	to?: string;
	provider?: string;
	model?: string;
	currency?: string;
}

export interface UsageRecord {
	id: string;
	conversationId: string;
	conversationTitle: string;
	provider: string;
	model: string;
	inputTokens: number;
	outputTokens: number;
	cacheCreationTokens: number;
	cacheReadTokens: number;
	durationMs: number;
	cost: number | null;
	currency: string;
	status: "completed" | "failed" | "stopped" | string;
	createdAt: string;
}

export interface UsageTotals {
	input: number;
	output: number;
	cacheCreation: number;
	cacheRead: number;
	requests: number;
	durationMs: number;
	cost: number | null;
	currency: string;
	priced: number;
}

export interface UsageTrendBucket {
	startAt: string;
	label: string;
	input: number;
	output: number;
	tokens: number;
}

export interface UsageBreakdownItem {
	name: string;
	requests: number;
	input: number;
	output: number;
	tokens: number;
	share: number;
	cost: number | null;
	currency: string;
}

export interface UsageReport {
	records: UsageRecord[];
	totals: UsageTotals;
	trend: UsageTrendBucket[];
	providerBreakdown: UsageBreakdownItem[];
	modelBreakdown: UsageBreakdownItem[];
	providers: string[];
	models: string[];
	currencies: string[];
}

interface UsageRecordPayload {
	id: string;
	conversation_id: string;
	conversation_title: string;
	provider: string;
	model: string;
	input_tokens: number;
	output_tokens: number;
	cache_creation_tokens?: number;
	cache_read_tokens?: number;
	duration_ms: number;
	cost: number | null;
	currency: string;
	status: string;
	created_at: string;
}

interface UsageTotalsPayload {
	input: number;
	output: number;
	cache_creation?: number;
	cache_read?: number;
	requests: number;
	duration_ms: number;
	cost: number | null;
	currency?: string;
	priced: number;
}

interface UsageTrendBucketPayload {
	start_at: string;
	label: string;
	input: number;
	output: number;
	tokens: number;
}

interface UsageBreakdownItemPayload {
	name: string;
	requests: number;
	input: number;
	output: number;
	tokens: number;
	share: number;
	cost: number | null;
	currency?: string;
}

interface UsageReportPayload {
	records: UsageRecordPayload[];
	totals: UsageTotalsPayload;
	trend: UsageTrendBucketPayload[];
	provider_breakdown: UsageBreakdownItemPayload[];
	model_breakdown: UsageBreakdownItemPayload[];
	providers: string[];
	models: string[];
	currencies?: string[];
}

export const emptyUsageReport = (): UsageReport => ({
	records: [],
	totals: {
		input: 0,
		output: 0,
		cacheCreation: 0,
		cacheRead: 0,
		requests: 0,
		durationMs: 0,
		cost: null,
		currency: "USD",
		priced: 0,
	},
	trend: [],
	providerBreakdown: [],
	modelBreakdown: [],
	providers: [],
	models: [],
	currencies: ["USD", "CNY", "EUR"],
});

export async function getUsageReport(
	query: UsageReportQuery,
	signal?: AbortSignal,
): Promise<UsageReport> {
	const params = new URLSearchParams();
	params.set("range", query.range);
	params.set(
		"timezone_offset_minutes",
		String(-new Date().getTimezoneOffset()),
	);
	if (query.range === "custom") {
		if (query.from) params.set("from", query.from);
		if (query.to) params.set("to", query.to);
	}
	if (query.provider && query.provider !== "all") {
		params.set("provider", query.provider);
	}
	if (query.model && query.model !== "all") {
		params.set("model", query.model);
	}
	if (query.currency) params.set("currency", query.currency);

	const payload = await apiFetch<UsageReportPayload>(
		`/usage?${params.toString()}`,
		{ signal },
	);
	return normalizeUsageReport(payload);
}

function normalizeUsageReport(payload: UsageReportPayload): UsageReport {
	return {
		records: payload.records.map((record) => ({
			id: record.id,
			conversationId: record.conversation_id,
			conversationTitle: record.conversation_title,
			provider: record.provider,
			model: record.model,
			inputTokens: record.input_tokens,
			outputTokens: record.output_tokens,
			cacheCreationTokens: record.cache_creation_tokens ?? 0,
			cacheReadTokens: record.cache_read_tokens ?? 0,
			durationMs: record.duration_ms,
			cost: record.cost,
			currency: record.currency,
			status: record.status,
			createdAt: record.created_at,
		})),
		totals: {
			input: payload.totals.input,
			output: payload.totals.output,
			cacheCreation: payload.totals.cache_creation ?? 0,
			cacheRead: payload.totals.cache_read ?? 0,
			requests: payload.totals.requests,
			durationMs: payload.totals.duration_ms,
			cost: payload.totals.cost,
			currency: payload.totals.currency ?? "USD",
			priced: payload.totals.priced,
		},
		trend: payload.trend.map((bucket) => ({
			startAt: bucket.start_at,
			label: bucket.label,
			input: bucket.input,
			output: bucket.output,
			tokens: bucket.tokens,
		})),
		providerBreakdown: payload.provider_breakdown.map((item) => ({
			...item,
			currency: item.currency ?? payload.totals.currency ?? "USD",
		})),
		modelBreakdown: payload.model_breakdown.map((item) => ({
			...item,
			currency: item.currency ?? payload.totals.currency ?? "USD",
		})),
		providers: payload.providers,
		models: payload.models,
		currencies: payload.currencies ?? ["USD", "CNY", "EUR"],
	};
}

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "../services/conversation";

const saveConversationSummaryMock = vi.fn();
const deleteConversationSummaryMock = vi.fn();
vi.mock("../services/conversation", () => ({
	saveConversationSummary: (...args: unknown[]) =>
		saveConversationSummaryMock(...args),
	deleteConversationSummary: (...args: unknown[]) =>
		deleteConversationSummaryMock(...args),
}));

import {
	DEFAULT_ADVANCED_PARAMETERS,
	autoCompactThreshold,
	buildCompactionSummary,
	calculateUsageCost,
	estimateContextUsage,
	useContextManagementStore,
} from "./contextManagementStore";

function message(id: string, role: Message["role"], content: string): Message {
	return {
		id,
		role,
		content,
		parent_id: null,
		tool_calls: [],
		status: "completed",
		created_at: "2026-08-01T00:00:00.000Z",
	};
}

function measuredAssistant(
	id: string,
	billingInput: number,
	billingOutput: number,
	contextInput: number,
	contextOutput: number,
): Message {
	// Billing totals may include repeated tool rounds; context fields describe
	// only the final request that determines current window occupancy.
	return {
		...message(id, "assistant", "answer"),
		input_tokens: billingInput,
		output_tokens: billingOutput,
		context_input_tokens: contextInput,
		context_output_tokens: contextOutput,
	};
}

beforeEach(() => {
	localStorage.clear();
	saveConversationSummaryMock.mockReset().mockResolvedValue(undefined);
	deleteConversationSummaryMock.mockReset().mockResolvedValue(undefined);
	useContextManagementStore.setState({
		records: [],
		autoCompact: true,
		advanced: { ...DEFAULT_ADVANCED_PARAMETERS },
		compactions: {},
		contextPanelOpen: false,
		contextPanelTab: "context",
	});
});

describe("context management calculations", () => {
	it("measures the compacted provider input instead of the full stored transcript", () => {
		const messages = Array.from({ length: 4 }, (_, index) =>
			message(String(index), index % 2 ? "assistant" : "user", "x".repeat(40)),
		);

		const usage = estimateContextUsage(messages, 100, {
			summary: "summary",
			keepRecent: 2,
			sourceTokens: 20,
			createdAt: "2026-08-01T00:00:00.000Z",
		});

		// Two retained messages: 40 ASCII bytes -> 10 tokens each, plus the
		// 4-token per-message framing overhead.
		expect(usage.categories.messages).toBe(28);
		expect(usage.categories.system).toBeGreaterThanOrEqual(2);
		expect(usage.source).toBe("estimated");
		expect(usage.usedTokens).toBe(28 + usage.categories.system);
		expect(usage.contextTokens).toBe(usage.usedTokens);
		expect(usage.percentage).toBe(usage.usedTokens);
	});

	it("uses the final provider round instead of cumulative billing usage", () => {
		const messages = [
			message("user", "user", "question"),
			measuredAssistant("assistant", 2020, 597, 793, 25),
		];

		const usage = estimateContextUsage(messages, 1_000_000);

		expect(usage.source).toBe("provider");
		expect(usage.usedTokens).toBe(793);
		expect(usage.contextTokens).toBe(818);
		expect(usage.freeTokens).toBe(999_182);
		expect(usage.snapshotInputTokens).toBe(793);
		expect(usage.snapshotOutputTokens).toBe(25);
		// Covered user content (8 ASCII bytes -> 2 tokens + 4 overhead) plus the
		// visible output retained for the next request.
		expect(usage.categories.messages).toBe(31);
		expect(
			Object.values(usage.categories).reduce((sum, value) => sum + value, 0),
		).toBe(818);
	});

	it("classifies tool calls stored on the provider snapshot message", () => {
		// Gateway persists all tool rounds on the final assistant message, while
		// the provider snapshot on that same message measures the final request.
		const assistant = measuredAssistant("assistant", 1800, 400, 1000, 100);
		assistant.tool_calls = [
			{
				id: "search-1",
				name: "web_search",
				arguments: '{"query":"nginx vulnerabilities"}',
				result: "search result ".repeat(20),
				status: "success",
			},
		];

		const usage = estimateContextUsage(
			[message("user", "user", "question"), assistant],
			10_000,
		);

		// Payload = name(10) + arguments(32) + result(280) = 322 ASCII bytes.
		expect(usage.categories.tools).toBe(81);
		expect(usage.categories.other).toBeGreaterThan(0);
		expect(
			Object.values(usage.categories).reduce((sum, value) => sum + value, 0),
		).toBe(1100);
	});

	it("estimates messages added after the latest provider snapshot", () => {
		const messages = [
			message("user", "user", "question"),
			measuredAssistant("assistant", 2020, 597, 793, 25),
			message("next", "user", "12345678"),
		];

		const usage = estimateContextUsage(messages, 1_000_000);

		expect(usage.usedTokens).toBe(799);
		expect(usage.contextTokens).toBe(824);
		expect(usage.categories.messages).toBeGreaterThan(0);
	});

	it("never counts model reasoning toward retained context", () => {
		const assistant = message("assistant", "assistant", "ok");
		assistant.reasoning = "x".repeat(100);

		const usage = estimateContextUsage(
			[message("user", "user", "hi"), assistant],
			10_000,
		);

		// Content totals 4 ASCII bytes -> 1 token, plus 8 for two messages'
		// framing overhead. The 100 reasoning bytes must be absent.
		expect(usage.categories.messages).toBe(9);
	});

	it("subtracts reasoning from the retained provider output", () => {
		const assistant = measuredAssistant("assistant", 2000, 600, 900, 80);
		assistant.reasoning = "x".repeat(160);

		const usage = estimateContextUsage(
			[message("user", "user", "question"), assistant],
			10_000,
		);

		// Default output coefficients weigh "answer" (6 bytes -> 1.5) against
		// reasoning (160 bytes -> 40); 80 total splits roughly 3 visible / 77
		// reasoning, so only ~3 visible tokens are retained next round.
		expect(usage.contextTokens).toBe(903);
		expect(usage.categories.messages).toBeLessThan(10);
	});

	it("uses fixed output and safety reserves for auto compaction", () => {
		expect(autoCompactThreshold(200_000, 32_000)).toBe(167_000);
		expect(autoCompactThreshold(1_000_000, 4_096)).toBe(982_904);
	});

	it("normalizes mixed provider pricing units to a per-token estimate", () => {
		const result = calculateUsageCost(
			{
				id: "priced-model",
				streaming: true,
				pricing: {
					prompt: [{ value: 2, unit: "perMTokens", currency: "USD" }],
					completion: [{ value: 10, unit: "perMTokens", currency: "USD" }],
				},
				currency: "USD",
			},
			1000,
			500,
		);

		expect(result.currency).toBe("USD");
		expect(result.cost).toBeCloseTo(0.007, 8);
	});

	it("selects the pricing tier that matches the prompt size", () => {
		const tiered = [
			{
				value: 2,
				unit: "perMTokens",
				currency: "USD",
				conditions: {
					prompt_tokens: { unit: "kTokens", gte: 0, lt: 200 },
				},
			},
			{
				value: 4,
				unit: "perMTokens",
				currency: "USD",
				conditions: {
					prompt_tokens: { unit: "kTokens", gte: 200 },
				},
			},
		];
		const result = calculateUsageCost(
			{
				id: "tiered-model",
				streaming: true,
				pricing: {
					prompt: tiered,
					completion: tiered.map((price) => ({
						...price,
						value: price.value * 5,
					})),
				},
			},
			250_000,
			1_000,
		);

		expect(result.cost).toBeCloseTo(1.02, 8);
	});

	it("builds a summary while retaining a recent message tail", () => {
		const messages = Array.from({ length: 6 }, (_, index) =>
			message(
				String(index),
				index % 2 ? "assistant" : "user",
				`message ${index}`,
			),
		);

		const result = buildCompactionSummary(messages);

		expect(result?.keepRecent).toBe(2);
		expect(result?.summary).toContain(
			"Earlier conversation context (4 messages)",
		);
		expect(result?.summary).toContain("User: message 0");
	});
});

describe("compaction persistence", () => {
	it("stores the archived range when a conversation is compacted", () => {
		const messages = Array.from({ length: 6 }, (_, index) =>
			message(
				String(index),
				index % 2 ? "assistant" : "user",
				`message ${index}`,
			),
		);

		const result = useContextManagementStore
			.getState()
			.compactConversation("c1", messages);

		expect(result?.keepRecent).toBe(2);
		expect(saveConversationSummaryMock).toHaveBeenCalledWith(
			"c1",
			result?.summary,
			"0",
			"3",
		);
	});

	it("restores a stored summary and derives the retained tail", () => {
		const messages = Array.from({ length: 5 }, (_, index) =>
			message(String(index), "user", "x".repeat(40)),
		);

		useContextManagementStore
			.getState()
			.restoreCompaction("c1", "stored summary", "0", "2", messages);

		const compaction = useContextManagementStore.getState().compactions.c1;
		expect(compaction?.summary).toBe("stored summary");
		expect(compaction?.keepRecent).toBe(2);
		expect(compaction?.sourceTokens).toBeGreaterThan(0);
	});

	it("keeps a session compaction over the stored one", () => {
		const messages = Array.from({ length: 4 }, (_, index) =>
			message(String(index), "user", "hello"),
		);
		useContextManagementStore.getState().compactConversation("c1", messages);
		const local = useContextManagementStore.getState().compactions.c1;

		useContextManagementStore
			.getState()
			.restoreCompaction("c1", "older stored summary", null, null, messages);

		expect(useContextManagementStore.getState().compactions.c1).toEqual(local);
	});

	it("clears the stored summary together with the session state", () => {
		const messages = Array.from({ length: 4 }, (_, index) =>
			message(String(index), "user", "hello"),
		);
		useContextManagementStore.getState().compactConversation("c1", messages);

		useContextManagementStore.getState().clearCompaction("c1");

		expect(deleteConversationSummaryMock).toHaveBeenCalledWith("c1");
		expect(useContextManagementStore.getState().compactions.c1).toBeUndefined();
	});
});

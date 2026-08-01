import {beforeEach, describe, expect, it} from "vitest";
import type {Message} from "../services/conversation";
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
    useContextManagementStore.setState({
        records: [],
        autoCompact: true,
        advanced: {...DEFAULT_ADVANCED_PARAMETERS},
        compactions: {},
        contextPanelOpen: false,
        contextPanelTab: "context",
    });
});

describe("context management calculations", () => {
    it("measures the compacted provider input instead of the full stored transcript", () => {
        const messages = Array.from({length: 4}, (_, index) =>
            message(String(index), index % 2 ? "assistant" : "user", "x".repeat(40)),
        );

        const usage = estimateContextUsage(messages, 100, {
            summary: "summary",
            keepRecent: 2,
            sourceTokens: 20,
            createdAt: "2026-08-01T00:00:00.000Z",
        });

        expect(usage.categories.messages).toBe(20);
        expect(usage.categories.system).toBe(2);
        expect(usage.usedTokens).toBe(22);
        expect(usage.percentage).toBe(22);
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
		expect(
			Object.values(usage.categories).reduce((sum, value) => sum + value, 0),
		).toBe(818);
	});

	it("estimates messages added after the latest provider snapshot", () => {
		const messages = [
			message("user", "user", "question"),
			measuredAssistant("assistant", 2020, 597, 793, 25),
			message("next", "user", "12345678"),
		];

		const usage = estimateContextUsage(messages, 1_000_000);

		expect(usage.usedTokens).toBe(795);
		expect(usage.contextTokens).toBe(820);
		expect(usage.categories.messages).toBeGreaterThan(0);
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
                    prompt: [{value: 2, unit: "perMTokens", currency: "USD"}],
                    completion: [{value: 10, unit: "perMTokens", currency: "USD"}],
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
                    prompt_tokens: {unit: "kTokens", gte: 0, lt: 200},
                },
            },
            {
                value: 4,
                unit: "perMTokens",
                currency: "USD",
                conditions: {
                    prompt_tokens: {unit: "kTokens", gte: 200},
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
        const messages = Array.from({length: 6}, (_, index) =>
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

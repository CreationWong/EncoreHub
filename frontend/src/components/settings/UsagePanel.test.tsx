import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type UsageReport, getUsageReport } from "../../services/usage";
import UsagePanel from "./UsagePanel";

vi.mock("../../services/usage", async () => {
	const actual = await vi.importActual<typeof import("../../services/usage")>(
		"../../services/usage",
	);
	return {
		...actual,
		getUsageReport: vi.fn(),
	};
});

const sampleReport: UsageReport = {
	records: [
		{
			id: "openai-call",
			conversationId: "conversation-1",
			conversationTitle: "One",
			provider: "openai",
			model: "gpt-test",
			inputTokens: 100,
			outputTokens: 50,
			cacheCreationTokens: 20,
			cacheReadTokens: 60,
			durationMs: 800,
			cost: 0.004,
			currency: "USD",
			status: "completed",
			createdAt: "2026-08-01T00:05:00.000Z",
		},
		{
			id: "anthropic-call",
			conversationId: "conversation-2",
			conversationTitle: "Two",
			provider: "anthropic",
			model: "claude-test",
			inputTokens: 25,
			outputTokens: 25,
			cacheCreationTokens: 0,
			cacheReadTokens: 10,
			durationMs: 1000,
			cost: null,
			currency: "USD",
			status: "failed",
			createdAt: "2026-08-01T00:35:00.000Z",
		},
	],
	totals: {
		input: 125,
		output: 75,
		cacheCreation: 20,
		cacheRead: 70,
		requests: 2,
		durationMs: 1800,
		cost: 0.004,
		currency: "USD",
		priced: 1,
	},
	trend: [
		{
			startAt: "2026-08-01T00:00:00.000Z",
			label: "00:00",
			input: 100,
			output: 50,
			tokens: 150,
		},
		{
			startAt: "2026-08-01T00:15:00.000Z",
			label: "00:15",
			input: 0,
			output: 0,
			tokens: 0,
		},
		{
			startAt: "2026-08-01T00:30:00.000Z",
			label: "00:30",
			input: 25,
			output: 25,
			tokens: 50,
		},
	],
	providerBreakdown: [
		{
			name: "openai",
			requests: 1,
			input: 100,
			output: 50,
			tokens: 150,
			share: 75,
			cost: 0.004,
			currency: "USD",
		},
		{
			name: "anthropic",
			requests: 1,
			input: 25,
			output: 25,
			tokens: 50,
			share: 25,
			cost: null,
			currency: "USD",
		},
	],
	modelBreakdown: [
		{
			name: "gpt-test",
			requests: 1,
			input: 100,
			output: 50,
			tokens: 150,
			share: 75,
			cost: 0.004,
			currency: "USD",
		},
		{
			name: "claude-test",
			requests: 1,
			input: 25,
			output: 25,
			tokens: 50,
			share: 25,
			cost: null,
			currency: "USD",
		},
	],
	providers: ["anthropic", "openai"],
	models: ["claude-test", "gpt-test"],
	currencies: ["USD", "CNY", "EUR"],
};

const mockedGetUsageReport = vi.mocked(getUsageReport);

beforeEach(() => {
	mockedGetUsageReport.mockResolvedValue(sampleReport);
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("UsagePanel", () => {
	it("loads the Engine usage report and renders returned time buckets", async () => {
		render(<UsagePanel />);

		expect(await screen.findByTitle("gpt-test")).toBeDefined();
		expect(screen.getByTitle("150 tokens (100 in / 50 out)")).toBeDefined();
		expect(screen.getByTitle("50 tokens (25 in / 25 out)")).toBeDefined();
		expect(screen.getByTitle("Aug 01, 2026 · 00:00")).toBeDefined();
		const firstBucket = screen.getByRole("button", {
			name: "Aug 01, 2026 · 00:00: 150 tokens (100 in / 50 out)",
		});
		expect(
			firstBucket
				.querySelector("[data-placement]")
				?.getAttribute("data-placement"),
		).toBe("right");
		expect(firstBucket.getAttribute("aria-pressed")).toBe("false");
		fireEvent.click(firstBucket);
		expect(firstBucket.getAttribute("aria-pressed")).toBe("true");
		expect(screen.getByText("Cache hits")).toBeDefined();
		expect(screen.getByText("Cache created")).toBeDefined();
		expect(screen.queryByText("Aggregation")).toBeNull();
		expect(mockedGetUsageReport).toHaveBeenCalledWith(
			{ range: "day", provider: "all", model: "all", currency: "USD" },
			expect.any(AbortSignal),
		);
	});

	it("passes range and provider filters through to the Engine report", async () => {
		render(<UsagePanel />);
		await screen.findByTitle("gpt-test");

		fireEvent.change(screen.getByLabelText("Usage period"), {
			target: { value: "15m" },
		});
		await waitFor(() =>
			expect(mockedGetUsageReport).toHaveBeenLastCalledWith(
				{ range: "15m", provider: "all", model: "all", currency: "USD" },
				expect.any(AbortSignal),
			),
		);

		fireEvent.change(screen.getByLabelText("Usage provider"), {
			target: { value: "anthropic" },
		});
		await waitFor(() =>
			expect(mockedGetUsageReport).toHaveBeenLastCalledWith(
				{ range: "15m", provider: "anthropic", model: "all", currency: "USD" },
				expect.any(AbortSignal),
			),
		);

		fireEvent.change(screen.getByLabelText("Usage currency"), {
			target: { value: "CNY" },
		});
		await waitFor(() =>
			expect(mockedGetUsageReport).toHaveBeenLastCalledWith(
				{ range: "15m", provider: "anthropic", model: "all", currency: "CNY" },
				expect.any(AbortSignal),
			),
		);
	});

	it("renders Engine share breakdowns as bars or pie charts", async () => {
		render(<UsagePanel />);
		await screen.findByTitle("gpt-test");

		fireEvent.click(screen.getByRole("button", { name: "Provider stats" }));
		expect(screen.getByTitle("openai 75%")).toBeDefined();
		expect(screen.getAllByText("75%").length).toBeGreaterThan(0);

		fireEvent.click(screen.getByRole("button", { name: "Pie share chart" }));
		expect(screen.getByLabelText("Usage share pie chart")).toBeDefined();
		expect(screen.getAllByText("25%").length).toBeGreaterThan(0);
	});
});

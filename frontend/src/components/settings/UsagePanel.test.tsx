import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {useContextManagementStore} from "../../stores/contextManagementStore";
import UsagePanel from "./UsagePanel";

beforeEach(() => {
    useContextManagementStore.setState({
        records: [
            {
                id: "openai-call",
                conversationId: "conversation-1",
                conversationTitle: "One",
                provider: "openai",
                model: "gpt-test",
                inputTokens: 100,
                outputTokens: 25,
                durationMs: 800,
                cost: 0.004,
                currency: "USD",
                status: "completed",
                createdAt: "2026-08-01T00:00:00.000Z",
            },
            {
                id: "anthropic-call",
                conversationId: "conversation-2",
                conversationTitle: "Two",
                provider: "anthropic",
                model: "claude-test",
                inputTokens: 80,
                outputTokens: 20,
                durationMs: 1000,
                cost: null,
                currency: "USD",
                status: "failed",
                createdAt: "2026-08-01T01:00:00.000Z",
            },
        ],
    });
});

afterEach(cleanup);

describe("UsagePanel", () => {
    it("centers a single-day trend bar in its date bucket", () => {
        render(<UsagePanel/>);

        // A single date occupies the full chart width; center its constrained
        // bar so the visual column stays aligned with the centered date label.
        const barContainer = screen.getByTitle("225 tokens").parentElement;
        expect(barContainer?.classList.contains("mx-auto")).toBe(true);
    });

    it("filters request rows and clears the persisted usage log", () => {
        render(<UsagePanel/>);

        expect(screen.getByTitle("gpt-test")).toBeDefined();
        expect(screen.getByTitle("claude-test")).toBeDefined();

        fireEvent.change(screen.getByLabelText("Usage provider"), {
            target: {value: "anthropic"},
        });
        expect(screen.queryByTitle("gpt-test")).toBeNull();
        expect(screen.getByTitle("claude-test")).toBeDefined();

        fireEvent.click(screen.getByRole("button", {name: "Clear usage history"}));
        expect(useContextManagementStore.getState().records).toEqual([]);
        expect(
            screen.getAllByText("Usage records will appear after the next model response."),
        ).toHaveLength(2);
    });
});

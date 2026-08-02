import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Message } from "../../services/conversation";
import {
	DEFAULT_ADVANCED_PARAMETERS,
	useContextManagementStore,
} from "../../stores/contextManagementStore";
import { useConversationStore } from "../../stores/conversationStore";
import { useProviderStore } from "../../stores/providerStore";
import { useSettingsStore } from "../../stores/settingsStore";
import ContextManagementPanel from "./ContextManagementPanel";

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

beforeEach(() => {
	useConversationStore.setState({
		activeId: "conversation-1",
		conversations: [
			{
				id: "conversation-1",
				title: "Context planning",
				provider: "openai",
				model: "gpt-test",
				message_count: 4,
				created_at: "2026-08-01T00:00:00.000Z",
				updated_at: "2026-08-01T00:00:00.000Z",
			},
		],
		messages: [
			message("1", "user", "first question"),
			message("2", "assistant", "first response"),
			message("3", "user", "second question"),
			message("4", "assistant", "second response"),
		],
		loading: false,
		streaming: false,
	});
	useSettingsStore.setState({ provider: "openai", model: "gpt-test" });
	useProviderStore.setState({
		profiles: [
			{
				id: "openai",
				name: "OpenAI",
				protocol: "openai",
				base_url: "",
				models: ["gpt-test"],
				model_configs: [
					{
						id: "gpt-test",
						name: "GPT Test",
						streaming: true,
						context_window: 1000,
						max_output_tokens: 8192,
					},
				],
				enabled: true,
				builtin: true,
			},
		],
	});
	useContextManagementStore.setState({
		contextPanelOpen: true,
		contextPanelTab: "context",
		autoCompact: true,
		advanced: { ...DEFAULT_ADVANCED_PARAMETERS },
		compactions: {},
		records: [
			{
				id: "usage-1",
				conversationId: "conversation-1",
				conversationTitle: "Context planning",
				provider: "openai",
				model: "gpt-test",
				inputTokens: 100,
				outputTokens: 20,
				durationMs: 1200,
				cost: 0.0123,
				currency: "USD",
				status: "completed",
				createdAt: "2026-08-01T00:00:00.000Z",
			},
		],
	});
});

afterEach(cleanup);

describe("ContextManagementPanel", () => {
	it("does not duplicate the context panel toggle inside the panel", () => {
		render(<ContextManagementPanel />);

		expect(
			screen.queryByRole("button", { name: "Close context panel" }),
		).toBeNull();
	});

	it("uses the complete retained context for the meter and preserves sub-percent precision", () => {
		// The provider's latest output remains in the window, so it must be
		// included alongside the latest input snapshot in every meter value.
		useConversationStore.setState({
			messages: [
				message("user", "user", "question"),
				{
					...message("assistant", "assistant", "answer"),
					context_input_tokens: 3,
					context_output_tokens: 1,
				},
			],
		});

		render(<ContextManagementPanel />);

		const meter = screen.getByRole("progressbar", { name: "Context usage" });
		expect(meter.getAttribute("aria-valuenow")).toBe("4");
		expect(screen.getByText("0.4%")).toBeDefined();
		expect(screen.getByText("4 of 1,000 tokens")).toBeDefined();

		// Unattributed request overhead needs a distinct foreground color so
		// a non-zero share cannot disappear into the neutral progress track.
		const otherLabel = screen.getByText("Other request data");
		const otherTrack = otherLabel.parentElement?.nextElementSibling;
		const otherBar = otherTrack?.firstElementChild as HTMLElement | null;
		expect(otherBar?.style.width).toBe("25%");
		expect(otherBar?.classList.contains("bg-text-muted")).toBe(true);
	});

	it("shows context usage, compacts history, and updates advanced parameters", () => {
		render(<ContextManagementPanel />);

		expect(screen.getByRole("heading", { name: "GPT Test" })).toBeDefined();
		expect(
			screen.getByRole("progressbar", { name: "Context usage" }),
		).toBeDefined();
		expect(screen.getByText("$0.0123")).toBeDefined();

		fireEvent.click(screen.getByRole("button", { name: "Compress context" }));
		expect(screen.getByText(/Earlier conversation context/)).toBeDefined();

		fireEvent.click(screen.getByRole("tab", { name: "Parameters" }));
		fireEvent.change(screen.getByLabelText("Temperature"), {
			target: { value: "1.2" },
		});
		fireEvent.click(screen.getByRole("button", { name: "JSON" }));

		expect(useContextManagementStore.getState().advanced.temperature).toBe(1.2);
		expect(useContextManagementStore.getState().advanced.responseFormat).toBe(
			"json_object",
		);
	});
});

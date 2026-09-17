import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "../../services/conversation";
import { DEFAULT_MODEL_METADATA_PROVIDER } from "../../services/modelMetadata";
import {
	DEFAULT_ADVANCED_PARAMETERS,
	useContextManagementStore,
} from "../../stores/contextManagementStore";
import { useConversationStore } from "../../stores/conversationStore";
import { useModelMetadataStore } from "../../stores/modelMetadataStore";
import { useProviderStore } from "../../stores/providerStore";
import {
	DEFAULT_CONTEXT_METER_METRICS,
	useSettingsStore,
} from "../../stores/settingsStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import ContextManagementPanel from "./ContextManagementPanel";

vi.mock("./CurrentMemoryPanel", () => ({
	default: () => <p>Current memory panel</p>,
}));

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

/** Two messages with a provider snapshot so token totals stay deterministic. */
function snapshotMessages(): Message[] {
	return [
		message("user", "user", "question"),
		{
			...message("assistant", "assistant", "answer"),
			context_input_tokens: 3,
			context_output_tokens: 1,
		},
	];
}

function setContextWindow(value: number | undefined): void {
	useProviderStore.setState((state) => ({
		profiles: state.profiles.map((profile) => ({
			...profile,
			model_configs: profile.model_configs?.map((model) => ({
				...model,
				context_window: value,
			})),
		})),
	}));
}

beforeEach(() => {
	useModelMetadataStore.setState({
		providers: [{ ...DEFAULT_MODEL_METADATA_PROVIDER }],
		recordsByProvider: {},
	});
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
	useSettingsStore.setState({
		provider: "openai",
		model: "gpt-test",
		mathRenderer: "katex",
		contextMeterPrimary: "percentage",
		contextMeterMetrics: DEFAULT_CONTEXT_METER_METRICS.map((item) => ({
			...item,
		})),
	});
	useWorkspaceStore.setState({
		activeTab: "home",
		openTabs: ["home"],
	});
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
	it("closes the panel from its own header button without duplicating the toolbar toggle", () => {
		render(<ContextManagementPanel />);

		const close = screen.getByRole("button", { name: "Close context panel" });
		fireEvent.click(close);

		expect(useContextManagementStore.getState().contextPanelOpen).toBe(false);
	});

	it("navigates tabs with arrow keys and roving tabindex", () => {
		render(<ContextManagementPanel />);
		const contextTab = screen.getByRole("tab", { name: "Context" });

		expect(contextTab.tabIndex).toBe(0);
		fireEvent.keyDown(contextTab, { key: "ArrowRight" });

		expect(useContextManagementStore.getState().contextPanelTab).toBe("memory");
		expect(screen.getByRole("tab", { name: "Memory" }).tabIndex).toBe(0);
	});

	it("uses the complete retained context for the meter and preserves sub-percent precision", () => {
		// The provider's latest output remains in the window, so it must be
		// included alongside the latest input snapshot in every meter value.
		useConversationStore.setState({ messages: snapshotMessages() });

		render(<ContextManagementPanel />);

		const meter = screen.getByRole("progressbar", { name: "Context usage" });
		expect(meter.getAttribute("aria-valuenow")).toBe("4");
		expect(screen.getByText("0.4%")).toBeDefined();
		expect(screen.getByText("996 tokens remaining")).toBeDefined();
		expect(screen.getByText("Request contents")).toBeDefined();
		expect(
			screen.getByText("2 messages included in the next request"),
		).toBeDefined();

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
		expect(screen.getByRole("heading", { name: "Next request" })).toBeDefined();
		expect(
			screen.getByRole("progressbar", { name: "Context usage" }),
		).toBeDefined();
		expect(screen.getByText("$0.0123")).toBeDefined();

		fireEvent.click(screen.getByRole("button", { name: "Compress context" }));
		expect(screen.getByText(/Earlier conversation context/)).toBeDefined();

		fireEvent.click(screen.getByRole("tab", { name: "Parameters" }));
		expect(
			screen.getByText(
				"Sampling parameters apply to requests in every conversation.",
			),
		).toBeDefined();
		fireEvent.change(screen.getByLabelText("Temperature"), {
			target: { value: "1.2" },
		});

		expect(useContextManagementStore.getState().advanced.temperature).toBe(1.2);
		expect(screen.queryByLabelText("Response format")).toBeNull();
	});

	it("opens current memory management from the side panel tabs", () => {
		render(<ContextManagementPanel />);

		fireEvent.click(screen.getByRole("tab", { name: "Memory" }));

		expect(screen.getByText("Current memory panel")).toBeDefined();
		expect(useContextManagementStore.getState().contextPanelTab).toBe("memory");
	});

	it("switches to the rendering tab and selects a math engine", () => {
		render(<ContextManagementPanel />);
		const button = screen.getByRole("tab", { name: "Rendering" });

		fireEvent.click(button);
		expect(useContextManagementStore.getState().contextPanelTab).toBe(
			"rendering",
		);

		fireEvent.click(screen.getByRole("button", { name: /MathJax/ }));
		expect(useSettingsStore.getState().mathRenderer).toBe("mathjax");
	});

	it("warns when the model window is filling up or nearly full", () => {
		useConversationStore.setState({ messages: snapshotMessages() });

		setContextWindow(5);
		const first = render(<ContextManagementPanel />);
		expect(screen.getByText(/Filling up/)).toBeDefined();
		first.unmount();

		setContextWindow(4);
		render(<ContextManagementPanel />);
		expect(screen.getByText(/Almost out of room/)).toBeDefined();
	});

	it("explains when auto compact will run", () => {
		setContextWindow(100_000);
		useContextManagementStore.setState({
			advanced: { ...DEFAULT_ADVANCED_PARAMETERS, maxCompletionTokens: 4000 },
		});

		render(<ContextManagementPanel />);

		expect(
			screen.getByText(/Compresses automatically at about 83%/),
		).toBeDefined();
	});

	it("labels re-compression and explains disabled compression", () => {
		const first = render(<ContextManagementPanel />);
		fireEvent.click(screen.getByRole("button", { name: "Compress context" }));
		expect(
			screen.getByRole("button", { name: "Re-compress context" }),
		).toBeDefined();
		expect(screen.getByText(/replaces the saved summary/)).toBeDefined();
		first.unmount();

		useContextManagementStore.setState({ compactions: {} });
		useConversationStore.setState({ messages: [message("1", "user", "hi")] });
		render(<ContextManagementPanel />);

		const disabled = screen.getByRole("button", {
			name: "Compress context",
		}) as HTMLButtonElement;
		expect(disabled.disabled).toBe(true);
		expect(disabled.getAttribute("title")).toBe("Needs at least 4 messages");
	});

	it("guides empty and unselected conversations", () => {
		useConversationStore.setState({ messages: [] });
		const first = render(<ContextManagementPanel />);
		expect(screen.getByText(/No messages yet/)).toBeDefined();
		first.unmount();

		useConversationStore.setState({ activeId: null });
		render(<ContextManagementPanel />);
		expect(screen.getByText(/Select or start a conversation/)).toBeDefined();
	});

	it("opens display settings from the context meter", () => {
		// The panel does not embed the reorder UI; it jumps to Settings so the
		// preview and the live meter stay on one preference snapshot.
		render(<ContextManagementPanel />);

		fireEvent.click(screen.getByRole("button", { name: "Customize display" }));

		expect(useSettingsStore.getState().settingsTab).toBe("context-panel");
		expect(useWorkspaceStore.getState().activeTab).toBe("settings");
	});

	it("promotes remaining tokens when that metric is the main figure", () => {
		useConversationStore.setState({ messages: snapshotMessages() });
		useSettingsStore.setState({ contextMeterPrimary: "remaining" });

		render(<ContextManagementPanel />);

		expect(screen.getByText("996 remaining")).toBeDefined();
		expect(screen.getByText("0.4% of window")).toBeDefined();
	});

	it("uses catalog metadata for the window percentage", () => {
		useConversationStore.setState({ messages: snapshotMessages() });
		setContextWindow(undefined);
		useModelMetadataStore.setState({
			recordsByProvider: {
				"models-dev": [{ id: "gpt-test", contextWindow: 2000 }],
			},
		});

		render(<ContextManagementPanel />);

		expect(screen.getByText("0.2%")).toBeDefined();
		expect(screen.getByText("1,996 tokens remaining")).toBeDefined();
	});

	it("explains when the context window is unknown", () => {
		useConversationStore.setState({ messages: snapshotMessages() });
		setContextWindow(undefined);

		render(<ContextManagementPanel />);

		expect(screen.getByText(/Context window unknown/)).toBeDefined();
	});
});

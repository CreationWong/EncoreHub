import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamToolCall } from "../../services/chat";
import type { Conversation, Message } from "../../services/conversation";

let feedState: {
	activeId: string | null;
	conversations: Conversation[];
	messages: Message[];
	streaming: boolean;
	streamingContent: string;
	streamingReasoning: string;
	streamingDurationMs: number;
	streamingToolCalls: StreamToolCall[];
	scrollPositions: Record<string, number>;
	setConversationScrollPosition: (id: string, scrollTop: number) => void;
};

vi.mock("../../stores/conversationStore", () => {
	const hook = <T,>(selector: (state: typeof feedState) => T): T =>
		selector(feedState);
	hook.getState = () => feedState;
	return { useConversationStore: hook };
});

import MessageFeed from "./MessageFeed";

let animationFrames: FrameRequestCallback[];

function flushAnimationFrames() {
	act(() => {
		while (animationFrames.length > 0) {
			const callbacks = animationFrames.splice(0);
			for (const callback of callbacks) callback(0);
		}
	});
}

function setScrollerMetrics(
	scroller: HTMLElement,
	metrics: { clientHeight: number; scrollHeight: () => number },
) {
	Object.defineProperty(scroller, "clientHeight", {
		configurable: true,
		get: () => metrics.clientHeight,
	});
	Object.defineProperty(scroller, "scrollHeight", {
		configurable: true,
		get: metrics.scrollHeight,
	});
}

function message(
	id: string,
	role: Message["role"],
	content: string,
	overrides: Partial<Message> = {},
): Message {
	return {
		id,
		role,
		content,
		parent_id: null,
		tool_calls: [],
		status: "completed",
		created_at: "",
		...overrides,
	};
}

beforeEach(() => {
	animationFrames = [];
	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
		animationFrames.push(callback);
		return animationFrames.length;
	});
	vi.stubGlobal("cancelAnimationFrame", vi.fn());
	Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
		configurable: true,
		value: vi.fn(),
	});
	feedState = {
		activeId: "c1",
		conversations: [],
		messages: [],
		streaming: false,
		streamingContent: "",
		streamingReasoning: "",
		streamingDurationMs: 0,
		streamingToolCalls: [],
		scrollPositions: {},
		setConversationScrollPosition: vi.fn((id, scrollTop) => {
			feedState.scrollPositions[id] = scrollTop;
		}),
	};
});

describe("MessageFeed character opening", () => {
	it("shows the saved opening message and snapshot identity before the first turn", () => {
		feedState.conversations = [
			{
				id: "c1",
				title: "New Chat",
				provider: "openai",
				model: "gpt-4.1",
				character_id: "archivist",
				character_version: 2,
				character_snapshot: {
					name: "Saved archivist",
					avatar: "",
					description: "",
					system_prompt: "",
					opening_message: "What should we inspect?",
					tags: [],
				},
				message_count: 0,
				created_at: "",
				updated_at: "",
			},
		];
		render(<MessageFeed />);

		expect(screen.getByText("Saved archivist")).toBeDefined();
		expect(screen.getByText("What should we inspect?")).toBeDefined();
		expect(screen.queryByText("No messages yet.")).toBeNull();
	});
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("MessageFeed reasoning expansion", () => {
	it("loads historical reasoning collapsed", () => {
		feedState.messages = [
			message("user-1", "user", "question"),
			message("assistant-1", "assistant", "answer", {
				parent_id: "user-1",
				reasoning: "historical reasoning",
			}),
		];
		render(<MessageFeed />);

		expect(
			screen
				.getByRole("button", { name: "Processed" })
				.getAttribute("aria-expanded"),
		).toBe("false");
		expect(screen.queryByText("historical reasoning")).toBeNull();
	});

	it("preserves the default expanded state when streaming completes", async () => {
		feedState.messages = [message("user-1", "user", "question")];
		feedState.streaming = true;
		feedState.streamingContent = "answer starting";
		feedState.streamingReasoning = "live reasoning";
		const { rerender } = render(<MessageFeed />);

		expect(screen.getByText("live reasoning")).toBeDefined();
		await waitFor(() =>
			expect(
				screen
					.getByRole("button", { name: "Thinking" })
					.getAttribute("aria-expanded"),
			).toBe("true"),
		);

		feedState.messages = [
			message("user-1", "user", "question"),
			message("assistant-1", "assistant", "final answer", {
				parent_id: "user-1",
				reasoning: "live reasoning",
			}),
		];
		feedState.streaming = false;
		feedState.streamingContent = "";
		feedState.streamingReasoning = "";
		rerender(<MessageFeed />);

		expect(
			screen
				.getByRole("button", { name: "Processed" })
				.getAttribute("aria-expanded"),
		).toBe("true");
		expect(screen.getByText("live reasoning")).toBeDefined();
	});

	it("preserves a manual collapse when streaming completes", () => {
		feedState.messages = [message("user-1", "user", "question")];
		feedState.streaming = true;
		feedState.streamingReasoning = "live reasoning";
		const { rerender } = render(<MessageFeed />);
		fireEvent.click(screen.getByRole("button", { name: "Thinking" }));
		expect(screen.queryByText("live reasoning")).toBeNull();

		feedState.messages = [
			message("user-1", "user", "question"),
			message("assistant-1", "assistant", "final answer", {
				parent_id: "user-1",
				reasoning: "live reasoning",
			}),
		];
		feedState.streaming = false;
		feedState.streamingReasoning = "";
		rerender(<MessageFeed />);

		expect(
			screen
				.getByRole("button", { name: "Processed" })
				.getAttribute("aria-expanded"),
		).toBe("false");
		expect(screen.queryByText("live reasoning")).toBeNull();
	});
});

describe("MessageFeed document layout", () => {
	it("uses the 1080px document width and stable empty streaming reply", () => {
		feedState.streaming = true;
		const { container } = render(<MessageFeed />);

		expect(container.querySelector(".max-w-\\[1080px\\]")).not.toBeNull();
		expect(screen.getByText("Generating")).toBeDefined();
		expect(screen.getByText("Generating response")).toBeDefined();
	});

	it("derives live token totals and output rate from streamed content", () => {
		feedState.streaming = true;
		feedState.streamingContent = "a".repeat(40);
		feedState.streamingDurationMs = 2000;
		const { rerender } = render(<MessageFeed />);

		expect(screen.getByText("5.0 tokens/s")).toBeDefined();
		expect(screen.getByText("10 tokens")).toBeDefined();
		expect(screen.getByText("2 s")).toBeDefined();

		feedState.streamingContent = "a".repeat(80);
		rerender(<MessageFeed />);

		expect(screen.getByText("10.0 tokens/s")).toBeDefined();
		expect(screen.getByText("20 tokens")).toBeDefined();
	});

	it("does not show a zero-duration placeholder before telemetry arrives", () => {
		feedState.streaming = true;
		feedState.streamingContent = "partial";
		render(<MessageFeed />);

		expect(screen.queryByText("0 ms")).toBeNull();
		expect(screen.queryByText(/tokens\/s/)).toBeNull();
	});
});

describe("MessageFeed scroll control", () => {
	it("auto-follows streaming updates only while within 96px of the bottom", () => {
		let scrollHeight = 1000;
		feedState.streaming = true;
		const { rerender } = render(<MessageFeed />);
		const scroller = screen.getByTestId("message-feed-scroller");
		setScrollerMetrics(scroller, {
			clientHeight: 400,
			scrollHeight: () => scrollHeight,
		});
		flushAnimationFrames();
		expect(scroller.scrollTop).toBe(600);

		scroller.scrollTop = 520;
		fireEvent.scroll(scroller);
		flushAnimationFrames();
		scrollHeight = 1100;
		feedState.streamingContent = "next token";
		rerender(<MessageFeed />);
		flushAnimationFrames();
		expect(scroller.scrollTop).toBe(700);

		scroller.scrollTop = 360;
		fireEvent.scroll(scroller);
		flushAnimationFrames();
		expect(
			screen.getByRole("button", { name: "Back to latest" }),
		).toBeDefined();

		scrollHeight = 1200;
		feedState.streamingContent = "next token after reading upward";
		rerender(<MessageFeed />);
		flushAnimationFrames();
		expect(scroller.scrollTop).toBe(360);
	});

	it("returns to the latest message with a fixed-size control", () => {
		let scrollHeight = 1000;
		const { rerender } = render(<MessageFeed />);
		const scroller = screen.getByTestId("message-feed-scroller");
		setScrollerMetrics(scroller, {
			clientHeight: 400,
			scrollHeight: () => scrollHeight,
		});
		flushAnimationFrames();

		scroller.scrollTop = 240;
		fireEvent.scroll(scroller);
		flushAnimationFrames();
		const button = screen.getByRole("button", { name: "Back to latest" });
		expect(button.className).toContain("h-9");
		expect(button.className).toContain("w-9");

		scrollHeight = 1040;
		rerender(<MessageFeed />);
		fireEvent.click(button);
		flushAnimationFrames();
		expect(scroller.scrollTop).toBe(640);
		expect(screen.queryByRole("button", { name: "Back to latest" })).toBeNull();
	});

	it("restores independent scroll positions when switching conversations", () => {
		feedState.scrollPositions = { c1: 240, c2: 80 };
		const { rerender } = render(<MessageFeed />);
		const scroller = screen.getByTestId("message-feed-scroller");
		setScrollerMetrics(scroller, {
			clientHeight: 400,
			scrollHeight: () => 1000,
		});
		flushAnimationFrames();
		expect(scroller.scrollTop).toBe(240);

		feedState.activeId = "c2";
		rerender(<MessageFeed />);
		flushAnimationFrames();
		expect(scroller.scrollTop).toBe(80);

		feedState.activeId = "c1";
		rerender(<MessageFeed />);
		flushAnimationFrames();
		expect(scroller.scrollTop).toBe(240);
	});

	it("throttles repeated scroll position writes to one animation frame", () => {
		render(<MessageFeed />);
		const scroller = screen.getByTestId("message-feed-scroller");
		setScrollerMetrics(scroller, {
			clientHeight: 400,
			scrollHeight: () => 1000,
		});
		flushAnimationFrames();
		vi.mocked(feedState.setConversationScrollPosition).mockClear();

		scroller.scrollTop = 300;
		fireEvent.scroll(scroller);
		scroller.scrollTop = 280;
		fireEvent.scroll(scroller);
		expect(feedState.setConversationScrollPosition).not.toHaveBeenCalled();

		flushAnimationFrames();
		expect(feedState.setConversationScrollPosition).toHaveBeenCalledTimes(1);
		expect(feedState.setConversationScrollPosition).toHaveBeenLastCalledWith(
			"c1",
			280,
		);
	});
});

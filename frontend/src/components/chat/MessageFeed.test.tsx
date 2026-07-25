import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamToolCall } from "../../services/chat";
import type { Message } from "../../services/conversation";

let feedState: {
	messages: Message[];
	streaming: boolean;
	streamingContent: string;
	streamingReasoning: string;
	streamingToolCalls: StreamToolCall[];
};

vi.mock("../../stores/conversationStore", () => ({
	useConversationStore: <T,>(selector: (state: typeof feedState) => T): T =>
		selector(feedState),
}));

import MessageFeed from "./MessageFeed";

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
	Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
		configurable: true,
		value: vi.fn(),
	});
	feedState = {
		messages: [],
		streaming: false,
		streamingContent: "",
		streamingReasoning: "",
		streamingToolCalls: [],
	};
});

afterEach(cleanup);

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
});

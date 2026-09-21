import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Conversation, Message } from "../../services/conversation";
import { useMultiChatStore } from "../../stores/multiChatStore";
import GroupChatView from "./GroupChatView";

const conversation: Conversation = {
	id: "group-1",
	title: "小队",
	provider: "openai",
	model: "gpt-test",
	message_count: 2,
	created_at: "2026-09-21T00:00:00Z",
	updated_at: "2026-09-21T00:00:00Z",
	reply_mode: "sequential",
	participants: [
		{
			character_id: "char-a",
			character_version: 1,
			position: 0,
			character_snapshot: {
				name: "建模bot",
				avatar: "",
				description: "",
				system_prompt: "",
				opening_message: "",
				tags: [],
			},
			provider: "openai",
			model: "gpt-test",
		},
		{
			character_id: "char-b",
			character_version: 1,
			position: 1,
			character_snapshot: {
				name: "论文挑刺",
				avatar: "",
				description: "",
				system_prompt: "",
				opening_message: "",
				tags: [],
			},
			provider: "openai",
			model: "gpt-test",
		},
	],
};

function message(id: string, role: Message["role"], content: string): Message {
	return {
		id,
		role,
		content,
		parent_id: null,
		tool_calls: [],
		status: "completed",
		created_at: "2026-09-21T00:00:00Z",
	};
}

function sizeScroller(
	scroller: HTMLElement,
	scrollHeight: number,
	clientHeight: number,
) {
	Object.defineProperty(scroller, "scrollHeight", {
		value: scrollHeight,
		configurable: true,
	});
	Object.defineProperty(scroller, "clientHeight", {
		value: clientHeight,
		configurable: true,
	});
}

beforeEach(() => {
	useMultiChatStore.setState({
		conversations: [conversation],
		listLoading: false,
		activeId: "group-1",
		participants: conversation.participants ?? [],
		replyMode: "sequential",
		groupSettings: null,
		messages: [
			message("m1", "user", "大家好"),
			message("m2", "assistant", "收到"),
		],
		segments: [],
		runnerState: "idle",
		pending: 0,
		eventsController: null,
	});
});

afterEach(cleanup);

describe("GroupChatView scrolling", () => {
	it("keeps the reader's scroll position while new messages arrive", async () => {
		render(<GroupChatView />);
		const scroller = screen.getByTestId("group-transcript-scroller");
		// Let the open-conversation jump to the bottom settle first.
		await act(() => new Promise((resolve) => setTimeout(resolve, 30)));

		sizeScroller(scroller, 1000, 300);
		scroller.scrollTop = 100;
		fireEvent.scroll(scroller);
		expect(
			screen.getByRole("button", { name: "Scroll to bottom" }),
		).toBeDefined();

		// The background runner appends a message while the reader is up in
		// the history; the transcript must not yank them back down.
		act(() => {
			useMultiChatStore.setState((state) => ({
				messages: [...state.messages, message("m3", "assistant", "补充")],
			}));
		});
		expect(scroller.scrollTop).toBe(100);
	});

	it("offers a button that returns to the newest message", async () => {
		render(<GroupChatView />);
		const scroller = screen.getByTestId("group-transcript-scroller");
		await act(() => new Promise((resolve) => setTimeout(resolve, 30)));

		sizeScroller(scroller, 1000, 300);
		scroller.scrollTop = 50;
		fireEvent.scroll(scroller);

		fireEvent.click(screen.getByRole("button", { name: "Scroll to bottom" }));
		expect(scroller.scrollTop).toBe(700);
		expect(
			screen.queryByRole("button", { name: "Scroll to bottom" }),
		).toBeNull();
	});
});

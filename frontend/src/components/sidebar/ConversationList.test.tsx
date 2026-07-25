import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Conversation } from "../../services/conversation";

const confirmAsk = vi.fn();
vi.mock("../../stores/confirmStore", () => ({
	confirm: { ask: (...args: unknown[]) => confirmAsk(...args) },
}));

const renameConversation = vi.fn();
const deleteConversation = vi.fn();
const selectConversation = vi.fn();
const newConversation = vi.fn();
const loadList = vi.fn();
const generateTitle = vi.fn();

let conversationState: {
	conversations: Conversation[];
	activeId: string | null;
	listLoading: boolean;
	listError: string | null;
	loadList: typeof loadList;
	selectConversation: typeof selectConversation;
	newConversation: typeof newConversation;
	deleteConversation: typeof deleteConversation;
	renameConversation: typeof renameConversation;
	generateTitle: typeof generateTitle;
};

vi.mock("../../stores/conversationStore", () => ({
	useConversationStore: (
		selector: (state: typeof conversationState) => unknown,
	) => selector(conversationState),
}));

import ConversationList from "./ConversationList";

function conversation(
	id = "c1",
	title = "Original",
	updatedAt = "2026-07-25T08:00:00+08:00",
): Conversation {
	return {
		id,
		title,
		provider: "openai",
		model: "gpt-4o",
		message_count: 0,
		created_at: updatedAt,
		updated_at: updatedAt,
	};
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-07-25T12:00:00+08:00"));
	confirmAsk.mockReset().mockResolvedValue(true);
	renameConversation.mockReset().mockResolvedValue(undefined);
	deleteConversation.mockReset().mockResolvedValue(undefined);
	selectConversation.mockReset().mockResolvedValue(undefined);
	newConversation.mockReset().mockResolvedValue("new-conversation");
	loadList.mockReset().mockResolvedValue(undefined);
	generateTitle.mockReset().mockResolvedValue(undefined);
	conversationState = {
		conversations: [conversation()],
		activeId: "c1",
		listLoading: false,
		listError: null,
		loadList,
		selectConversation,
		newConversation,
		deleteConversation,
		renameConversation,
		generateTitle,
	};
});

afterEach(() => {
	vi.useRealTimers();
	cleanup();
});

function openActions() {
	fireEvent.click(screen.getByRole("button", { name: "Actions for Original" }));
}

describe("ConversationList content", () => {
	it("shows grouped conversations with model metadata and an active marker", () => {
		render(<ConversationList />);

		expect(screen.getByRole("heading", { name: "Today" })).toBeDefined();
		expect(screen.getByText("Original")).toBeDefined();
		expect(screen.getByText("gpt-4o")).toBeDefined();
		expect(
			screen
				.getByRole("button", { name: /Original gpt-4o/ })
				.getAttribute("aria-current"),
		).toBe("page");
		expect(
			screen.queryByRole("button", { name: /delete conversation/i }),
		).toBeNull();
	});

	it("creates and selects conversations through their visible commands", () => {
		render(<ConversationList />);
		fireEvent.click(screen.getByRole("button", { name: "New chat" }));
		fireEvent.click(screen.getByRole("button", { name: /Original gpt-4o/ }));

		expect(newConversation).toHaveBeenCalledTimes(1);
		expect(selectConversation).toHaveBeenCalledWith("c1");
	});
});

describe("ConversationList actions", () => {
	it("keeps double-click rename and exposes rename through the menu", () => {
		render(<ConversationList />);
		fireEvent.doubleClick(screen.getByText("Original"));
		expect(screen.getByDisplayValue("Original")).toBeDefined();

		cleanup();
		render(<ConversationList />);
		openActions();
		fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
		expect(screen.getByDisplayValue("Original")).toBeDefined();
	});

	it("commits rename with Enter and cancels with Escape", () => {
		const { rerender } = render(<ConversationList />);
		fireEvent.doubleClick(screen.getByText("Original"));
		let input = screen.getByDisplayValue("Original");
		fireEvent.change(input, { target: { value: "Renamed" } });
		fireEvent.keyDown(input, { key: "Enter" });
		expect(renameConversation).toHaveBeenCalledWith("c1", "Renamed");

		conversationState.conversations = [conversation("c1", "Original")];
		rerender(<ConversationList />);
		fireEvent.doubleClick(screen.getByText("Original"));
		input = screen.getByDisplayValue("Original");
		fireEvent.change(input, { target: { value: "Cancelled" } });
		fireEvent.keyDown(input, { key: "Escape" });
		expect(renameConversation).not.toHaveBeenCalledWith("c1", "Cancelled");
	});

	it("regenerates a title with explicit force semantics", () => {
		render(<ConversationList />);
		openActions();
		fireEvent.click(screen.getByRole("menuitem", { name: "Regenerate title" }));
		expect(generateTitle).toHaveBeenCalledWith("c1", true);
	});

	it("deletes only after confirmation", async () => {
		confirmAsk.mockResolvedValueOnce(false);
		render(<ConversationList />);
		openActions();
		fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
		await vi.waitFor(() => expect(confirmAsk).toHaveBeenCalled());
		expect(deleteConversation).not.toHaveBeenCalled();
	});

	it("deletes the selected conversation after confirmation", async () => {
		render(<ConversationList />);
		openActions();
		fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
		await vi.waitFor(() =>
			expect(deleteConversation).toHaveBeenCalledWith("c1"),
		);
	});

	it("opens upward when the trigger is near the window bottom", () => {
		render(<ConversationList />);
		const trigger = screen.getByRole("button", {
			name: "Actions for Original",
		});
		vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
			bottom: window.innerHeight - 10,
		} as DOMRect);
		fireEvent.click(trigger);

		expect(screen.getByRole("menu").className).toContain("bottom-full");
	});

	it("closes the menu on Escape and restores trigger focus", () => {
		render(<ConversationList />);
		const trigger = screen.getByRole("button", {
			name: "Actions for Original",
		});
		fireEvent.click(trigger);
		fireEvent.keyDown(window, { key: "Escape" });

		expect(screen.queryByRole("menu")).toBeNull();
		expect(document.activeElement).toBe(trigger);
	});
});

describe("ConversationList states", () => {
	it("renders loading, empty, and recoverable error states", () => {
		conversationState.conversations = [];
		conversationState.listLoading = true;
		const { rerender } = render(<ConversationList />);
		expect(screen.getByLabelText("Loading conversations")).toBeDefined();

		conversationState.listLoading = false;
		rerender(<ConversationList />);
		expect(screen.getByText("No conversations yet.")).toBeDefined();

		conversationState.listError = "Failed to load conversations";
		rerender(<ConversationList />);
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		expect(loadList).toHaveBeenCalledTimes(1);
	});
});

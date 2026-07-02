import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockConfirmAsk = vi.fn().mockResolvedValue(true);
vi.mock("../../stores/confirmStore", () => ({
	useConfirmStore: {},
	confirm: { ask: (...args: unknown[]) => mockConfirmAsk(...args) },
}));

// Mock the stores so we can assert what the component calls without touching
// network or the real store implementation.
const renameConversation = vi.fn();
const deleteConversation = vi.fn();
const selectConversation = vi.fn();
const newConversation = vi.fn();
const loadList = vi.fn();
const toggleSidebar = vi.fn();

const conv = {
	id: "c1",
	title: "Original",
	provider: "",
	model: "",
	message_count: 0,
	created_at: "",
	updated_at: "",
};

vi.mock("../../stores/conversationStore", () => ({
	useConversationStore: <T,>(sel: (s: unknown) => T): T =>
		sel({
			conversations: [conv],
			activeId: null,
			loadList,
			selectConversation,
			newConversation,
			deleteConversation,
			renameConversation,
		}),
}));

vi.mock("../../stores/settingsStore", () => ({
	useSettingsStore: <T,>(sel: (s: unknown) => T): T =>
		sel({ sidebarOpen: true, toggleSidebar }),
}));

import ConversationList from "./ConversationList";

beforeEach(() => {
	renameConversation.mockReset();
	deleteConversation.mockReset();
	selectConversation.mockReset();
	loadList.mockReset();
	conv.title = "Original";
});

afterEach(cleanup);

function startEdit() {
	const titleBtn = screen.getByText("Original");
	fireEvent.doubleClick(titleBtn);
}

describe("ConversationList rename", () => {
	it("double-click opens an input pre-filled with the title", () => {
		render(<ConversationList />);
		startEdit();
		const input = screen.getByDisplayValue("Original") as HTMLInputElement;
		expect(input).toBeDefined();
	});

	it("Enter commits the new title", () => {
		render(<ConversationList />);
		startEdit();
		const input = screen.getByDisplayValue("Original") as HTMLInputElement;
		fireEvent.change(input, { target: { value: "Renamed" } });
		fireEvent.keyDown(input, { key: "Enter" });
		expect(renameConversation).toHaveBeenCalledWith("c1", "Renamed");
	});

	it("Escape cancels without calling rename", () => {
		render(<ConversationList />);
		startEdit();
		const input = screen.getByDisplayValue("Original") as HTMLInputElement;
		fireEvent.change(input, { target: { value: "Should not stick" } });
		fireEvent.keyDown(input, { key: "Escape" });
		expect(renameConversation).not.toHaveBeenCalled();
	});

	it("blur commits with the current draft", () => {
		render(<ConversationList />);
		startEdit();
		const input = screen.getByDisplayValue("Original") as HTMLInputElement;
		fireEvent.change(input, { target: { value: "Via Blur" } });
		fireEvent.blur(input);
		expect(renameConversation).toHaveBeenCalledWith("c1", "Via Blur");
	});

	it("delete button only fires when the confirm dialog is accepted", async () => {
		mockConfirmAsk.mockResolvedValueOnce(false);
		render(<ConversationList />);
		// Trash icon button: locate by parent .group + svg query
		const trashBtn = screen
			.getAllByRole("button")
			.find((b) => b.querySelector('svg[class*="lucide-trash"]'));
		// Fallback: last button in the row contains the Trash svg.
		const buttons = screen.getAllByRole("button");
		fireEvent.click(trashBtn ?? buttons[buttons.length - 1]);
		await vi.waitFor(() => {
			expect(mockConfirmAsk).toHaveBeenCalled();
		});
		expect(deleteConversation).not.toHaveBeenCalled();
	});
});

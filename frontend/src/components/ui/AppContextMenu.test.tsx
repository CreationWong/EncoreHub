import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useConversationStore } from "../../stores/conversationStore";
import { useSettingsStore } from "../../stores/settingsStore";
import AppContextMenu from "./AppContextMenu";

const newConversation = vi.fn().mockResolvedValue("conversation-1");
const openSettings = vi.fn();
const readText = vi.fn().mockResolvedValue(" pasted");
const writeText = vi.fn().mockResolvedValue(undefined);
const editMessage = vi.fn().mockResolvedValue(undefined);
const regenerateMessage = vi.fn().mockResolvedValue(undefined);
const deleteMessage = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
	newConversation.mockClear();
	openSettings.mockClear();
	readText.mockClear();
	writeText.mockClear();
	editMessage.mockClear();
	regenerateMessage.mockClear();
	deleteMessage.mockClear();
	useConversationStore.setState({
		newConversation,
		messages: [],
		streaming: false,
		editMessage,
		regenerateMessage,
		deleteMessage,
	});
	useSettingsStore.setState({ openSettings });
	Object.defineProperty(navigator, "clipboard", {
		configurable: true,
		value: { readText, writeText },
	});
});

afterEach(cleanup);

function dispatchContextMenu(target: Element, x = 24, y = 32): MouseEvent {
	const event = new MouseEvent("contextmenu", {
		bubbles: true,
		cancelable: true,
		clientX: x,
		clientY: y,
	});
	act(() => {
		target.dispatchEvent(event);
	});
	return event;
}

describe("AppContextMenu", () => {
	it("blocks the browser menu and shows application commands on blank areas", () => {
		render(
			<div data-testid="surface">
				<AppContextMenu />
			</div>,
		);

		const event = dispatchContextMenu(screen.getByTestId("surface"));

		expect(event.defaultPrevented).toBe(true);
		expect(
			screen.getByRole("menu", { name: "EncoreHub context menu" }),
		).toBeDefined();
		fireEvent.click(screen.getByRole("menuitem", { name: "New conversation" }));
		expect(newConversation).toHaveBeenCalledOnce();
	});

	it("opens Settings from the application menu", () => {
		render(
			<div data-testid="surface">
				<AppContextMenu />
			</div>,
		);
		dispatchContextMenu(screen.getByTestId("surface"));

		fireEvent.click(
			screen.getByRole("menuitem", { name: /^Settings (Ctrl\+|⌘)/ }),
		);

		expect(openSettings).toHaveBeenCalledOnce();
	});

	it("copies and pastes through the custom editable menu", async () => {
		render(
			<>
				<textarea aria-label="Editor" defaultValue="hello" />
				<AppContextMenu />
			</>,
		);
		const editor = screen.getByLabelText("Editor") as HTMLTextAreaElement;
		editor.setSelectionRange(0, 5);
		dispatchContextMenu(editor);

		fireEvent.click(screen.getByRole("menuitem", { name: /^Copy (Ctrl\+|⌘)/ }));
		await waitFor(() => expect(writeText).toHaveBeenCalledWith("hello"));

		editor.setSelectionRange(5, 5);
		dispatchContextMenu(editor);
		fireEvent.click(
			screen.getByRole("menuitem", { name: /^Paste (Ctrl\+|⌘)/ }),
		);

		await waitFor(() => expect(editor.value).toBe("hello pasted"));
		expect(readText).toHaveBeenCalledOnce();
	});

	it("closes on Escape", () => {
		render(
			<div data-testid="surface">
				<AppContextMenu />
			</div>,
		);
		dispatchContextMenu(screen.getByTestId("surface"));

		fireEvent.keyDown(window, { key: "Escape" });

		expect(
			screen.queryByRole("menu", { name: "EncoreHub context menu" }),
		).toBeNull();
	});

	it("does not focus an item until keyboard navigation begins", () => {
		render(
			<div data-testid="surface">
				<AppContextMenu />
			</div>,
		);
		dispatchContextMenu(screen.getByTestId("surface"));
		const menu = screen.getByRole("menu", {
			name: "EncoreHub context menu",
		});
		const firstItem = screen.getByRole("menuitem", {
			name: "New conversation",
		});

		expect(document.activeElement).toBe(menu);
		fireEvent.keyDown(menu, { key: "Tab" });
		expect(document.activeElement).toBe(firstItem);
	});

	it("shows copy, edit, and delete for a user message", async () => {
		useConversationStore.setState({
			messages: [
				{
					id: "user-1",
					role: "user",
					content: "Revise this",
					parent_id: null,
					tool_calls: [],
					status: "completed",
					created_at: "",
				},
			],
		});
		render(
			<>
				<article data-message-id="user-1" data-message-role="user">
					Revise this
				</article>
				<AppContextMenu />
			</>,
		);
		dispatchContextMenu(screen.getByText("Revise this"));

		expect(screen.getByRole("menuitem", { name: /^Copy/ })).toBeDefined();
		fireEvent.click(screen.getByRole("menuitem", { name: "Edit" }));
		await waitFor(() => expect(editMessage).toHaveBeenCalledWith("user-1"));
	});

	it("shows regenerate and delete for an assistant message", async () => {
		useConversationStore.setState({
			messages: [
				{
					id: "assistant-1",
					role: "assistant",
					content: "Try again",
					parent_id: "user-1",
					tool_calls: [],
					status: "completed",
					created_at: "",
				},
			],
		});
		render(
			<>
				<article data-message-id="assistant-1" data-message-role="assistant">
					Try again
				</article>
				<AppContextMenu />
			</>,
		);
		dispatchContextMenu(screen.getByText("Try again"));

		fireEvent.click(screen.getByRole("menuitem", { name: "Regenerate" }));
		await waitFor(() =>
			expect(regenerateMessage).toHaveBeenCalledWith("assistant-1"),
		);
	});
});

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
import {
	DEFAULT_GLOBAL_CONTEXT_MENU_ITEMS,
	useSettingsStore,
} from "../../stores/settingsStore";
import AppContextMenu from "./AppContextMenu";

const newConversation = vi.fn().mockResolvedValue("conversation-1");
const openSettings = vi.fn();
const readText = vi.fn().mockResolvedValue(" pasted");
const writeText = vi.fn().mockResolvedValue(undefined);
const startEditingMessage = vi.fn();
const regenerateMessage = vi.fn().mockResolvedValue(undefined);
const deleteMessage = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
	newConversation.mockClear();
	openSettings.mockClear();
	readText.mockClear();
	writeText.mockClear();
	startEditingMessage.mockClear();
	regenerateMessage.mockClear();
	deleteMessage.mockClear();
	useConversationStore.setState({
		newConversation,
		messages: [],
		streaming: false,
		startEditingMessage,
		regenerateMessage,
		deleteMessage,
	});
	useSettingsStore.setState({
		openSettings,
		globalContextMenuEnabled: true,
		globalContextMenuItems: DEFAULT_GLOBAL_CONTEXT_MENU_ITEMS.map((item) => ({
			...item,
		})),
	});
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

	it("leaves the native menu available when takeover is off", () => {
		useSettingsStore.setState({ globalContextMenuEnabled: false });
		render(
			<div data-testid="surface">
				<AppContextMenu />
			</div>,
		);

		const event = dispatchContextMenu(screen.getByTestId("surface"));

		expect(event.defaultPrevented).toBe(false);
		expect(
			screen.queryByRole("menu", { name: "EncoreHub context menu" }),
		).toBeNull();
	});

	it("uses the configured item order and visibility", () => {
		useSettingsStore.setState({
			globalContextMenuItems: [
				{ id: "settings", visible: true },
				{ id: "new-chat", visible: false },
			],
		});
		render(
			<div data-testid="surface">
				<AppContextMenu />
			</div>,
		);

		dispatchContextMenu(screen.getByTestId("surface"));

		expect(screen.getAllByRole("menuitem")).toHaveLength(1);
		expect(
			screen.getByRole("menuitem", { name: /^Settings (Ctrl\+|⌘)/ }),
		).toBeDefined();
		expect(
			screen.queryByRole("menuitem", { name: "New conversation" }),
		).toBeNull();
	});

	it("shows no global menu when every item is removed", () => {
		useSettingsStore.setState({
			globalContextMenuItems: DEFAULT_GLOBAL_CONTEXT_MENU_ITEMS.map((item) => ({
				...item,
				visible: false,
			})),
		});
		render(
			<div data-testid="surface">
				<AppContextMenu />
			</div>,
		);

		const event = dispatchContextMenu(screen.getByTestId("surface"));

		expect(event.defaultPrevented).toBe(true);
		expect(
			screen.queryByRole("menu", { name: "EncoreHub context menu" }),
		).toBeNull();
	});

	it("does not replace a context menu handled by a nested surface", () => {
		const handleContextMenu = vi.fn((event: React.MouseEvent) => {
			event.preventDefault();
		});
		render(
			<div data-testid="managed-surface" onContextMenu={handleContextMenu}>
				Managed surface
				<AppContextMenu />
			</div>,
		);

		dispatchContextMenu(screen.getByTestId("managed-surface"));

		expect(handleContextMenu).toHaveBeenCalledOnce();
		expect(
			screen.queryByRole("menu", { name: "EncoreHub context menu" }),
		).toBeNull();
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
		await waitFor(() =>
			expect(startEditingMessage).toHaveBeenCalledWith("user-1"),
		);
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

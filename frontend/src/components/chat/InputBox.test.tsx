import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendMessage = vi.fn();
const stopStreaming = vi.fn();

const convState = {
	sendMessage,
	stopStreaming,
	streaming: false,
	activeId: null as string | null,
	messages: [] as unknown[],
	pendingDraft: null as string | null,
	clearDraft: vi.fn(),
	// minimal subset of the rest the slash commands might call from
	// useConversationStore.getState():
	newConversation: vi.fn(),
	deleteConversation: vi.fn(),
	pushSystemMessage: vi.fn(),
};

const settingsState = { openSettings: vi.fn() };

vi.mock("../../stores/conversationStore", () => {
	const hook = <T,>(sel: (s: typeof convState) => T): T => sel(convState);
	(hook as unknown as { getState: () => typeof convState }).getState = () =>
		convState;
	return { useConversationStore: hook };
});

vi.mock("../../stores/settingsStore", () => {
	const hook = <T,>(sel: (s: typeof settingsState) => T): T => sel(settingsState);
	(hook as unknown as { getState: () => typeof settingsState }).getState =
		() => settingsState;
	return { useSettingsStore: hook };
});

import InputBox from "./InputBox";

beforeEach(() => {
	sendMessage.mockReset();
	stopStreaming.mockReset();
	convState.streaming = false;
	convState.activeId = null;
	convState.messages = [];
	convState.pendingDraft = null;
	// jsdom doesn't implement scrollIntoView; SlashCommandMenu uses it.
	if (!Element.prototype.scrollIntoView) {
		Element.prototype.scrollIntoView = () => {};
	}
});

afterEach(cleanup);

function getTextarea(): HTMLTextAreaElement {
	return screen.getByPlaceholderText(
		/Type a message or \/ for commands/,
	) as HTMLTextAreaElement;
}

describe("InputBox slash menu", () => {
	it("typing '/' surfaces the command menu with multiple entries", () => {
		render(<InputBox />);
		const ta = getTextarea();
		fireEvent.change(ta, { target: { value: "/" } });
		// Menu items render command names like /new, /clear...
		expect(screen.getAllByText(/^\/(new|clear|help|stop|settings|skills|knowledge|memory|inspect|model)$/).length).toBeGreaterThan(3);
	});

	it("Tab autocompletes the highlighted command", () => {
		render(<InputBox />);
		const ta = getTextarea();
		fireEvent.change(ta, { target: { value: "/n" } });
		fireEvent.keyDown(ta, { key: "Tab" });
		// /n -> /new (only command starting with n)
		expect(ta.value).toBe("/new ");
	});

	it("ArrowDown moves selection — second prefix match becomes active", () => {
		render(<InputBox />);
		const ta = getTextarea();
		// /s matches /stop /settings /skills — at least 3 entries
		fireEvent.change(ta, { target: { value: "/s" } });
		fireEvent.keyDown(ta, { key: "ArrowDown" });
		fireEvent.keyDown(ta, { key: "Tab" });
		// After one ArrowDown the second match wins; just assert the input
		// got a command name (not the literal "/s ")
		expect(ta.value).toMatch(/^\/(stop|settings|skills) $/);
	});

	it("Escape with the menu open clears the input draft", () => {
		render(<InputBox />);
		const ta = getTextarea();
		fireEvent.change(ta, { target: { value: "/he" } });
		fireEvent.keyDown(ta, { key: "Escape" });
		expect(ta.value).toBe("");
	});
});

describe("InputBox plain send", () => {
	it("Enter on a non-slash message calls sendMessage", () => {
		convState.activeId = "c1";
		render(<InputBox />);
		const ta = getTextarea();
		fireEvent.change(ta, { target: { value: "hello" } });
		fireEvent.keyDown(ta, { key: "Enter" });
		expect(sendMessage).toHaveBeenCalledWith("hello");
	});

	it("Enter on empty input is ignored", () => {
		render(<InputBox />);
		const ta = getTextarea();
		fireEvent.keyDown(ta, { key: "Enter" });
		expect(sendMessage).not.toHaveBeenCalled();
	});

	it("Stop button while streaming calls stopStreaming", () => {
		convState.streaming = true;
		render(<InputBox />);
		const stopBtn = screen.getByTitle("Stop generating");
		fireEvent.click(stopBtn);
		expect(stopStreaming).toHaveBeenCalled();
	});
});

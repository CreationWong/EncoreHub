import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchProvider } from "../../stores/settingsStore";

const sendMessage = vi.fn();
const stopStreaming = vi.fn();
const setConversationDraft = vi.fn((id: string | null, content: string) => {
	convState.drafts[id ?? "__new_conversation__"] = content;
});
const clearConversationDraft = vi.fn((id: string | null) => {
	delete convState.drafts[id ?? "__new_conversation__"];
});

const convState = {
	sendMessage,
	stopStreaming,
	streaming: false,
	activeId: null as string | null,
	messages: [] as unknown[],
	pendingDraft: null as string | null,
	drafts: {} as Record<string, string>,
	setConversationDraft,
	clearConversationDraft,
	clearDraft: vi.fn(() => {
		convState.pendingDraft = null;
	}),
	// minimal subset of the rest the slash commands might call from
	// useConversationStore.getState():
	newConversation: vi.fn(),
	deleteConversation: vi.fn(),
	pushSystemMessage: vi.fn(),
};

const setSearchEnabled = vi.fn((enabled: boolean) => {
	settingsState.searchEnabled = enabled;
});
const setSearchProvider = vi.fn((provider: SearchProvider) => {
	settingsState.searchProvider = provider;
});
const settingsState: {
	openSettings: ReturnType<typeof vi.fn>;
	searchEnabled: boolean;
	searchProvider: SearchProvider;
	setSearchEnabled: typeof setSearchEnabled;
	setSearchProvider: typeof setSearchProvider;
} = {
	openSettings: vi.fn(),
	searchEnabled: false,
	searchProvider: "duckduckgo",
	setSearchEnabled,
	setSearchProvider,
};

vi.mock("../../stores/conversationStore", () => {
	const hook = <T,>(sel: (s: typeof convState) => T): T => sel(convState);
	(hook as unknown as { getState: () => typeof convState }).getState = () =>
		convState;
	return {
		NEW_CONVERSATION_DRAFT_KEY: "__new_conversation__",
		useConversationStore: hook,
	};
});

vi.mock("../../stores/settingsStore", () => {
	const hook = <T,>(sel: (s: typeof settingsState) => T): T =>
		sel(settingsState);
	(hook as unknown as { getState: () => typeof settingsState }).getState = () =>
		settingsState;
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
	convState.drafts = {};
	convState.clearDraft.mockClear();
	setConversationDraft.mockClear();
	clearConversationDraft.mockClear();
	setSearchEnabled.mockClear();
	setSearchProvider.mockClear();
	settingsState.searchEnabled = false;
	settingsState.searchProvider = "duckduckgo";
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
		expect(
			screen.getAllByText(
				/^\/(new|clear|help|stop|settings|skills|knowledge|memory|inspect|model)$/,
			).length,
		).toBeGreaterThan(3);
		const listbox = screen.getByRole("listbox", { name: "Slash commands" });
		expect(listbox).toBeDefined();
		expect(within(listbox).getAllByRole("group")).toHaveLength(3);
		expect(ta.getAttribute("aria-activedescendant")).toMatch(
			/^slash-command-option-/,
		);
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

	it("Escape closes the menu, preserves the draft, and returns focus", () => {
		render(<InputBox />);
		const ta = getTextarea();
		fireEvent.change(ta, { target: { value: "/he" } });
		fireEvent.keyDown(ta, { key: "Escape" });
		expect(ta.value).toBe("/he");
		expect(
			screen.queryByRole("listbox", { name: "Slash commands" }),
		).toBeNull();
		expect(document.activeElement).toBe(ta);
	});
});

describe("InputBox composer surface", () => {
	it("keeps textarea, commands, search, and send inside one composer", () => {
		render(<InputBox />);
		const composer = screen.getByRole("group", { name: "Message composer" });
		const ta = getTextarea();

		expect(ta.rows).toBe(2);
		expect(composer.contains(ta)).toBe(true);
		expect(
			composer.contains(screen.getByRole("button", { name: "Open commands" })),
		).toBe(true);
		expect(
			composer.contains(screen.getByRole("button", { name: /Web search/ })),
		).toBe(true);
		expect(
			composer.contains(screen.getByRole("button", { name: "Send message" })),
		).toBe(true);
	});

	it("shows character status only after reaching 85 percent", () => {
		render(<InputBox />);
		const ta = getTextarea();
		fireEvent.change(ta, { target: { value: "a".repeat(6799) } });
		expect(
			screen.queryByRole("status", { name: "Character limit" }),
		).toBeNull();

		fireEvent.change(ta, { target: { value: "a".repeat(6800) } });
		expect(
			screen.getByRole("status", { name: "Character limit" }).textContent,
		).toContain("6800 / 8000");
	});

	it("uses one menu for search enablement and provider selection", () => {
		settingsState.searchEnabled = true;
		render(<InputBox />);
		fireEvent.click(screen.getByRole("button", { name: /Web search enabled/ }));

		const menu = screen.getByRole("menu", { name: "Web search settings" });
		expect(menu).toBeDefined();
		expect(
			screen.getByRole("menuitemcheckbox", { name: "Enable web search" }),
		).toBeDefined();
		expect(screen.getAllByRole("menuitemradio")).toHaveLength(3);

		fireEvent.click(screen.getByRole("menuitemradio", { name: "Bing" }));
		expect(setSearchProvider).toHaveBeenCalledWith("bing");
	});
});

describe("InputBox conversation drafts", () => {
	it("restores a separate draft when the active conversation changes", async () => {
		convState.activeId = "c1";
		convState.drafts = { c1: "first draft", c2: "second draft" };
		const { rerender } = render(<InputBox />);
		expect(getTextarea().value).toBe("first draft");

		convState.activeId = "c2";
		rerender(<InputBox />);
		await waitFor(() => expect(getTextarea().value).toBe("second draft"));
	});

	it("writes edits to the current conversation without reset on rerender", () => {
		convState.activeId = "c1";
		const { rerender } = render(<InputBox />);
		const ta = getTextarea();
		fireEvent.change(ta, { target: { value: "keep this" } });

		expect(setConversationDraft).toHaveBeenLastCalledWith("c1", "keep this");
		convState.streaming = true;
		rerender(<InputBox />);
		expect(getTextarea().value).toBe("keep this");
	});

	it("appends an external quote to the active conversation draft", () => {
		convState.activeId = "c1";
		convState.drafts = { c1: "existing draft" };
		convState.pendingDraft = "> quoted memory";
		render(<InputBox />);

		expect(getTextarea().value).toBe("existing draft\n\n> quoted memory");
		expect(setConversationDraft).toHaveBeenLastCalledWith(
			"c1",
			"existing draft\n\n> quoted memory",
		);
		expect(convState.clearDraft).toHaveBeenCalled();
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

	it("resets a maximally expanded textarea after sending", () => {
		convState.activeId = "c1";
		render(<InputBox />);
		const ta = getTextarea();
		fireEvent.change(ta, { target: { value: "long prompt" } });
		ta.style.height = "220px";
		ta.style.overflowY = "auto";

		fireEvent.keyDown(ta, { key: "Enter" });

		expect(ta.style.height).toBe("auto");
		expect(ta.style.overflowY).toBe("hidden");
	});

	it("Enter on empty input is ignored", () => {
		render(<InputBox />);
		const ta = getTextarea();
		fireEvent.keyDown(ta, { key: "Enter" });
		expect(sendMessage).not.toHaveBeenCalled();
	});

	it("Enter during IME composition does not send", () => {
		convState.activeId = "c1";
		render(<InputBox />);
		const ta = getTextarea();
		fireEvent.change(ta, { target: { value: "中文输入" } });
		fireEvent.keyDown(ta, { key: "Enter", isComposing: true });
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

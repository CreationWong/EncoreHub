/** Verifies composer interaction, drafts, tools, and attachment-aware sends. */

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
	conversations: [] as Array<{
		id: string;
		provider: string;
		model: string;
	}>,
	messages: [] as unknown[],
	pendingDraft: null as string | null,
	drafts: {} as Record<string, string>,
	setConversationDraft,
	clearConversationDraft,
	clearDraft: vi.fn(() => {
		convState.pendingDraft = null;
	}),
};

const setSearchEnabled = vi.fn((enabled: boolean) => {
	settingsState.searchEnabled = enabled;
});
const setDeepThinking = vi.fn((enabled: boolean) => {
	settingsState.deepThinking = enabled;
});
const toastInfo = vi.fn();
const settingsState: {
	openSettings: ReturnType<typeof vi.fn>;
	provider: string;
	model: string;
	searchEnabled: boolean;
	searchProvider: SearchProvider;
	customSearchSettings: { name: string };
	deepThinking: boolean;
	setSearchEnabled: typeof setSearchEnabled;
	setDeepThinking: typeof setDeepThinking;
} = {
	openSettings: vi.fn(),
	provider: "openai",
	model: "gpt-4o",
	searchEnabled: false,
	searchProvider: "duckduckgo",
	customSearchSettings: { name: "Custom search" },
	deepThinking: false,
	setSearchEnabled,
	setDeepThinking,
};
const providerState = {
	profiles: [] as Array<{
		id: string;
		model_configs?: Array<{
			id: string;
			capabilities?: Array<"web" | "reasoning">;
			context_window?: number;
		}>;
	}>,
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

vi.mock("../../stores/providerStore", () => ({
	useProviderStore: <T,>(selector: (state: typeof providerState) => T): T =>
		selector(providerState),
}));

vi.mock("../../stores/toastStore", () => ({
	toast: { info: (...args: unknown[]) => toastInfo(...args) },
}));

import InputBox from "./InputBox";

beforeEach(() => {
	sendMessage.mockReset();
	stopStreaming.mockReset();
	convState.streaming = false;
	convState.activeId = null;
	convState.conversations = [];
	convState.messages = [];
	convState.pendingDraft = null;
	convState.drafts = {};
	convState.clearDraft.mockClear();
	setConversationDraft.mockClear();
	clearConversationDraft.mockClear();
	setSearchEnabled.mockClear();
	settingsState.openSettings.mockClear();
	setDeepThinking.mockClear();
	settingsState.searchEnabled = false;
	settingsState.searchProvider = "duckduckgo";
	settingsState.deepThinking = false;
	settingsState.provider = "openai";
	settingsState.model = "gpt-4o";
	providerState.profiles = [];
	toastInfo.mockReset();
});

afterEach(cleanup);

function getTextarea(): HTMLTextAreaElement {
	return screen.getByPlaceholderText("Type a message") as HTMLTextAreaElement;
}

describe("InputBox slash tool requests", () => {
	it("shows only callable tools and completes the selected tool", () => {
		render(<InputBox />);
		const textarea = getTextarea();
		fireEvent.change(textarea, { target: { value: "/" } });

		const menu = screen.getByRole("listbox", { name: "Slash tools" });
		expect(within(menu).getByText("/web_search")).toBeTruthy();
		expect(within(menu).queryByText("/settings")).toBeNull();
		fireEvent.keyDown(textarea, { key: "Enter" });
		expect(textarea.value).toBe("/web_search ");
		expect(sendMessage).not.toHaveBeenCalled();
	});

	it("sends a completed slash tool request to the Gateway", async () => {
		render(<InputBox />);
		const textarea = getTextarea();
		fireEvent.change(textarea, {
			target: { value: "/web_search 搜索2026消息" },
		});
		fireEvent.keyDown(textarea, { key: "Enter" });

		await waitFor(() =>
			expect(sendMessage).toHaveBeenCalledWith("/web_search 搜索2026消息", {
				attachmentIds: [],
				imageStrategy: undefined,
				modelSupportsVision: false,
				visionModel: undefined,
				visionProvider: "",
			}),
		);
	});

	it("filters the extensible tool menu by prefix", () => {
		render(<InputBox />);
		fireEvent.change(getTextarea(), { target: { value: "/web" } });

		expect(screen.getByRole("listbox", { name: "Slash tools" })).toBeTruthy();
		expect(screen.getByText("/web_search")).toBeTruthy();
	});
});

describe("InputBox composer surface", () => {
	it("keeps textarea, model tools, and send inside one composer", () => {
		render(<InputBox />);
		const composer = screen.getByRole("group", { name: "Message composer" });
		const ta = getTextarea();

		expect(ta.rows).toBe(2);
		expect(composer.contains(ta)).toBe(true);
		expect(
			composer.contains(
				screen.getByRole("group", { name: "Web search controls" }),
			),
		).toBe(true);
		expect(
			composer.contains(screen.getByRole("button", { name: "Send message" })),
		).toBe(true);
	});

	it("hides deep thinking when the active model does not expose it", () => {
		settingsState.deepThinking = true;
		render(<InputBox />);

		expect(screen.queryByRole("button", { name: /deep thinking/i })).toBeNull();
	});

	it("toggles deep thinking without opening another surface", () => {
		providerState.profiles = [
			{
				id: "openai",
				model_configs: [{ id: "gpt-4o", capabilities: ["reasoning"] }],
			},
		];
		render(<InputBox />);
		const button = screen.getByRole("button", {
			name: "Enable deep thinking",
		});
		expect(button.getAttribute("aria-pressed")).toBe("false");
		fireEvent.click(button);
		expect(setDeepThinking).toHaveBeenCalledWith(true);
	});

	it("uses the active conversation model capability instead of the default", () => {
		providerState.profiles = [
			{
				id: "openai",
				model_configs: [
					{ id: "gpt-4o", capabilities: ["reasoning"] },
					{ id: "gpt-4o-mini", capabilities: [] },
				],
			},
		];
		convState.activeId = "ordinary-conversation";
		convState.conversations = [
			{
				id: "ordinary-conversation",
				provider: "openai",
				model: "gpt-4o-mini",
			},
		];

		render(<InputBox />);

		expect(screen.queryByRole("button", { name: /deep thinking/i })).toBeNull();
	});

	it("keeps the focus treatment on the unified composer surface", () => {
		render(<InputBox />);
		const composer = screen.getByRole("group", { name: "Message composer" });
		const ta = getTextarea();
		const composerClasses = composer.className.split(/\s+/);
		const textareaClasses = ta.className.split(/\s+/);

		expect(composerClasses).toContain("focus-within:border-accent");
		expect(textareaClasses).toContain("focus-visible:shadow-none");
	});

	it("uses the active model context size as the input limit", () => {
		providerState.profiles = [
			{
				id: "openai",
				model_configs: [{ id: "gpt-4o", context_window: 100 }],
			},
		];
		render(<InputBox />);
		const ta = getTextarea();
		expect(ta.maxLength).toBe(100);

		fireEvent.change(ta, { target: { value: "a".repeat(84) } });
		expect(screen.queryByRole("status", { name: "Context size" })).toBeNull();

		fireEvent.change(ta, { target: { value: "a".repeat(85) } });
		expect(
			screen.getByRole("status", { name: "Context size" }).textContent,
		).toContain("85 / 100");

		fireEvent.change(ta, { target: { value: "a".repeat(101) } });
		expect(ta.value).toHaveLength(100);
	});

	it("toggles search from the globe and opens settings from the chevron", () => {
		render(<InputBox />);
		const controls = screen.getByRole("group", {
			name: "Web search controls",
		});
		fireEvent.click(
			within(controls).getByRole("button", { name: "Enable web search" }),
		);
		expect(setSearchEnabled).toHaveBeenCalledWith(true);
		expect(
			screen.queryByRole("menu", { name: "Web search settings" }),
		).toBeNull();

		fireEvent.click(
			within(controls).getByRole("button", {
				name: "Open web search settings",
			}),
		);

		const menu = screen.getByRole("menu", { name: "Web search settings" });
		expect(menu).toBeDefined();
		expect(menu.className).toContain("bottom-full");
		expect(menu.className).toContain("mb-1");
		expect(
			screen.getByRole("menuitemcheckbox", { name: "Enable web search" }),
		).toBeDefined();
		expect(screen.getByText("DuckDuckGo")).toBeDefined();

		fireEvent.click(
			screen.getByRole("menuitem", { name: "Configure web search" }),
		);
		expect(settingsState.openSettings).toHaveBeenCalledWith("search");
	});

	it("locks search on and hides external search settings for a native web model", () => {
		settingsState.provider = "ordinary-provider";
		settingsState.model = "ordinary-model";
		convState.activeId = "native-conversation";
		convState.conversations = [
			{
				id: "native-conversation",
				provider: "native-provider",
				model: "online-model",
			},
		];
		providerState.profiles = [
			{
				id: "native-provider",
				model_configs: [
					{
						id: "online-model",
						capabilities: ["web"],
					},
				],
			},
		];

		render(<InputBox />);

		const searchButton = screen.getByRole("button", {
			name: "Built-in web search enabled",
		});
		expect(searchButton.getAttribute("aria-pressed")).toBe("true");
		expect(
			screen.queryByRole("button", { name: "Open web search settings" }),
		).toBeNull();

		fireEvent.click(searchButton);

		expect(setSearchEnabled).not.toHaveBeenCalled();
		expect(toastInfo).toHaveBeenCalledWith(
			"This model has built-in web search, so web search cannot be turned off.",
			5000,
		);
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
		expect(sendMessage).toHaveBeenCalledWith("hello", {
			attachmentIds: [],
			imageStrategy: undefined,
			modelSupportsVision: false,
			visionModel: undefined,
			visionProvider: "",
		});
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

import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Conversation } from "../../services/conversation";

const confirmAsk = vi.fn();
vi.mock("../../stores/confirmStore", () => ({
	confirm: { ask: (...args: unknown[]) => confirmAsk(...args) },
}));

const toggleSidebar = vi.fn();
const generateTitle = vi.fn();
const deleteConversation = vi.fn();

let conversationState: {
	activeId: string | null;
	conversations: Conversation[];
	loading: boolean;
	streaming: boolean;
	generateTitle: typeof generateTitle;
	deleteConversation: typeof deleteConversation;
};

let settingsState: {
	sidebarOpen: boolean;
	toggleSidebar: typeof toggleSidebar;
};

vi.mock("../../stores/conversationStore", () => ({
	useConversationStore: <T,>(
		selector: (state: typeof conversationState) => T,
	): T => selector(conversationState),
}));

vi.mock("../../stores/settingsStore", () => ({
	useSettingsStore: <T,>(selector: (state: typeof settingsState) => T): T =>
		selector(settingsState),
}));

vi.mock("./ProviderSwitcher", () => ({
	default: () => <div data-testid="provider-switcher" />,
}));

import ContextHeader from "./ContextHeader";

function conversation(): Conversation {
	return {
		id: "conversation-1",
		title: "A deliberately long conversation",
		provider: "anthropic",
		model: "claude-sonnet-4",
		message_count: 2,
		created_at: "",
		updated_at: "",
	};
}

beforeEach(() => {
	confirmAsk.mockReset().mockResolvedValue(true);
	toggleSidebar.mockReset();
	generateTitle.mockReset().mockResolvedValue(undefined);
	deleteConversation.mockReset().mockResolvedValue(undefined);
	conversationState = {
		activeId: "conversation-1",
		conversations: [conversation()],
		loading: false,
		streaming: false,
		generateTitle,
		deleteConversation,
	};
	settingsState = {
		sidebarOpen: true,
		toggleSidebar,
	};
});

afterEach(cleanup);

describe("ContextHeader context and layout commands", () => {
	it("shows character, conversation title, then the right-aligned model switcher", () => {
		render(<ContextHeader />);

		const header = screen.getByLabelText("Conversation context");
		const character = screen.getByText("Default character");
		const title = screen.getByRole("heading", {
			name: "A deliberately long conversation",
		});
		const provider = screen.getByTestId("provider-switcher");
		expect(character.compareDocumentPosition(title)).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING,
		);
		expect(title.compareDocumentPosition(provider)).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING,
		);
		expect(provider.parentElement?.className).toContain("ml-auto");
		expect(header.textContent).toContain(
			"Default characterA deliberately long conversation",
		);
		expect(screen.getByText("Default character")).toBeDefined();

		fireEvent.click(screen.getByRole("button", { name: "Close sidebar" }));
		expect(toggleSidebar).toHaveBeenCalledTimes(1);
	});

	it("does not expose the removed focus mode command", () => {
		render(<ContextHeader />);

		expect(screen.queryByRole("button", { name: /focus mode/i })).toBeNull();
	});

	it("shows only real loading and generation states", () => {
		conversationState.loading = true;
		const { rerender } = render(<ContextHeader />);
		expect(screen.getByLabelText("Loading conversation")).toBeDefined();

		conversationState.loading = false;
		conversationState.streaming = true;
		rerender(<ContextHeader />);
		expect(screen.getByLabelText("Generating response")).toBeDefined();

		conversationState.streaming = false;
		rerender(<ContextHeader />);
		expect(screen.queryByLabelText("Generating response")).toBeNull();
	});
});

describe("ContextHeader conversation actions", () => {
	function openActions() {
		fireEvent.click(
			screen.getByRole("button", {
				name: "Actions for A deliberately long conversation",
			}),
		);
	}

	it("regenerates the active conversation title with force semantics", () => {
		render(<ContextHeader />);
		openActions();
		fireEvent.click(screen.getByRole("menuitem", { name: "Regenerate title" }));

		expect(generateTitle).toHaveBeenCalledWith("conversation-1", true);
	});

	it("deletes only after explicit confirmation", async () => {
		confirmAsk.mockResolvedValueOnce(false);
		render(<ContextHeader />);
		openActions();
		fireEvent.click(
			screen.getByRole("menuitem", { name: "Delete conversation" }),
		);
		await waitFor(() => expect(confirmAsk).toHaveBeenCalledTimes(1));
		expect(deleteConversation).not.toHaveBeenCalled();
	});

	it("deletes the active conversation after confirmation", async () => {
		render(<ContextHeader />);
		openActions();
		fireEvent.click(
			screen.getByRole("menuitem", { name: "Delete conversation" }),
		);
		await waitFor(() =>
			expect(deleteConversation).toHaveBeenCalledWith("conversation-1"),
		);
	});

	it("closes on Escape and restores focus to the action trigger", () => {
		render(<ContextHeader />);
		const trigger = screen.getByRole("button", {
			name: "Actions for A deliberately long conversation",
		});
		fireEvent.click(trigger);
		fireEvent.keyDown(window, { key: "Escape" });

		expect(screen.queryByRole("menu")).toBeNull();
		expect(document.activeElement).toBe(trigger);
	});

	it("does not show conversation actions before a conversation exists", () => {
		conversationState.activeId = null;
		conversationState.conversations = [];
		render(<ContextHeader />);

		expect(
			screen.getByRole("heading", { name: "New conversation" }),
		).toBeDefined();
		expect(screen.queryByTitle("Conversation actions")).toBeNull();
	});
});

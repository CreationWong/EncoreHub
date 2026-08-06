import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Conversation } from "../../services/conversation";

const toggleSidebar = vi.fn();
const openCharacter = vi.fn();

let conversationState: {
	activeId: string | null;
	conversations: Conversation[];
	loading: boolean;
	streaming: boolean;
};

let settingsState: {
	sidebarOpen: boolean;
	toggleSidebar: typeof toggleSidebar;
};

let characterState: {
	characters: Array<{
		id: string;
		name: string;
		avatar: string;
		version: number;
	}>;
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

vi.mock("../../stores/characterStore", () => ({
	useCharacterStore: <T,>(selector: (state: typeof characterState) => T): T =>
		selector(characterState),
}));

vi.mock("../../stores/characterManagerStore", () => ({
	useCharacterManagerStore: <T,>(
		selector: (state: { openCharacter: typeof openCharacter }) => T,
	): T => selector({ openCharacter }),
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
		character_id: "archivist",
		character_version: 1,
		character_snapshot: {
			name: "Saved archivist",
			avatar: "",
			description: "Historical description",
			system_prompt: "Historical prompt",
			opening_message: "",
			tags: [],
		},
		message_count: 2,
		created_at: "",
		updated_at: "",
	};
}

beforeEach(() => {
	toggleSidebar.mockReset();
	openCharacter.mockReset();
	conversationState = {
		activeId: "conversation-1",
		conversations: [conversation()],
		loading: false,
		streaming: false,
	};
	settingsState = {
		sidebarOpen: true,
		toggleSidebar,
	};
	characterState = {
		characters: [
			{
				id: "archivist",
				name: "Latest archivist",
				avatar: "https://example.com/latest-avatar.png",
				version: 1,
			},
		],
	};
});

afterEach(cleanup);

describe("ContextHeader context and layout commands", () => {
	it("shows character, conversation title, then the right-aligned model switcher", () => {
		const { container } = render(<ContextHeader />);

		const header = screen.getByLabelText("Conversation context");
		const character = screen.getByText("Saved archivist");
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
		expect(provider.parentElement?.className).toContain("max-w-[55%]");
		expect(provider.parentElement?.className).not.toContain("w-[32%]");
		expect(header.textContent).toContain(
			"Saved archivistA deliberately long conversation",
		);
		expect(screen.getByText("Saved archivist")).toBeDefined();
		expect(container.querySelector("img")).toBeNull();
		fireEvent.click(
			screen.getByRole("button", {
				name: "Current character: Saved archivist",
			}),
		);
		expect(openCharacter).toHaveBeenCalledWith("archivist");

		fireEvent.click(screen.getByRole("button", { name: "Close sidebar" }));
		expect(toggleSidebar).toHaveBeenCalledTimes(1);
	});

	it("offers an explicit update when the mutable profile is newer", () => {
		characterState.characters[0].version = 2;
		render(<ContextHeader />);

		expect(
			screen.getByRole("button", { name: "Review character update" }),
		).toBeDefined();
	});

	it("does not expose the removed focus mode command", () => {
		render(<ContextHeader />);

		expect(screen.queryByRole("button", { name: /focus mode/i })).toBeNull();
	});

	it("keeps transient generation status out of the navigation header", () => {
		conversationState.loading = true;
		const { rerender } = render(<ContextHeader />);
		expect(screen.getByLabelText("Loading conversation")).toBeDefined();

		conversationState.loading = false;
		conversationState.streaming = true;
		rerender(<ContextHeader />);
		expect(screen.queryByLabelText("Loading conversation")).toBeNull();
		expect(screen.queryByLabelText("Generating response")).toBeNull();

		conversationState.streaming = false;
		rerender(<ContextHeader />);
		expect(screen.queryByLabelText("Generating response")).toBeNull();
	});
});

describe("ContextHeader removed commands", () => {
	it("does not expose a conversation actions menu", () => {
		render(<ContextHeader />);

		expect(screen.queryByTitle("Conversation actions")).toBeNull();
		expect(
			screen.queryByRole("button", {
				name: "Actions for A deliberately long conversation",
			}),
		).toBeNull();
	});
});

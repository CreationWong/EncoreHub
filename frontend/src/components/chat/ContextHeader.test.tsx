import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let conversationState: {
	activeId: string | null;
	conversations: { id: string; title: string }[];
	messages: { id: string }[];
	loading: boolean;
	streaming: boolean;
};

const toggleSidebar = vi.fn();
let settingsState = { sidebarOpen: true, toggleSidebar };

vi.mock("../../stores/conversationStore", () => ({
	useConversationStore: (
		selector: (state: typeof conversationState) => unknown,
	) => selector(conversationState),
}));

vi.mock("../../stores/settingsStore", () => ({
	useSettingsStore: (selector: (state: typeof settingsState) => unknown) =>
		selector(settingsState),
}));

vi.mock("../sidebar/ProviderSwitcher", () => ({
	default: () => <div data-testid="provider-switcher" />,
}));

import ContextHeader from "./ContextHeader";

beforeEach(() => {
	toggleSidebar.mockReset();
	settingsState = { sidebarOpen: true, toggleSidebar };
});

afterEach(cleanup);

describe("ContextHeader", () => {
	it("shows the active conversation title and message count", () => {
		conversationState = {
			activeId: "conversation-1",
			conversations: [
				{ id: "conversation-1", title: "A deliberately long conversation" },
			],
			messages: [{ id: "message-1" }, { id: "message-2" }],
			loading: false,
			streaming: false,
		};

		render(<ContextHeader />);
		expect(
			screen.getByRole("heading", { name: "A deliberately long conversation" }),
		).toBeDefined();
		expect(screen.getByText("2 messages")).toBeDefined();
		expect(screen.getByTestId("provider-switcher")).toBeDefined();
		fireEvent.click(screen.getByRole("button", { name: "Close sidebar" }));
		expect(toggleSidebar).toHaveBeenCalledTimes(1);
	});

	it("uses truthful loading, streaming, and not-started states", () => {
		conversationState = {
			activeId: "conversation-1",
			conversations: [{ id: "conversation-1", title: "Status check" }],
			messages: [],
			loading: true,
			streaming: false,
		};
		const { rerender } = render(<ContextHeader />);
		expect(screen.getByText("Loading messages")).toBeDefined();

		conversationState = {
			...conversationState,
			loading: false,
			streaming: true,
		};
		rerender(<ContextHeader />);
		expect(screen.getByText("Generating")).toBeDefined();

		conversationState = {
			activeId: null,
			conversations: [],
			messages: [],
			loading: false,
			streaming: false,
		};
		rerender(<ContextHeader />);
		expect(
			screen.getByRole("heading", { name: "New conversation" }),
		).toBeDefined();
		expect(screen.getByText("Not started")).toBeDefined();

		settingsState = { sidebarOpen: false, toggleSidebar };
		rerender(<ContextHeader />);
		expect(screen.getByRole("button", { name: "Open sidebar" })).toBeDefined();
	});
});

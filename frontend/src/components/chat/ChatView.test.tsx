import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

let chatState: { activeId: string | null; loading: boolean };

vi.mock("../../stores/conversationStore", () => ({
	useConversationStore: (selector: (state: typeof chatState) => unknown) =>
		selector(chatState),
}));

vi.mock("./ContextHeader", () => ({
	default: () => <div data-testid="context-header" />,
}));
vi.mock("./MessageFeed", () => ({
	default: () => <div data-testid="message-feed" />,
}));
vi.mock("./Composer", () => ({
	default: () => <div data-testid="composer" />,
}));

import ChatView from "./ChatView";

afterEach(cleanup);

describe("ChatView shell", () => {
	it("keeps the context header and composer around the welcome state", () => {
		chatState = { activeId: null, loading: false };
		render(<ChatView />);

		expect(screen.getByTestId("context-header")).toBeDefined();
		expect(screen.getByRole("heading", { name: "EncoreHub" })).toBeDefined();
		expect(screen.getByTestId("composer")).toBeDefined();
	});

	it("uses a stable composer placeholder while an active conversation loads", () => {
		chatState = { activeId: "conversation-1", loading: true };
		render(<ChatView />);

		expect(screen.getByLabelText("Loading conversation")).toBeDefined();
		expect(screen.queryByTestId("message-feed")).toBeNull();
		expect(screen.queryByTestId("composer")).toBeNull();
	});

	it("places the message feed between the fixed context and composer slots", () => {
		chatState = { activeId: "conversation-1", loading: false };
		render(<ChatView />);

		expect(screen.getByTestId("context-header")).toBeDefined();
		expect(screen.getByTestId("message-feed")).toBeDefined();
		expect(screen.getByTestId("composer")).toBeDefined();
	});
});

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const selectConversation = vi.fn();
const newConversation = vi.fn();

let conversationState: {
	conversations: Array<{
		id: string;
		provider: string;
		model: string;
		updated_at: string;
	}>;
	activeId: string | null;
	selectConversation: typeof selectConversation;
	newConversation: typeof newConversation;
};

let providerState: {
	profiles: Array<{ id: string; name: string }>;
	loading: boolean;
	error: string | null;
};

vi.mock("../../stores/conversationStore", () => ({
	useConversationStore: (
		selector: (state: typeof conversationState) => unknown,
	) => selector(conversationState),
}));

vi.mock("../../stores/providerStore", () => ({
	useProviderStore: (selector: (state: typeof providerState) => unknown) =>
		selector(providerState),
}));

vi.mock("../../stores/settingsStore", () => ({
	useSettingsStore: (
		selector: (state: { provider: string; model: string }) => unknown,
	) => selector({ provider: "deepseek", model: "deepseek-chat" }),
}));

import CharacterList from "./CharacterList";

beforeEach(() => {
	selectConversation.mockReset().mockResolvedValue(undefined);
	newConversation.mockReset().mockResolvedValue("new-conversation");
	conversationState = {
		conversations: [],
		activeId: null,
		selectConversation,
		newConversation,
	};
	providerState = {
		profiles: [{ id: "deepseek", name: "DeepSeek" }],
		loading: false,
		error: null,
	};
});

afterEach(cleanup);

describe("CharacterList", () => {
	it("renders only the default character projection", () => {
		render(<CharacterList />);

		expect(screen.getByText("Default character")).toBeDefined();
		expect(screen.getByText("DeepSeek · deepseek-chat")).toBeDefined();
		expect(screen.queryByText(/add character/i)).toBeNull();
		expect(screen.queryByText(/import/i)).toBeNull();
		expect(screen.queryByLabelText(/delete/i)).toBeNull();
	});

	it("opens the newest conversation for the projected provider and model", () => {
		conversationState.conversations = [
			{
				id: "older-match",
				provider: "deepseek",
				model: "deepseek-chat",
				updated_at: "2026-07-24T08:00:00Z",
			},
			{
				id: "newer-match",
				provider: "deepseek",
				model: "deepseek-chat",
				updated_at: "2026-07-25T08:00:00Z",
			},
			{
				id: "other-model",
				provider: "deepseek",
				model: "deepseek-reasoner",
				updated_at: "2026-07-25T09:00:00Z",
			},
		];
		render(<CharacterList />);

		fireEvent.click(screen.getByText("Default character"));
		expect(selectConversation).toHaveBeenCalledWith("newer-match");
		expect(newConversation).not.toHaveBeenCalled();
	});

	it("creates an empty conversation when the character has no history", () => {
		render(<CharacterList />);
		fireEvent.click(screen.getByText("Default character"));

		expect(newConversation).toHaveBeenCalledTimes(1);
		expect(selectConversation).not.toHaveBeenCalled();
	});

	it("keeps the default character usable when provider loading fails", () => {
		providerState.error = "offline";
		render(<CharacterList />);

		expect(
			screen.getByText("Provider configuration unavailable"),
		).toBeDefined();
		expect(screen.getByRole("button")).toBeDefined();
	});
});

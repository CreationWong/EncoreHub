import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Conversation } from "../../services/conversation";
import type { ProviderProfile } from "../../services/providers";

const setProvider = vi.fn();
const openSettings = vi.fn();
const newConversation = vi.fn();
const updateConversationModel = vi.fn();

let settingsState: {
	provider: string;
	model: string;
	setProvider: typeof setProvider;
	openSettings: typeof openSettings;
};

let conversationState: {
	activeId: string | null;
	conversations: Conversation[];
	newConversation: typeof newConversation;
	updateConversationModel: typeof updateConversationModel;
};

let providerState: {
	profiles: ProviderProfile[];
	loading: boolean;
};

vi.mock("../../stores/settingsStore", () => ({
	useSettingsStore: <T,>(selector: (state: typeof settingsState) => T): T =>
		selector(settingsState),
}));

vi.mock("../../stores/conversationStore", () => ({
	useConversationStore: <T,>(
		selector: (state: typeof conversationState) => T,
	): T => selector(conversationState),
}));

vi.mock("../../stores/providerStore", () => ({
	useProviderStore: <T,>(selector: (state: typeof providerState) => T): T =>
		selector(providerState),
}));

import ProviderSwitcher from "./ProviderSwitcher";

function profile(
	id: string,
	name: string,
	models: string[],
	enabled = true,
): ProviderProfile {
	return {
		id,
		name,
		protocol: id === "anthropic" ? "anthropic" : "openai",
		base_url: "",
		models,
		enabled,
		builtin: true,
	};
}

function conversation(
	provider: string,
	model: string,
	id = "conversation-1",
): Conversation {
	return {
		id,
		title: "Authoritative conversation",
		provider,
		model,
		message_count: 2,
		created_at: "",
		updated_at: "",
	};
}

beforeEach(() => {
	setProvider.mockReset();
	openSettings.mockReset();
	newConversation.mockReset().mockResolvedValue("new-conversation");
	updateConversationModel.mockReset().mockResolvedValue(undefined);
	settingsState = {
		provider: "deepseek",
		model: "deepseek-chat",
		setProvider,
		openSettings,
	};
	conversationState = {
		activeId: null,
		conversations: [],
		newConversation,
		updateConversationModel,
	};
	providerState = {
		profiles: [
			profile("deepseek", "DeepSeek", ["deepseek-chat", "deepseek-reasoner"]),
			profile("anthropic", "Anthropic", ["claude-sonnet-4"]),
			profile("disabled", "Disabled", ["disabled-model"], false),
		],
		loading: false,
	};
});

afterEach(cleanup);

describe("ProviderSwitcher defaults", () => {
	it("changes the new-conversation default when no conversation is active", () => {
		render(<ProviderSwitcher />);
		const trigger = screen.getByRole("button", {
			name: /Select default provider and model.*DeepSeek · deepseek-chat/,
		});
		fireEvent.click(trigger);

		expect(screen.queryByText("Disabled")).toBeNull();
		fireEvent.click(
			screen.getByRole("menuitemradio", { name: "deepseek-reasoner" }),
		);

		expect(setProvider).toHaveBeenCalledWith("deepseek", "deepseek-reasoner");
		expect(newConversation).not.toHaveBeenCalled();
		expect(updateConversationModel).not.toHaveBeenCalled();
	});

	it("opens the real provider settings command", () => {
		render(<ProviderSwitcher />);
		fireEvent.click(
			screen.getByRole("button", {
				name: /Select default provider and model/,
			}),
		);
		fireEvent.click(
			screen.getByRole("menuitem", { name: "Provider settings" }),
		);

		expect(openSettings).toHaveBeenCalledWith("providers");
	});
});

describe("ProviderSwitcher conversation authority", () => {
	beforeEach(() => {
		conversationState.activeId = "conversation-1";
		conversationState.conversations = [
			conversation("anthropic", "claude-sonnet-4"),
		];
	});

	it("shows the conversation provider/model instead of global defaults", () => {
		render(<ProviderSwitcher />);

		expect(
			screen.getByRole("button", {
				name: /Current conversation: Anthropic · claude-sonnet-4/,
			}),
		).toBeDefined();
		expect(screen.queryByText("deepseek-chat")).toBeNull();
	});

	it("updates the active conversation without creating a new conversation", async () => {
		render(<ProviderSwitcher />);
		fireEvent.click(
			screen.getByRole("button", {
				name: /Select current conversation provider and model/,
			}),
		);
		fireEvent.click(
			screen.getByRole("menuitemradio", { name: "deepseek-reasoner" }),
		);

		await waitFor(() =>
			expect(updateConversationModel).toHaveBeenCalledWith(
				"conversation-1",
				"deepseek",
				"deepseek-reasoner",
			),
		);
		expect(newConversation).not.toHaveBeenCalled();
		expect(setProvider).not.toHaveBeenCalled();
	});

	it("does not confirm when the current model is selected again", () => {
		render(<ProviderSwitcher />);
		fireEvent.click(
			screen.getByRole("button", {
				name: /Select current conversation provider and model/,
			}),
		);
		fireEvent.click(
			screen.getByRole("menuitemradio", { name: "claude-sonnet-4" }),
		);

		expect(updateConversationModel).not.toHaveBeenCalled();
		expect(newConversation).not.toHaveBeenCalled();
	});
});

describe("ProviderSwitcher recovery and keyboard behavior", () => {
	it("keeps unavailable conversation metadata visible and offers valid models", () => {
		conversationState.activeId = "conversation-1";
		conversationState.conversations = [
			conversation("retired-provider", "retired-model"),
		];
		render(<ProviderSwitcher />);

		const trigger = screen.getByRole("button", {
			name: /retired-provider · retired-model.*Current model unavailable/,
		});
		fireEvent.click(trigger);
		expect(screen.getByText("Current model unavailable")).toBeDefined();
		expect(
			screen.getByRole("menuitemradio", { name: "deepseek-chat" }),
		).toBeDefined();
	});

	it("shows a recoverable empty state when no providers are enabled", () => {
		providerState.profiles = [];
		render(<ProviderSwitcher />);
		fireEvent.click(
			screen.getByRole("button", {
				name: /Select default provider and model/,
			}),
		);

		expect(screen.getByText("No providers available")).toBeDefined();
		expect(
			screen.getByRole("menuitem", { name: "Provider settings" }),
		).toBeDefined();
	});

	it("closes on Escape and returns focus to the trigger", () => {
		render(<ProviderSwitcher />);
		const trigger = screen.getByRole("button", {
			name: /Select default provider and model/,
		});
		fireEvent.click(trigger);
		fireEvent.keyDown(window, { key: "Escape" });

		expect(screen.queryByRole("menu")).toBeNull();
		expect(document.activeElement).toBe(trigger);
	});
});

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CharacterProfile } from "../../services/characters";
import type { Conversation } from "../../services/conversation";
import type { ProviderProfile } from "../../services/providers";
import { useCharacterManagerStore } from "../../stores/characterManagerStore";
import { useCharacterStore } from "../../stores/characterStore";
import { useConversationStore } from "../../stores/conversationStore";
import { useProviderStore } from "../../stores/providerStore";
import { useSettingsStore } from "../../stores/settingsStore";
import CharacterList from "./CharacterList";

const selectConversation = vi.fn();
const newConversation = vi.fn();
const loadCharacters = vi.fn();

function character(
	overrides: Partial<CharacterProfile> = {},
): CharacterProfile {
	return {
		id: "default",
		name: "Default character",
		avatar: "",
		description: "",
		system_prompt: "",
		default_provider: "",
		default_model: "",
		opening_message: "",
		tags: [],
		version: 1,
		created_at: "2026-07-29T00:00:00Z",
		updated_at: "2026-07-29T00:00:00Z",
		deleted_at: null,
		...overrides,
	};
}

function conversation(
	id: string,
	characterId: string,
	updatedAt: string,
): Conversation {
	return {
		id,
		title: id,
		provider: "anthropic",
		model: "claude-sonnet-4",
		character_id: characterId,
		character_version: 1,
		message_count: 0,
		created_at: updatedAt,
		updated_at: updatedAt,
	};
}

const providers: ProviderProfile[] = [
	{
		id: "deepseek",
		name: "DeepSeek",
		protocol: "openai",
		base_url: "https://api.deepseek.com",
		models: ["deepseek-chat"],
		enabled: true,
		builtin: true,
	},
	{
		id: "anthropic",
		name: "Anthropic",
		protocol: "anthropic",
		base_url: "https://api.anthropic.com",
		models: ["claude-sonnet-4"],
		model_configs: [
			{
				id: "claude-sonnet-4",
				name: "Claude Sonnet 4",
				streaming: true,
			},
		],
		enabled: true,
		builtin: true,
	},
];

beforeEach(() => {
	selectConversation.mockReset().mockResolvedValue(undefined);
	newConversation.mockReset().mockResolvedValue("new-conversation");
	loadCharacters.mockReset().mockResolvedValue(undefined);
	useCharacterStore.setState({
		characters: [
			character(),
			character({
				id: "archivist",
				name: "Research archivist",
				default_provider: "anthropic",
				default_model: "claude-sonnet-4",
			}),
		],
		loading: false,
		loaded: true,
		error: null,
		load: loadCharacters,
	});
	useConversationStore.setState({
		conversations: [],
		activeId: null,
		selectConversation,
		newConversation,
	});
	useProviderStore.setState({
		profiles: providers,
		loading: false,
		loaded: true,
		error: null,
	});
	useSettingsStore.setState({
		provider: "deepseek",
		model: "deepseek-chat",
	});
	useCharacterManagerStore.setState({
		open: false,
		characterId: null,
		creating: false,
	});
});

afterEach(cleanup);

describe("CharacterList", () => {
	it("renders authoritative profiles and their resolved models", () => {
		render(<CharacterList />);

		expect(screen.getByText("Default character")).toBeDefined();
		expect(screen.getByText("Research archivist")).toBeDefined();
		expect(screen.getByText("DeepSeek · deepseek-chat")).toBeDefined();
		expect(screen.getByText("Anthropic · Claude Sonnet 4")).toBeDefined();
		expect(screen.getByRole("button", { name: "Add character" })).toBeDefined();
	});

	it("opens the newest conversation for the selected character", () => {
		useConversationStore.setState({
			conversations: [
				conversation("older", "archivist", "2026-07-24T08:00:00Z"),
				conversation("newer", "archivist", "2026-07-25T08:00:00Z"),
				conversation("other", "default", "2026-07-26T08:00:00Z"),
			],
		});
		render(<CharacterList />);

		fireEvent.click(screen.getByText("Research archivist"));
		expect(selectConversation).toHaveBeenCalledWith("newer");
		expect(newConversation).not.toHaveBeenCalled();
	});

	it("creates a conversation with the character default model", () => {
		render(<CharacterList />);
		fireEvent.click(screen.getByText("Research archivist"));

		expect(newConversation).toHaveBeenCalledWith({
			characterId: "archivist",
			provider: "anthropic",
			model: "claude-sonnet-4",
		});
	});

	it("opens create and edit management flows", () => {
		render(<CharacterList />);
		fireEvent.click(screen.getByRole("button", { name: "Add character" }));
		expect(useCharacterManagerStore.getState()).toMatchObject({
			open: true,
			creating: true,
		});

		useCharacterManagerStore.getState().close();
		fireEvent.click(
			screen.getByRole("button", { name: "Edit Research archivist" }),
		);
		expect(useCharacterManagerStore.getState()).toMatchObject({
			open: true,
			creating: false,
			characterId: "archivist",
		});
	});

	it("surfaces an unavailable model without hiding the character", () => {
		useProviderStore.setState({ profiles: providers.slice(0, 1) });
		render(<CharacterList />);

		expect(screen.getByText("Research archivist")).toBeDefined();
		expect(screen.getByText("Model unavailable")).toBeDefined();
	});

	it("shows a recoverable load error", () => {
		useCharacterStore.setState({
			characters: [],
			loaded: false,
			error: "offline",
		});
		render(<CharacterList />);

		expect(screen.getByText("Unable to load characters.")).toBeDefined();
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		expect(loadCharacters).toHaveBeenCalled();
	});
});

import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../services/api";
import type { CharacterProfile } from "../../services/characters";
import type { ProviderProfile } from "../../services/providers";
import { useCharacterManagerStore } from "../../stores/characterManagerStore";
import { useCharacterStore } from "../../stores/characterStore";
import { useConversationStore } from "../../stores/conversationStore";
import { useProviderStore } from "../../stores/providerStore";
import { useSettingsStore } from "../../stores/settingsStore";
import CharacterManager from "./CharacterManager";

const updateCharacter = vi.fn();
const createCharacter = vi.fn();
const newConversation = vi.fn();

function profile(overrides: Partial<CharacterProfile> = {}): CharacterProfile {
	return {
		id: "default",
		name: "Default character",
		avatar: "",
		description: "Built-in profile",
		system_prompt: "Be helpful.",
		default_provider: "openai",
		default_model: "gpt-4.1",
		opening_message: "How can I help?",
		tags: ["general"],
		version: 1,
		revision: 1,
		active_branch: "main",
		created_at: "2026-07-29T00:00:00Z",
		updated_at: "2026-07-29T00:00:00Z",
		deleted_at: null,
		...overrides,
	};
}

const provider: ProviderProfile = {
	id: "openai",
	name: "OpenAI",
	protocol: "openai",
	base_url: "https://api.openai.com/v1",
	models: ["gpt-4.1"],
	model_configs: [{ id: "gpt-4.1", name: "GPT-4.1", streaming: true }],
	enabled: true,
	builtin: true,
};

beforeEach(() => {
	updateCharacter.mockReset();
	createCharacter.mockReset();
	newConversation.mockReset().mockResolvedValue("test-conversation");
	const defaultProfile = profile();
	const archivist = profile({
		id: "archivist",
		name: "Archivist",
		version: 3,
	});
	useCharacterStore.setState({
		characters: [defaultProfile, archivist],
		loading: false,
		loaded: true,
		error: null,
		load: async () => {},
		create: async (input) => {
			createCharacter(input);
			const created = profile({
				...input,
				id: "created",
				avatar: input.avatar ?? "",
				description: input.description ?? "",
				system_prompt: input.system_prompt ?? "",
				default_provider: input.default_provider ?? "",
				default_model: input.default_model ?? "",
				opening_message: input.opening_message ?? "",
				tags: input.tags ?? [],
			});
			useCharacterStore.setState((state) => ({
				characters: [...state.characters, created],
			}));
			return created;
		},
		update: async (id, changes) => {
			updateCharacter(id, changes);
			const current = useCharacterStore
				.getState()
				.characters.find((item) => item.id === id);
			if (!current) throw new Error("not found");
			const updated = { ...current, ...changes, version: current.version + 1 };
			useCharacterStore.setState((state) => ({
				characters: state.characters.map((item) =>
					item.id === id ? updated : item,
				),
			}));
			return updated;
		},
	});
	useProviderStore.setState({
		profiles: [provider],
		loading: false,
		loaded: true,
		error: null,
	});
	useSettingsStore.setState({
		provider: "openai",
		model: "gpt-4.1",
		setSidebarMode: vi.fn(),
	});
	useConversationStore.setState({ newConversation });
	useCharacterManagerStore.setState({
		open: true,
		characterId: "archivist",
		creating: false,
	});
});

afterEach(cleanup);

describe("CharacterManager", () => {
	it("loads a versioned profile and protects the default character", async () => {
		render(<CharacterManager />);

		expect(screen.getByLabelText("Name")).toHaveProperty("value", "Archivist");
		expect(screen.getByText("~3 estimated tokens")).toBeDefined();
		fireEvent.click(screen.getByText("Default character"));
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "Delete" })).toHaveProperty(
				"disabled",
				true,
			),
		);
	});

	it("opens the global version history with an injected history graph", async () => {
		const character = profile({
			id: "archivist",
			name: "Archivist",
			version: 3,
		});
		render(
			<CharacterManager
				historyLoader={async () => ({
					histories: [
						{
							character,
							branches: [
								{
									character_id: character.id,
									name: "main",
									head_version: 3,
									created_from_version: 1,
									created_at: character.created_at,
									updated_at: character.updated_at,
								},
							],
							versions: [
								{
									...character,
									character_id: character.id,
									parent_version: 2,
									branch_name: "main",
									message: "Document history behavior",
								},
							],
						},
					],
					total: 1,
				})}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "History" }));

		await waitFor(() =>
			expect(screen.getByText("Global version history")).toBeDefined(),
		);
		expect(
			screen.getByRole("region", { name: "Archivist history" }),
		).toBeDefined();
		expect(screen.getByText("Document history behavior")).toBeDefined();
	});

	it("saves dirty fields through the versioned store action", async () => {
		render(<CharacterManager />);
		fireEvent.change(screen.getByLabelText("Description"), {
			target: { value: "Updated evidence policy" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save" }));

		await waitFor(() => expect(updateCharacter).toHaveBeenCalled());
		expect(updateCharacter).toHaveBeenCalledWith(
			"archivist",
			expect.objectContaining({ description: "Updated evidence policy" }),
		);
		expect(screen.getAllByText("Version 4")).toHaveLength(2);
	});

	it("restores unsaved fields when cancel is selected", () => {
		render(<CharacterManager />);
		const name = screen.getByLabelText("Name");
		fireEvent.change(name, { target: { value: "Temporary name" } });
		fireEvent.click(screen.getByRole("button", { name: "Cancel changes" }));

		expect(name).toHaveProperty("value", "Archivist");
	});

	it("blocks a duplicate name before it reaches the API", () => {
		useCharacterManagerStore.setState({
			open: true,
			characterId: null,
			creating: true,
		});
		render(<CharacterManager />);
		const name = document.querySelector<HTMLInputElement>("#character-name");
		if (!name) throw new Error("Character name input was not rendered");
		fireEvent.change(name, {
			target: { value: "ARCHIVIST" },
		});

		expect(
			screen.getByText("A character with this name already exists."),
		).toBeDefined();
		expect(screen.getByRole("button", { name: "Save" })).toHaveProperty(
			"disabled",
			true,
		);
	});

	it("saves before starting a test conversation", async () => {
		render(<CharacterManager />);
		fireEvent.change(screen.getByLabelText("Opening message"), {
			target: { value: "What should we inspect?" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Test conversation" }));

		await waitFor(() => expect(newConversation).toHaveBeenCalled());
		expect(newConversation).toHaveBeenCalledWith({
			characterId: "archivist",
			provider: "openai",
			model: "gpt-4.1",
		});
		expect(useCharacterManagerStore.getState().open).toBe(false);
	});

	it("keeps the draft visible when a version conflict occurs", async () => {
		useCharacterStore.setState({
			update: async () => {
				useCharacterStore.setState({ error: "version conflict" });
				throw new ApiError(409, "version conflict");
			},
		});
		render(<CharacterManager />);
		fireEvent.change(screen.getByLabelText("Description"), {
			target: { value: "Conflicting edit" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save" }));

		await waitFor(() =>
			expect(
				screen.getByText(/This character changed elsewhere/),
			).toBeDefined(),
		);
		expect(screen.getByLabelText("Description")).toHaveProperty(
			"value",
			"Conflicting edit",
		);
		expect(screen.getByRole("button", { name: "Reload latest" })).toBeDefined();
		expect(useCharacterStore.getState().error).toBeNull();
	});

	it("keeps the conflict draft when reloading the latest version fails", async () => {
		useCharacterStore.setState({
			update: async () => {
				throw new ApiError(409, "version conflict");
			},
			load: async () => {
				useCharacterStore.setState({ error: "refresh failed" });
			},
		});
		render(<CharacterManager />);
		fireEvent.change(screen.getByLabelText("Description"), {
			target: { value: "Keep this conflict draft" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "Reload latest" }),
			).toBeDefined(),
		);

		fireEvent.click(screen.getByRole("button", { name: "Reload latest" }));

		await waitFor(() =>
			expect(
				screen.getByText(/Your unsaved draft is still intact/),
			).toBeDefined(),
		);
		expect(screen.getByLabelText("Description")).toHaveProperty(
			"value",
			"Keep this conflict draft",
		);
	});

	it("closes on Escape and traps Tab focus inside the dialog", async () => {
		render(<CharacterManager />);
		const addCharacter = screen.getByRole("button", {
			name: "Add character",
		});
		const testConversation = screen.getByRole("button", {
			name: "Test conversation",
		});

		testConversation.focus();
		fireEvent.keyDown(testConversation, { key: "Tab" });
		expect(document.activeElement).toBe(addCharacter);

		fireEvent.keyDown(addCharacter, { key: "Tab", shiftKey: true });
		expect(document.activeElement).toBe(testConversation);

		fireEvent.keyDown(testConversation, { key: "Escape" });
		await waitFor(() =>
			expect(useCharacterManagerStore.getState().open).toBe(false),
		);
	});
});

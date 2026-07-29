import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CharacterProfile } from "../services/characters";

const listCharacters = vi.fn();
const createCharacter = vi.fn();
const updateCharacter = vi.fn();
const deleteCharacter = vi.fn();

vi.mock("../services/characters", () => ({
	listCharacters: (...args: unknown[]) => listCharacters(...args),
	createCharacter: (...args: unknown[]) => createCharacter(...args),
	updateCharacter: (...args: unknown[]) => updateCharacter(...args),
	deleteCharacter: (...args: unknown[]) => deleteCharacter(...args),
}));

import { useCharacterStore } from "./characterStore";

function profile(overrides: Partial<CharacterProfile> = {}): CharacterProfile {
	return {
		id: "archivist",
		name: "Archivist",
		avatar: "",
		description: "Uses evidence",
		system_prompt: "Use sources",
		default_provider: "anthropic",
		default_model: "claude-sonnet-4",
		opening_message: "What should we research?",
		tags: ["research"],
		version: 1,
		created_at: "2026-07-29T00:00:00Z",
		updated_at: "2026-07-29T00:00:00Z",
		deleted_at: null,
		...overrides,
	};
}

describe("characterStore", () => {
	beforeEach(() => {
		listCharacters.mockReset();
		createCharacter.mockReset();
		updateCharacter.mockReset();
		deleteCharacter.mockReset();
		useCharacterStore.setState({
			characters: [],
			loading: false,
			loaded: false,
			error: null,
		});
	});

	it("loads the authoritative profile list", async () => {
		const character = profile();
		listCharacters.mockResolvedValue({ characters: [character], total: 1 });

		await useCharacterStore.getState().load();

		expect(useCharacterStore.getState().characters).toEqual([character]);
		expect(useCharacterStore.getState().loaded).toBe(true);
	});

	it("updates with the loaded version and adopts the returned revision", async () => {
		const current = profile({ version: 4 });
		const updated = profile({ version: 5, system_prompt: "Revised" });
		useCharacterStore.setState({ characters: [current] });
		updateCharacter.mockResolvedValue(updated);

		await useCharacterStore
			.getState()
			.update(current.id, { system_prompt: "Revised" });

		expect(updateCharacter).toHaveBeenCalledWith(current.id, 4, {
			system_prompt: "Revised",
		});
		expect(useCharacterStore.getState().characters).toEqual([updated]);
	});

	it("keeps local state intact when versioned update fails", async () => {
		const current = profile({ version: 2 });
		useCharacterStore.setState({ characters: [current] });
		updateCharacter.mockRejectedValue(new Error("version conflict"));

		await expect(
			useCharacterStore.getState().update(current.id, { name: "Changed" }),
		).rejects.toThrow("version conflict");

		expect(useCharacterStore.getState().characters).toEqual([current]);
		expect(useCharacterStore.getState().error).toBe("version conflict");
	});
});

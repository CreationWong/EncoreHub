import { create } from "zustand";
import {
	type CharacterProfile,
	type CharacterProfileChanges,
	type CharacterProfileInput,
	createCharacter,
	deleteCharacter,
	listCharacters,
	updateCharacter,
} from "../services/characters";

interface CharacterState {
	characters: CharacterProfile[];
	loading: boolean;
	loaded: boolean;
	error: string | null;

	load: () => Promise<void>;
	create: (profile: CharacterProfileInput) => Promise<CharacterProfile>;
	update: (
		id: string,
		changes: CharacterProfileChanges,
	) => Promise<CharacterProfile>;
	remove: (id: string) => Promise<void>;
	clearError: () => void;
}

function errorMessage(error: unknown, fallback: string): string {
	return error instanceof Error ? error.message : fallback;
}

export const useCharacterStore = create<CharacterState>((set, get) => ({
	characters: [],
	loading: false,
	loaded: false,
	error: null,

	load: async () => {
		set({ loading: true, error: null });
		try {
			const response = await listCharacters();
			set({
				characters: response.characters,
				loading: false,
				loaded: true,
			});
		} catch (error) {
			set({
				loading: false,
				error: errorMessage(error, "Failed to load characters"),
			});
		}
	},

	create: async (input) => {
		try {
			const character = await createCharacter(input);
			set((state) => ({
				characters: [...state.characters, character],
				loaded: true,
				error: null,
			}));
			return character;
		} catch (error) {
			set({ error: errorMessage(error, "Failed to create character") });
			throw error;
		}
	},

	update: async (id, changes) => {
		const current = get().characters.find((character) => character.id === id);
		if (!current) {
			const error = new Error("Character is not loaded");
			set({ error: error.message });
			throw error;
		}
		try {
			const character = await updateCharacter(id, current.version, changes);
			set((state) => ({
				characters: state.characters.map((item) =>
					item.id === id ? character : item,
				),
				error: null,
			}));
			return character;
		} catch (error) {
			set({ error: errorMessage(error, "Failed to update character") });
			throw error;
		}
	},

	remove: async (id) => {
		try {
			await deleteCharacter(id);
			set((state) => ({
				characters: state.characters.filter((character) => character.id !== id),
				error: null,
			}));
		} catch (error) {
			set({ error: errorMessage(error, "Failed to delete character") });
			throw error;
		}
	},

	clearError: () => set({ error: null }),
}));

import { create } from "zustand";

interface CharacterManagerState {
	open: boolean;
	characterId: string | null;
	creating: boolean;
	openCharacter: (characterId?: string) => void;
	createCharacter: () => void;
	close: () => void;
}

export const useCharacterManagerStore = create<CharacterManagerState>(
	(set) => ({
		open: false,
		characterId: null,
		creating: false,
		openCharacter: (characterId = "default") =>
			set({ open: true, characterId, creating: false }),
		createCharacter: () =>
			set({ open: true, characterId: null, creating: true }),
		close: () => set({ open: false }),
	}),
);

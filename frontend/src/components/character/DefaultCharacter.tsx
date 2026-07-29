import { DEFAULT_CHARACTER_ID } from "../../services/characters";
import CharacterAvatar from "./CharacterAvatar";

export const DEFAULT_CHARACTER_NAME = "Default character";

export function DefaultCharacterAvatar({
	size = "medium",
}: {
	size?: "small" | "medium" | "large";
}) {
	return (
		<CharacterAvatar
			characterId={DEFAULT_CHARACTER_ID}
			name={DEFAULT_CHARACTER_NAME}
			size={size}
		/>
	);
}

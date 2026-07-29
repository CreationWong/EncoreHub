import { DEFAULT_CHARACTER_ID } from "../../services/characters";
import { useCharacterStore } from "../../stores/characterStore";
import { useConversationStore } from "../../stores/conversationStore";
import CharacterAvatar from "../character/CharacterAvatar";
import { DEFAULT_CHARACTER_NAME } from "../character/DefaultCharacter";

export default function AssistantIdentity() {
	const activeId = useConversationStore((state) => state.activeId);
	const conversation = useConversationStore((state) =>
		state.conversations?.find((item) => item.id === activeId),
	);
	const characterId = conversation?.character_id ?? DEFAULT_CHARACTER_ID;
	const latestCharacter = useCharacterStore((state) =>
		state.characters.find((item) => item.id === characterId),
	);
	const characterSnapshot = conversation?.character_snapshot;
	const name =
		(characterSnapshot ? characterSnapshot.name : latestCharacter?.name) ||
		DEFAULT_CHARACTER_NAME;
	const avatar = characterSnapshot
		? characterSnapshot.avatar
		: (latestCharacter?.avatar ?? "");

	return (
		<div
			aria-label={`Response from ${name}`}
			className="mb-3 flex min-w-0 items-center gap-2"
		>
			<CharacterAvatar
				avatar={avatar}
				characterId={characterId}
				name={name}
				size="small"
			/>
			<span className="truncate text-xs font-medium text-text-secondary">
				{name}
			</span>
		</div>
	);
}

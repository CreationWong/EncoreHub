import {
	DEFAULT_CHARACTER_NAME,
	DefaultCharacterAvatar,
} from "../character/DefaultCharacter";

export default function AssistantIdentity() {
	return (
		<div
			aria-label={`Response from ${DEFAULT_CHARACTER_NAME}`}
			className="mb-3 flex min-w-0 items-center gap-2"
		>
			<DefaultCharacterAvatar size="small" />
			<span className="truncate text-xs font-medium text-text-secondary">
				{DEFAULT_CHARACTER_NAME}
			</span>
		</div>
	);
}

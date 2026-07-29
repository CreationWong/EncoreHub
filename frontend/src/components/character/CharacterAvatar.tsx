import { Bot, UserRound } from "lucide-react";
import { useState } from "react";
import { DEFAULT_CHARACTER_ID } from "../../services/characters";

const SIZE_CLASSES = {
	small: "h-7 w-7 rounded",
	medium: "h-8 w-8 rounded-md",
	large: "h-10 w-10 rounded-md",
	xlarge: "h-16 w-16 rounded-lg",
} as const;

const ICON_CLASSES = {
	small: "h-3.5 w-3.5",
	medium: "h-4 w-4",
	large: "h-5 w-5",
	xlarge: "h-7 w-7",
} as const;

export interface CharacterAvatarProps {
	avatar?: string;
	characterId?: string;
	name: string;
	size?: keyof typeof SIZE_CLASSES;
	className?: string;
}

function initials(name: string): string {
	const words = name.trim().split(/\s+/).filter(Boolean);
	if (words.length > 1) {
		return `${Array.from(words[0])[0] ?? ""}${Array.from(words[1])[0] ?? ""}`.toUpperCase();
	}
	return Array.from(words[0] ?? "")
		.slice(0, 2)
		.join("")
		.toUpperCase();
}

export default function CharacterAvatar({
	avatar = "",
	characterId,
	name,
	size = "medium",
	className = "",
}: CharacterAvatarProps) {
	const [failedAvatar, setFailedAvatar] = useState<string | null>(null);

	const frameClass = `${SIZE_CLASSES[size]} ${className}`;
	if (avatar && failedAvatar !== avatar) {
		return (
			<img
				src={avatar}
				alt=""
				aria-hidden="true"
				referrerPolicy="no-referrer"
				onError={() => setFailedAvatar(avatar)}
				className={`${frameClass} shrink-0 border border-border bg-control object-cover`}
			/>
		);
	}

	const Icon = characterId === DEFAULT_CHARACTER_ID ? Bot : UserRound;
	const label = initials(name);
	const showInitials = characterId !== DEFAULT_CHARACTER_ID && Boolean(label);
	return (
		<span
			aria-hidden="true"
			className={`${frameClass} flex shrink-0 items-center justify-center bg-control text-text-secondary`}
		>
			{showInitials ? (
				<span className="max-w-full truncate px-1 text-[11px] font-semibold">
					{label}
				</span>
			) : (
				<Icon className={ICON_CLASSES[size]} />
			)}
		</span>
	);
}

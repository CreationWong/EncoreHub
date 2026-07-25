import { Bot } from "lucide-react";

export const DEFAULT_CHARACTER_NAME = "Default character";

export function DefaultCharacterAvatar({
	size = "medium",
}: {
	size?: "small" | "medium" | "large";
}) {
	const frameSize =
		size === "small" ? "h-7 w-7" : size === "large" ? "h-9 w-9" : "h-8 w-8";
	const iconSize = size === "small" ? "h-3.5 w-3.5" : "h-4 w-4";

	return (
		<span
			aria-hidden="true"
			className={`flex shrink-0 items-center justify-center rounded-md bg-control text-text-secondary ${frameSize}`}
		>
			<Bot className={iconSize} />
		</span>
	);
}

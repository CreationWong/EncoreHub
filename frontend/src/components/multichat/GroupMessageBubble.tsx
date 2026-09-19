// One message row in the multi-AI group transcript.
//
// Assistant rows carry speaker identity (avatar, name, accent) because a group
// transcript interleaves several bots; user rows reuse the compact bubble shape
// of single chat. Streaming and failure states are rendered by the same
// component so a live segment and its committed message look identical.

import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { useT } from "../../i18n";
import CharacterAvatar from "../character/CharacterAvatar";
import MarkdownRenderer from "../chat/MarkdownRenderer";
import { colorWithAlpha } from "./participantAccent";

export interface GroupMessageBubbleProps {
	speaker: string;
	avatar?: string;
	characterId?: string;
	accent?: string;
	variant: "user" | "assistant";
	content: string;
	reasoning?: string;
	streaming?: boolean;
	status?: "streaming" | "done" | "skipped" | "error";
	error?: string;
}

export default function GroupMessageBubble({
	speaker,
	avatar = "",
	characterId,
	accent,
	variant,
	content,
	reasoning = "",
	streaming = false,
	status = "done",
	error,
}: GroupMessageBubbleProps) {
	const t = useT();
	const [reasoningOpen, setReasoningOpen] = useState(false);

	if (variant === "user") {
		// Plain text on the accent bubble: MarkdownRenderer would force its own
		// text color inside the bubble, and sent messages need no typesetting.
		return (
			<article className="flex justify-end px-4 py-3">
				<div className="max-w-[78%] rounded-2xl rounded-br-sm bg-accent px-3.5 py-2.5 text-[15px] leading-6 text-white">
					<p className="whitespace-pre-wrap break-words">{content}</p>
				</div>
			</article>
		);
	}

	if (status === "skipped") {
		return (
			<article className="flex items-center gap-2 px-4 py-2 text-[11px] text-text-muted">
				<span
					className="h-2 w-2 rounded-full"
					style={{ backgroundColor: accent }}
					aria-hidden="true"
				/>
				{speaker} · {t("multiChat.skipped")}
			</article>
		);
	}

	return (
		<article className="flex gap-3 px-4 py-3">
			<span
				className="mt-0.5 shrink-0 self-start rounded-md"
				style={accent ? { boxShadow: `0 0 0 2px ${accent}` } : undefined}
			>
				<CharacterAvatar
					avatar={avatar}
					characterId={characterId}
					name={speaker}
					size="small"
				/>
			</span>
			<div className="min-w-0 flex-1">
				<div
					className={accent ? "rounded-lg border px-3 py-2" : undefined}
					style={
						accent
							? {
									// A low-opacity identity tint keeps each member's
									// replies separable at a glance without turning
									// chat into a color wall.
									backgroundColor: colorWithAlpha(accent, 0.14),
									borderColor: colorWithAlpha(accent, 0.45),
								}
							: undefined
					}
				>
					<p
						className="mb-1 text-xs font-medium"
						style={accent ? { color: accent } : undefined}
					>
						{speaker}
						{streaming && (
							<span className="ml-2 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-text-muted align-middle" />
						)}
					</p>
					{reasoning && (
						<div className="mb-1">
							<button
								type="button"
								onClick={() => setReasoningOpen((value) => !value)}
								className="flex items-center gap-1 text-[10px] text-text-muted hover:text-text-primary"
							>
								<ChevronDown
									className={`h-3 w-3 transition-transform ${reasoningOpen ? "" : "-rotate-90"}`}
								/>
								{t("multiChat.reasoning")}
							</button>
							{reasoningOpen && (
								<p className="mt-1 whitespace-pre-wrap border-l-2 border-border pl-2 text-[11px] leading-5 text-text-muted">
									{reasoning}
								</p>
							)}
						</div>
					)}
					{status === "error" ? (
						<p className="text-xs text-danger">
							{error || t("multiChat.participantFailed")}
						</p>
					) : (
						<MarkdownRenderer content={content} size="sm" />
					)}
				</div>
			</div>
		</article>
	);
}

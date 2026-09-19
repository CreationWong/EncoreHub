// Composer for the multi-AI group workspace.
//
// The composer owns the draft and the @mention menu. Mentions are resolved
// from the final text against the roster right before sending, so deleting an
// inserted name also drops its id and no hidden mention state can go stale.

import { AtSign, Send, Square } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useT } from "../../i18n";
import type { ConversationParticipant } from "../../services/conversation";

export interface GroupComposerProps {
	participants: ConversationParticipant[];
	streaming: boolean;
	disabled?: boolean;
	onSend: (content: string, mentions: string[]) => void;
	onStop: () => void;
}

/** Return the mention query when the caret sits inside an "@word" token. */
export function activeMentionQuery(
	value: string,
	caret: number,
): string | null {
	const before = value.slice(0, caret);
	const match = /(?:^|\s)@([^\s@]*)$/.exec(before);
	return match ? match[1] : null;
}

/** Resolve which roster members the final draft addresses. */
export function mentionedCharacterIds(
	value: string,
	participants: ConversationParticipant[],
): string[] {
	const ids: string[] = [];
	for (const participant of participants) {
		const name = participant.character_snapshot.name?.trim();
		if (name && value.includes(`@${name}`)) ids.push(participant.character_id);
	}
	return ids;
}

export default function GroupComposer({
	participants,
	streaming,
	disabled = false,
	onSend,
	onStop,
}: GroupComposerProps) {
	const t = useT();
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const [value, setValue] = useState("");
	const [mentionQuery, setMentionQuery] = useState<string | null>(null);

	const matches = useMemo(() => {
		if (mentionQuery == null) return [];
		const query = mentionQuery.toLowerCase();
		return participants.filter((participant) =>
			participant.character_snapshot.name?.toLowerCase().includes(query),
		);
	}, [mentionQuery, participants]);

	const syncMentionMenu = (next: string, caret: number | null) => {
		const position = caret ?? next.length;
		setMentionQuery(activeMentionQuery(next, position));
	};

	const insertMention = (participant: ConversationParticipant) => {
		const textarea = textareaRef.current;
		const caret = textarea?.selectionStart ?? value.length;
		const before = value.slice(0, caret);
		const after = value.slice(caret);
		const replaced = before.replace(
			/@([^\s@]*)$/,
			`@${participant.character_snapshot.name} `,
		);
		const next = `${replaced}${after}`;
		setValue(next);
		setMentionQuery(null);
		requestAnimationFrame(() => {
			const position = replaced.length;
			textarea?.focus();
			textarea?.setSelectionRange(position, position);
		});
	};

	const submit = () => {
		const trimmed = value.trim();
		if (!trimmed || streaming || disabled) return;
		onSend(trimmed, mentionedCharacterIds(trimmed, participants));
		setValue("");
		setMentionQuery(null);
	};

	return (
		<div className="border-t border-border bg-surface px-3 py-3">
			<div className="relative mx-auto w-full max-w-3xl">
				{mentionQuery != null && matches.length > 0 && (
					<ul
						aria-label={t("multiChat.mentionMenu")}
						className="absolute bottom-full left-3 mb-2 max-h-56 w-64 overflow-y-auto rounded-md border border-border bg-workspace py-1 shadow-xl"
					>
						{matches.map((participant) => (
							<li key={participant.character_id}>
								<button
									type="button"
									onClick={() => insertMention(participant)}
									className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-text-primary hover:bg-control"
								>
									<AtSign className="h-3 w-3 shrink-0 text-text-muted" />
									<span className="truncate">
										{participant.character_snapshot.name}
									</span>
								</button>
							</li>
						))}
					</ul>
				)}
				<div className="flex items-end gap-2">
					<textarea
						ref={textareaRef}
						autoComplete="off"
						value={value}
						rows={2}
						disabled={disabled}
						aria-label={t("multiChat.composerPlaceholder")}
						placeholder={t("multiChat.composerPlaceholder")}
						onChange={(event) => {
							setValue(event.target.value);
							syncMentionMenu(event.target.value, event.target.selectionStart);
						}}
						onClick={(event) =>
							syncMentionMenu(
								event.currentTarget.value,
								event.currentTarget.selectionStart,
							)
						}
						onKeyDown={(event) => {
							if (event.key === "Escape" && mentionQuery != null) {
								setMentionQuery(null);
								return;
							}
							if (event.key === "Enter" && !event.shiftKey) {
								event.preventDefault();
								submit();
							}
						}}
						className="min-h-[44px] min-w-0 flex-1 resize-none rounded-md border border-border bg-surface-alt px-3 py-2 text-sm leading-5 text-text-primary outline-none placeholder:text-text-muted focus:border-accent disabled:opacity-60"
					/>
					{streaming ? (
						<button
							type="button"
							onClick={onStop}
							title={t("multiChat.stopTitle")}
							aria-label={t("multiChat.stop")}
							className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-control text-text-primary hover:bg-selected"
						>
							<Square className="h-4 w-4" />
						</button>
					) : (
						<button
							type="button"
							onClick={submit}
							disabled={disabled || value.trim().length === 0}
							aria-label={t("multiChat.send")}
							className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-accent text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
						>
							<Send className="h-4 w-4" />
						</button>
					)}
				</div>
				<p className="mt-1.5 text-[10px] text-text-muted">
					{t("multiChat.composerHint")}
				</p>
			</div>
		</div>
	);
}

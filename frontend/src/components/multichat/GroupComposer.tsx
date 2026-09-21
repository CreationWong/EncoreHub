// Composer for the multi-AI group workspace.
//
// Mentions are rendered inline: a transparent textarea sits on top of a
// highlight mirror that styles every "@name" token, so a selected member looks
// like one highlighted unit. Backspace/Delete removes the whole token, and the
// mention/command menus support ArrowUp/ArrowDown with Tab or Enter to confirm.
// The mirror is aria-hidden and pointer-events-none; the textarea remains the
// single source of truth for the draft text.

import { AtSign, Send, Square } from "lucide-react";
import { Fragment, useMemo, useRef, useState } from "react";
import { useT } from "../../i18n";
import type { ConversationParticipant } from "../../services/conversation";

/** User-only group commands. The Gateway rejects them from AI output. */
const GROUP_COMMANDS = [
	{ command: "/stop", helpKey: "multiChat.commandStopHelp" },
	{ command: "/pause", helpKey: "multiChat.commandPauseHelp" },
	{ command: "/resume", helpKey: "multiChat.commandResumeHelp" },
] as const;

export interface GroupComposerProps {
	participants: ConversationParticipant[];
	streaming: boolean;
	disabled?: boolean;
	onSend: (content: string, mentions: string[]) => void;
	onStop: () => void;
}

/**
 * Return the mention query when the caret sits inside an "@word" token.
 *
 * Typing "@" always opens the menu, whatever precedes it: Chinese text has no
 * word separator before "@", and users may also address someone after a latin
 * word or punctuation.
 */
export function activeMentionQuery(
	value: string,
	caret: number,
): string | null {
	const before = value.slice(0, caret);
	const match = /@([^\s@]*)$/.exec(before);
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

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Member names ordered longest-first so "@审题拆解" beats "@审题". */
function mentionNames(participants: ConversationParticipant[]): string[] {
	return participants
		.map((participant) => participant.character_snapshot.name?.trim() ?? "")
		.filter(Boolean)
		.sort((left, right) => right.length - left.length);
}

/** Split the draft into text and highlighted mention spans for the mirror. */
function renderHighlighted(value: string, names: string[]) {
	if (!value) return "\u200b";
	if (names.length === 0) return value;
	const pattern = new RegExp(
		`(${names.map((name) => `@${escapeRegExp(name)}`).join("|")})`,
		"g",
	);
	const parts = value.split(pattern);
	// Keys come from the running text offset so they stay stable without
	// depending on the array index.
	let offset = 0;
	return (
		<>
			{parts.map((part) => {
				const key = offset;
				offset += part.length;
				return part.startsWith("@") && names.includes(part.slice(1)) ? (
					<span
						// Inline mention styling: one highlighted unit in the draft.
						key={`mention-${key}`}
						data-mention={part.slice(1)}
						className="group-mention-token"
					>
						{part}
					</span>
				) : (
					<Fragment key={`text-${key}`}>{part}</Fragment>
				);
			})}
			{"\u200b"}
		</>
	);
}

/** Match a mention token that ends exactly at the caret (Backspace target). */
function mentionEndingAt(
	value: string,
	caret: number,
	names: string[],
): [number, number] | null {
	for (const name of names) {
		const token = `@${name}`;
		const start = caret - token.length;
		if (start >= 0 && value.slice(start, caret) === token) {
			return [start, caret];
		}
	}
	return null;
}

/** Match a mention token that starts exactly at the caret (Delete target). */
function mentionStartingAt(
	value: string,
	caret: number,
	names: string[],
): [number, number] | null {
	for (const name of names) {
		const token = `@${name}`;
		if (value.slice(caret, caret + token.length) === token) {
			return [caret, caret + token.length];
		}
	}
	return null;
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
	const mirrorRef = useRef<HTMLDivElement | null>(null);
	const [value, setValue] = useState("");
	const [mentionQuery, setMentionQuery] = useState<string | null>(null);
	const [commandQuery, setCommandQuery] = useState<string | null>(null);
	const [menuIndex, setMenuIndex] = useState(0);
	const [composing, setComposing] = useState(false);

	const names = useMemo(() => mentionNames(participants), [participants]);

	const matches = useMemo(() => {
		if (mentionQuery == null) return [];
		const query = mentionQuery.toLowerCase();
		return participants.filter((participant) =>
			participant.character_snapshot.name?.toLowerCase().includes(query),
		);
	}, [mentionQuery, participants]);

	const matchingCommands = GROUP_COMMANDS.filter((entry) =>
		commandQuery == null
			? false
			: entry.command.slice(1).startsWith(commandQuery),
	);

	const highlighted = useMemo(
		() => renderHighlighted(value, names),
		[value, names],
	);

	const syncMenus = (next: string, caret: number | null) => {
		const position = caret ?? next.length;
		setMentionQuery(activeMentionQuery(next, position));
		const commandMatch = /^\/(\S*)$/.exec(next.trimStart());
		setCommandQuery(commandMatch ? commandMatch[1].toLowerCase() : null);
		setMenuIndex(0);
	};

	/** Move the caret after an edit that replaced the text before `position`. */
	const placeCaret = (position: number) => {
		requestAnimationFrame(() => {
			const textarea = textareaRef.current;
			if (!textarea) return;
			textarea.focus();
			textarea.setSelectionRange(position, position);
		});
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
		setMenuIndex(0);
		placeCaret(replaced.length);
	};

	const insertCommand = (command: string) => {
		setValue("");
		setCommandQuery(null);
		setMentionQuery(null);
		setMenuIndex(0);
		onSend(command, []);
	};

	const submit = () => {
		const trimmed = value.trim();
		// Members may still be speaking: the queue accepts new messages anytime.
		if (!trimmed || disabled) return;
		onSend(trimmed, mentionedCharacterIds(trimmed, participants));
		setValue("");
		setMentionQuery(null);
		setCommandQuery(null);
		setMenuIndex(0);
	};

	const confirmMenu = () => {
		if (commandQuery != null && matchingCommands.length > 0) {
			insertCommand(
				matchingCommands[Math.min(menuIndex, matchingCommands.length - 1)]
					.command,
			);
			return true;
		}
		if (mentionQuery != null && matches.length > 0) {
			insertMention(matches[Math.min(menuIndex, matches.length - 1)]);
			return true;
		}
		return false;
	};

	const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
		const textarea = event.currentTarget;
		const caret = textarea.selectionStart ?? value.length;
		const collapsed = textarea.selectionStart === textarea.selectionEnd;
		const menuOpen =
			(commandQuery != null && matchingCommands.length > 0) ||
			(mentionQuery != null && matches.length > 0);

		if (menuOpen && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
			event.preventDefault();
			const count =
				commandQuery != null && matchingCommands.length > 0
					? matchingCommands.length
					: matches.length;
			const delta = event.key === "ArrowDown" ? 1 : -1;
			setMenuIndex((current) => (current + delta + count) % count);
			return;
		}
		if (menuOpen && (event.key === "Tab" || event.key === "Enter")) {
			event.preventDefault();
			confirmMenu();
			return;
		}
		if (event.key === "Escape") {
			if (mentionQuery != null || commandQuery != null) {
				event.preventDefault();
				setMentionQuery(null);
				setCommandQuery(null);
			}
			return;
		}
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			submit();
			return;
		}
		// Backspace/Delete remove a mention atomically instead of one character.
		if (
			collapsed &&
			!composing &&
			(event.key === "Backspace" || event.key === "Delete")
		) {
			const range =
				event.key === "Backspace"
					? mentionEndingAt(value, caret, names)
					: mentionStartingAt(value, caret, names);
			if (range) {
				event.preventDefault();
				const next = value.slice(0, range[0]) + value.slice(range[1]);
				setValue(next);
				setMentionQuery(activeMentionQuery(next, range[0]));
				placeCaret(range[0]);
			}
		}
	};

	const menuLabel = t("multiChat.mentionMenu");

	return (
		<div className="border-t border-border bg-surface px-3 py-3">
			<div className="relative mx-auto w-full max-w-3xl">
				{commandQuery != null && matchingCommands.length > 0 && (
					<ul
						aria-label={t("multiChat.commands")}
						className="absolute bottom-full left-3 mb-2 w-72 overflow-hidden rounded-md border border-border bg-workspace py-1 shadow-xl"
					>
						{matchingCommands.map((entry, index) => (
							<li key={entry.command}>
								<button
									type="button"
									aria-selected={index === menuIndex}
									onClick={() => insertCommand(entry.command)}
									className={`flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-xs text-text-primary ${
										index === menuIndex
											? "group-menu-active"
											: "hover:bg-control"
									}`}
								>
									<span className="font-mono font-medium">{entry.command}</span>
									<span className="min-w-0 flex-1 truncate text-[11px] text-text-muted">
										{t(entry.helpKey)}
									</span>
								</button>
							</li>
						))}
					</ul>
				)}
				{commandQuery == null && mentionQuery != null && matches.length > 0 && (
					<ul
						aria-label={menuLabel}
						className="absolute bottom-full left-3 mb-2 max-h-56 w-64 overflow-y-auto rounded-md border border-border bg-workspace py-1 shadow-xl"
					>
						{matches.map((participant, index) => (
							<li key={participant.character_id}>
								<button
									type="button"
									aria-selected={index === menuIndex}
									onClick={() => insertMention(participant)}
									className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-text-primary ${
										index === menuIndex
											? "group-menu-active"
											: "hover:bg-control"
									}`}
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
					<div className="relative min-w-0 flex-1">
						<div
							ref={mirrorRef}
							aria-hidden="true"
							className={`pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words rounded-md border border-border bg-surface-alt px-3 py-2 text-sm leading-5 text-text-primary ${
								composing ? "invisible" : ""
							}`}
						>
							{highlighted}
						</div>
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
								syncMenus(event.target.value, event.target.selectionStart);
							}}
							onClick={(event) =>
								syncMenus(
									event.currentTarget.value,
									event.currentTarget.selectionStart,
								)
							}
							onKeyDown={handleKeyDown}
							onCompositionStart={() => setComposing(true)}
							onCompositionEnd={(event) => {
								setComposing(false);
								setValue(event.currentTarget.value);
								syncMenus(
									event.currentTarget.value,
									event.currentTarget.selectionStart,
								);
							}}
							onScroll={(event) => {
								const mirror = mirrorRef.current;
								if (!mirror) return;
								mirror.scrollTop = event.currentTarget.scrollTop;
								mirror.scrollLeft = event.currentTarget.scrollLeft;
							}}
							className={`relative block min-h-[44px] w-full resize-none rounded-md border bg-transparent px-3 py-2 text-sm leading-5 caret-accent outline-none placeholder:text-text-muted focus:border-accent disabled:opacity-60 ${
								composing ? "text-text-primary" : "text-transparent"
							}`}
						/>
					</div>
					{streaming && (
						<button
							type="button"
							onClick={onStop}
							title={t("multiChat.stopTitle")}
							aria-label={t("multiChat.stop")}
							className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-control text-text-primary hover:bg-selected"
						>
							<Square className="h-4 w-4" />
						</button>
					)}
					<button
						type="button"
						onClick={submit}
						disabled={disabled || value.trim().length === 0}
						aria-label={t("multiChat.send")}
						className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-accent text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
					>
						<Send className="h-4 w-4" />
					</button>
				</div>
				<p className="mt-1.5 text-[10px] text-text-muted">
					{t("multiChat.composerHint")}
				</p>
			</div>
		</div>
	);
}

import { Loader2, Send, Square } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	SLASH_COMMANDS,
	type SlashCommand,
	matchCommands,
} from "../../commands/slash";
import { useConversationStore } from "../../stores/conversationStore";
import { useSettingsStore } from "../../stores/settingsStore";
import SlashCommandMenu from "./SlashCommandMenu";

const MAX_CHARS = 8000;
const WARN_AT = 7000;

export default function InputBox() {
	const [input, setInput] = useState("");
	const [menuIndex, setMenuIndex] = useState(0);
	const [historyIdx, setHistoryIdx] = useState<number>(-1);
	const draftRef = useRef("");
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const sendMessage = useConversationStore((s) => s.sendMessage);
	const stopStreaming = useConversationStore((s) => s.stopStreaming);
	const streaming = useConversationStore((s) => s.streaming);
	const activeId = useConversationStore((s) => s.activeId);
	const messages = useConversationStore((s) => s.messages);

	// Most-recent-first list of user prompts in this conversation.
	const userHistory = useMemo(
		() =>
			messages
				.filter((m) => m.role === "user")
				.map((m) => m.content)
				.reverse(),
		[messages],
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: focus on intent
	useEffect(() => {
		textareaRef.current?.focus();
		setHistoryIdx(-1);
		draftRef.current = "";
	}, [activeId, streaming]);

	// Slash menu visibility: input begins with `/` and has no spaces yet.
	const slashOpen = input.startsWith("/") && !input.includes(" ");
	const slashMatches = useMemo<SlashCommand[]>(
		() => (slashOpen ? matchCommands(input) : []),
		[input, slashOpen],
	);

	useEffect(() => {
		if (menuIndex >= slashMatches.length) setMenuIndex(0);
	}, [slashMatches.length, menuIndex]);

	const runCommand = useCallback(async (cmd: SlashCommand, args: string) => {
		const ctx = {
			conv: useConversationStore.getState(),
			settings: useSettingsStore.getState(),
		};
		const result = await cmd.run(args, ctx);
		setInput("");
		if (textareaRef.current) textareaRef.current.style.height = "auto";
		if (typeof result === "string" && result) {
			// /help and similar return text — push as a fake assistant message
			// by routing through sendMessage with the result content. Simpler:
			// just put it in the input so the user can edit before sending.
			setInput(result);
		}
	}, []);

	const handleSend = useCallback(async () => {
		const raw = input.trim();
		if (!raw || streaming) return;

		// If the line is exactly "/cmd args...", run it instead of sending.
		if (raw.startsWith("/")) {
			const [head, ...rest] = raw.slice(1).split(/\s+/);
			const cmd = SLASH_COMMANDS.find(
				(c) => c.id === head || c.name === `/${head}`,
			);
			if (cmd) {
				await runCommand(cmd, rest.join(" "));
				return;
			}
		}

		setInput("");
		if (textareaRef.current) textareaRef.current.style.height = "auto";
		await sendMessage(raw);
	}, [input, streaming, sendMessage, runCommand]);

	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (slashOpen && slashMatches.length > 0) {
			if (e.key === "ArrowDown") {
				e.preventDefault();
				setMenuIndex((i) => (i + 1) % slashMatches.length);
				return;
			}
			if (e.key === "ArrowUp") {
				e.preventDefault();
				setMenuIndex(
					(i) => (i - 1 + slashMatches.length) % slashMatches.length,
				);
				return;
			}
			if (e.key === "Tab") {
				e.preventDefault();
				const cmd = slashMatches[menuIndex];
				if (cmd) setInput(`${cmd.name} `);
				return;
			}
			if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
				e.preventDefault();
				const cmd = slashMatches[menuIndex];
				if (cmd) runCommand(cmd, "");
				return;
			}
			if (e.key === "Escape") {
				e.preventDefault();
				setInput("");
				return;
			}
		}

		if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
			e.preventDefault();
			handleSend();
			return;
		}
		if (e.key === "Escape" && streaming) {
			e.preventDefault();
			stopStreaming();
			return;
		}

		// Bash-style history: empty caret + ArrowUp -> previous user message.
		if (
			e.key === "ArrowUp" &&
			!e.nativeEvent.isComposing &&
			userHistory.length > 0 &&
			historyIdx + 1 < userHistory.length &&
			(historyIdx >= 0 || textareaRef.current?.selectionStart === 0)
		) {
			e.preventDefault();
			if (historyIdx === -1) draftRef.current = input;
			const next = historyIdx + 1;
			setHistoryIdx(next);
			setInput(userHistory[next]);
			return;
		}
		if (e.key === "ArrowDown" && historyIdx >= 0) {
			e.preventDefault();
			const next = historyIdx - 1;
			setHistoryIdx(next);
			setInput(next === -1 ? draftRef.current : userHistory[next]);
		}
	};

	const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
		const next = e.target.value.slice(0, MAX_CHARS);
		setInput(next);
		const el = e.target;
		el.style.height = "auto";
		el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
	};

	const charCount = input.length;
	const warn = charCount >= WARN_AT;

	return (
		<div className="border-t border-border bg-surface p-4">
			<div className="mx-auto flex max-w-3xl items-end gap-3">
				<div className="relative flex-1">
					{slashOpen && (
						<SlashCommandMenu
							items={slashMatches}
							activeIndex={menuIndex}
							onHover={setMenuIndex}
							onSelect={(cmd) => runCommand(cmd, "")}
						/>
					)}
					<textarea
						ref={textareaRef}
						value={input}
						onChange={handleInput}
						onKeyDown={handleKeyDown}
						placeholder="Type a message or / for commands"
						rows={1}
						maxLength={MAX_CHARS}
						className="w-full resize-none rounded-xl border border-border bg-surface-alt px-4 py-3 pr-16 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50"
					/>
					{charCount > 0 && (
						<span
							className={`pointer-events-none absolute bottom-1.5 right-3 text-[10px] tabular-nums ${
								warn ? "text-amber-500" : "text-text-muted"
							}`}
						>
							{charCount}/{MAX_CHARS}
						</span>
					)}
				</div>
				{streaming ? (
					<button
						type="button"
						onClick={stopStreaming}
						title="Stop generating"
						className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-surface-alt text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
					>
						<Square className="h-3.5 w-3.5" fill="currentColor" />
					</button>
				) : (
					<button
						type="button"
						onClick={handleSend}
						disabled={!input.trim()}
						title="Send (Enter)"
						className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-white transition-all hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-accent"
					>
						<Send className="h-4 w-4" />
					</button>
				)}
			</div>
			{streaming && (
				<div className="mx-auto mt-2 flex max-w-3xl items-center gap-2 text-xs text-text-muted">
					<Loader2 className="h-3 w-3 animate-spin" />
					<span>Generating... press Stop or Esc to cancel</span>
				</div>
			)}
		</div>
	);
}

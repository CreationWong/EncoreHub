import {
	Check,
	ChevronDown,
	Command,
	Globe,
	Loader2,
	Send,
	Square,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	SLASH_COMMANDS,
	type SlashCommand,
	matchCommands,
} from "../../commands/slash";
import {
	NEW_CONVERSATION_DRAFT_KEY,
	useConversationStore,
} from "../../stores/conversationStore";
import {
	type SearchProvider,
	useSettingsStore,
} from "../../stores/settingsStore";
import SlashCommandMenu, { slashCommandOptionId } from "./SlashCommandMenu";

const MAX_CHARS = 8000;
const WARN_AT = Math.ceil(MAX_CHARS * 0.85);
const MAX_TEXTAREA_HEIGHT = 220;
const SLASH_MENU_ID = "chat-slash-command-menu";
const SEARCH_MENU_ID = "chat-search-menu";

const SEARCH_PROVIDERS: { value: SearchProvider; label: string }[] = [
	{ value: "duckduckgo", label: "DuckDuckGo" },
	{ value: "bing", label: "Bing" },
	{ value: "google", label: "Google" },
];

function draftKey(id: string | null): string {
	return id ?? NEW_CONVERSATION_DRAFT_KEY;
}

function resizeTextarea(element: HTMLTextAreaElement | null) {
	if (!element) return;
	element.style.height = "auto";
	if (element.scrollHeight > 0) {
		element.style.height = `${Math.min(element.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
	}
	element.style.overflowY =
		element.scrollHeight > MAX_TEXTAREA_HEIGHT ? "auto" : "hidden";
}

function resetTextarea(element: HTMLTextAreaElement | null) {
	if (!element) return;
	element.style.height = "auto";
	element.style.overflowY = "hidden";
}

export default function InputBox() {
	const [input, setInput] = useState(() => {
		const state = useConversationStore.getState();
		return state.drafts[draftKey(state.activeId)] ?? "";
	});
	const [menuIndex, setMenuIndex] = useState(0);
	const [historyIdx, setHistoryIdx] = useState<number>(-1);
	const [slashDismissed, setSlashDismissed] = useState(false);
	const [showSearchMenu, setShowSearchMenu] = useState(false);
	const historyDraftRef = useRef("");
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const composerRef = useRef<HTMLFieldSetElement>(null);
	const searchButtonRef = useRef<HTMLButtonElement>(null);
	const sendMessage = useConversationStore((state) => state.sendMessage);
	const stopStreaming = useConversationStore((state) => state.stopStreaming);
	const streaming = useConversationStore((state) => state.streaming);
	const activeId = useConversationStore((state) => state.activeId);
	const messages = useConversationStore((state) => state.messages);
	const pendingDraft = useConversationStore((state) => state.pendingDraft);
	const clearDraft = useConversationStore((state) => state.clearDraft);
	const setConversationDraft = useConversationStore(
		(state) => state.setConversationDraft,
	);
	const clearConversationDraft = useConversationStore(
		(state) => state.clearConversationDraft,
	);
	const searchEnabled = useSettingsStore((state) => state.searchEnabled);
	const searchProvider = useSettingsStore((state) => state.searchProvider);
	const setSearchEnabled = useSettingsStore((state) => state.setSearchEnabled);
	const setSearchProvider = useSettingsStore(
		(state) => state.setSearchProvider,
	);

	const updateInput = useCallback(
		(next: string, conversationId: string | null = activeId) => {
			setInput(next);
			setConversationDraft(conversationId, next);
		},
		[activeId, setConversationDraft],
	);

	// Restore the conversation-local draft only when the conversation changes.
	useEffect(() => {
		const state = useConversationStore.getState();
		setInput(state.drafts[draftKey(activeId)] ?? "");
		setHistoryIdx(-1);
		historyDraftRef.current = "";
		setSlashDismissed(false);
		setShowSearchMenu(false);
		queueMicrotask(() => {
			resizeTextarea(textareaRef.current);
			textareaRef.current?.focus();
		});
	}, [activeId]);

	// Memory quotes and future edit-and-resend actions use the pending mailbox.
	useEffect(() => {
		if (pendingDraft == null) return;
		const state = useConversationStore.getState();
		const current = state.drafts[draftKey(activeId)] ?? input;
		const next = current ? `${current}\n\n${pendingDraft}` : pendingDraft;
		updateInput(next);
		clearDraft();
		queueMicrotask(() => {
			resizeTextarea(textareaRef.current);
			textareaRef.current?.focus();
		});
	}, [activeId, clearDraft, input, pendingDraft, updateInput]);

	const userHistory = useMemo(
		() =>
			messages
				.filter((message) => message.role === "user")
				.map((message) => message.content)
				.reverse(),
		[messages],
	);

	const slashCandidate = input.startsWith("/") && !/\s/.test(input);
	const slashOpen = slashCandidate && !slashDismissed;
	const slashMatches = useMemo<SlashCommand[]>(
		() => (slashOpen ? matchCommands(input) : []),
		[input, slashOpen],
	);

	useEffect(() => {
		if (menuIndex >= slashMatches.length) setMenuIndex(0);
	}, [slashMatches.length, menuIndex]);

	useEffect(() => {
		if (!showSearchMenu) return;
		const handlePointerDown = (event: MouseEvent) => {
			if (!composerRef.current?.contains(event.target as Node)) {
				setShowSearchMenu(false);
			}
		};
		document.addEventListener("mousedown", handlePointerDown);
		return () => document.removeEventListener("mousedown", handlePointerDown);
	}, [showSearchMenu]);

	const focusTextarea = useCallback(() => {
		textareaRef.current?.focus();
	}, []);

	const closeSearchMenu = useCallback((returnFocus = false) => {
		setShowSearchMenu(false);
		if (returnFocus) {
			queueMicrotask(() => searchButtonRef.current?.focus());
		}
	}, []);

	const runCommand = useCallback(
		async (command: SlashCommand, args: string) => {
			const sourceId = activeId;
			setInput("");
			clearConversationDraft(sourceId);
			setSlashDismissed(true);
			resetTextarea(textareaRef.current);

			const context = {
				conv: useConversationStore.getState(),
				settings: useSettingsStore.getState(),
			};
			const result = await command.run(args, context);
			if (typeof result === "string" && result) {
				const currentId = useConversationStore.getState().activeId;
				setInput(result);
				setConversationDraft(currentId, result);
			}
			queueMicrotask(() => {
				resizeTextarea(textareaRef.current);
				focusTextarea();
			});
		},
		[activeId, clearConversationDraft, focusTextarea, setConversationDraft],
	);

	const handleSend = useCallback(async () => {
		const raw = input.trim();
		if (!raw || streaming) return;

		if (raw.startsWith("/")) {
			const [head, ...rest] = raw.slice(1).split(/\s+/);
			const command = SLASH_COMMANDS.find(
				(item) => item.id === head || item.name === `/${head}`,
			);
			if (command) {
				await runCommand(command, rest.join(" "));
				return;
			}
		}

		setSlashDismissed(true);
		setShowSearchMenu(false);
		if (activeId) {
			setInput("");
			clearConversationDraft(activeId);
			resetTextarea(textareaRef.current);
		}
		await sendMessage(raw);
	}, [
		activeId,
		clearConversationDraft,
		input,
		runCommand,
		sendMessage,
		streaming,
	]);

	const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (slashOpen && slashMatches.length > 0) {
			if (event.key === "ArrowDown") {
				event.preventDefault();
				setMenuIndex((index) => (index + 1) % slashMatches.length);
				return;
			}
			if (event.key === "ArrowUp") {
				event.preventDefault();
				setMenuIndex(
					(index) => (index - 1 + slashMatches.length) % slashMatches.length,
				);
				return;
			}
			if (event.key === "Tab") {
				event.preventDefault();
				const command = slashMatches[menuIndex];
				if (command) {
					updateInput(`${command.name} `);
					queueMicrotask(() => resizeTextarea(textareaRef.current));
				}
				return;
			}
			if (
				event.key === "Enter" &&
				!event.shiftKey &&
				!event.nativeEvent.isComposing
			) {
				event.preventDefault();
				const command = slashMatches[menuIndex];
				if (command) void runCommand(command, "");
				return;
			}
			if (event.key === "Escape") {
				event.preventDefault();
				setSlashDismissed(true);
				focusTextarea();
				return;
			}
		}

		if (
			event.key === "Enter" &&
			!event.shiftKey &&
			!event.nativeEvent.isComposing
		) {
			event.preventDefault();
			void handleSend();
			return;
		}
		if (event.key === "Escape" && streaming) {
			event.preventDefault();
			stopStreaming();
			return;
		}

		if (
			event.key === "ArrowUp" &&
			!event.nativeEvent.isComposing &&
			userHistory.length > 0 &&
			historyIdx + 1 < userHistory.length &&
			(historyIdx >= 0 || textareaRef.current?.selectionStart === 0)
		) {
			event.preventDefault();
			if (historyIdx === -1) historyDraftRef.current = input;
			const next = historyIdx + 1;
			setHistoryIdx(next);
			updateInput(userHistory[next]);
			queueMicrotask(() => resizeTextarea(textareaRef.current));
			return;
		}
		if (event.key === "ArrowDown" && historyIdx >= 0) {
			event.preventDefault();
			const next = historyIdx - 1;
			setHistoryIdx(next);
			updateInput(next === -1 ? historyDraftRef.current : userHistory[next]);
			queueMicrotask(() => resizeTextarea(textareaRef.current));
		}
	};

	const handleInput = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
		const next = event.target.value.slice(0, MAX_CHARS);
		setSlashDismissed(false);
		setHistoryIdx(-1);
		updateInput(next);
		resizeTextarea(event.target);
	};

	const charCount = input.length;
	const showCharacterStatus = charCount >= WARN_AT;
	const selectedSearchProvider =
		SEARCH_PROVIDERS.find((provider) => provider.value === searchProvider) ??
		SEARCH_PROVIDERS[0];
	const activeSlashCommand = slashMatches[menuIndex];

	return (
		<div className="border-t border-border bg-surface px-3 py-3 sm:px-4">
			<fieldset
				ref={composerRef}
				aria-label="Message composer"
				className="relative mx-auto min-w-0 max-w-3xl rounded-lg border border-border bg-surface-alt p-0 shadow-sm transition-colors focus-within:border-accent/60"
			>
				{showSearchMenu && (
					<div
						id={SEARCH_MENU_ID}
						role="menu"
						aria-label="Web search settings"
						onKeyDown={(event) => {
							if (event.key === "Escape") {
								event.preventDefault();
								closeSearchMenu(true);
							}
						}}
						className="absolute bottom-full left-9 z-30 mb-2 w-56 rounded-lg border border-border bg-surface p-1.5 shadow-2xl"
					>
						<button
							type="button"
							role="menuitemcheckbox"
							aria-checked={searchEnabled}
							onClick={() => setSearchEnabled(!searchEnabled)}
							className="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-xs text-text-primary hover:bg-surface-hover"
						>
							<span>Enable web search</span>
							<span
								aria-hidden="true"
								className={`flex h-4 w-7 items-center rounded-full px-0.5 transition-colors ${
									searchEnabled ? "justify-end bg-accent" : "bg-border"
								}`}
							>
								<span className="h-3 w-3 rounded-full bg-white shadow-sm" />
							</span>
						</button>
						<hr className="my-1 border-0 border-t border-border" />
						<div className="px-2.5 py-1 text-[10px] font-semibold uppercase text-text-muted">
							Search provider
						</div>
						{SEARCH_PROVIDERS.map((provider) => {
							const selected = searchProvider === provider.value;
							return (
								<button
									key={provider.value}
									type="button"
									role="menuitemradio"
									aria-checked={selected}
									onClick={() => {
										setSearchProvider(provider.value);
										closeSearchMenu(true);
									}}
									className={`flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-xs ${
										selected
											? "bg-accent/10 text-accent"
											: "text-text-secondary hover:bg-surface-hover hover:text-text-primary"
									}`}
								>
									<span>{provider.label}</span>
									{selected && (
										<Check aria-hidden="true" className="h-3.5 w-3.5" />
									)}
								</button>
							);
						})}
					</div>
				)}

				<div className="relative">
					{slashOpen && (
						<SlashCommandMenu
							id={SLASH_MENU_ID}
							items={slashMatches}
							activeIndex={menuIndex}
							onHover={setMenuIndex}
							onSelect={(command) => void runCommand(command, "")}
						/>
					)}
					<textarea
						ref={textareaRef}
						role="combobox"
						aria-autocomplete="list"
						aria-expanded={slashOpen}
						aria-controls={slashOpen ? SLASH_MENU_ID : undefined}
						aria-activedescendant={
							slashOpen && activeSlashCommand
								? slashCommandOptionId(activeSlashCommand.id)
								: undefined
						}
						value={input}
						onChange={handleInput}
						onKeyDown={handleKeyDown}
						placeholder="Type a message or / for commands"
						rows={2}
						maxLength={MAX_CHARS}
						className="block max-h-[220px] min-h-[60px] w-full resize-none bg-transparent px-3.5 pb-1.5 pt-3 text-sm leading-5 text-text-primary placeholder:text-text-muted focus:outline-none"
					/>
				</div>

				<div className="flex min-h-11 items-center justify-between gap-2 px-2 pb-2 pt-1">
					<div className="flex min-w-0 items-center gap-1">
						<button
							type="button"
							onClick={() => {
								setShowSearchMenu(false);
								if (slashOpen) {
									setSlashDismissed(true);
								} else if (!input) {
									setSlashDismissed(false);
									updateInput("/");
								}
								focusTextarea();
							}}
							disabled={Boolean(input && !slashCandidate)}
							aria-label="Open commands"
							aria-expanded={slashOpen}
							aria-controls={SLASH_MENU_ID}
							title="Commands"
							className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-35"
						>
							<Command className="h-4 w-4" />
						</button>
						<button
							ref={searchButtonRef}
							type="button"
							onClick={() => {
								setSlashDismissed(true);
								setShowSearchMenu((open) => !open);
							}}
							aria-label={
								searchEnabled
									? `Web search enabled: ${selectedSearchProvider.label}`
									: "Web search disabled"
							}
							aria-haspopup="menu"
							aria-expanded={showSearchMenu}
							aria-controls={SEARCH_MENU_ID}
							title={
								searchEnabled
									? `Web search: ${selectedSearchProvider.label}`
									: "Web search"
							}
							className={`flex h-9 shrink-0 items-center justify-center gap-0.5 rounded-md px-2 transition-colors ${
								searchEnabled
									? "bg-accent/10 text-accent"
									: "text-text-secondary hover:bg-surface-hover hover:text-text-primary"
							}`}
						>
							<Globe className="h-4 w-4" />
							<ChevronDown className="h-3 w-3" />
						</button>
						{streaming && (
							<output className="ml-1 flex min-w-0 items-center gap-1.5 text-xs text-text-muted">
								<Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
								<span className="truncate">Generating</span>
							</output>
						)}
					</div>

					<div className="flex shrink-0 items-center gap-2">
						{showCharacterStatus && (
							<output
								aria-label="Character limit"
								className="text-[11px] tabular-nums text-warning"
							>
								{charCount} / {MAX_CHARS}
							</output>
						)}
						<button
							type="button"
							onClick={streaming ? stopStreaming : () => void handleSend()}
							disabled={!streaming && !input.trim()}
							aria-label={streaming ? "Stop generating" : "Send message"}
							title={streaming ? "Stop generating" : "Send message"}
							className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors ${
								streaming
									? "border border-border bg-surface text-text-secondary hover:bg-surface-hover hover:text-text-primary"
									: "bg-accent text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-accent"
							}`}
						>
							{streaming ? (
								<Square className="h-3.5 w-3.5" fill="currentColor" />
							) : (
								<Send className="h-4 w-4" />
							)}
						</button>
					</div>
				</div>
			</fieldset>
		</div>
	);
}

import {
	Brain,
	Check,
	ChevronDown,
	Globe,
	Loader2,
	Plus,
	Send,
	Settings2,
	Square,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	type Attachment,
	deleteAttachment,
	uploadAttachment,
} from "../../services/attachments";
import {
	NEW_CONVERSATION_DRAFT_KEY,
	useConversationStore,
} from "../../stores/conversationStore";
import { useProviderStore } from "../../stores/providerStore";
import {
	type SearchProvider,
	useSettingsStore,
} from "../../stores/settingsStore";
import { toast } from "../../stores/toastStore";
import { type SlashTool, matchSlashTools } from "../../tools/slashTools";
import { modelHasCapability } from "../../utils/modelCapabilities";
import SlashToolMenu, { slashToolOptionId } from "./SlashToolMenu";

const MAX_TEXTAREA_HEIGHT = 220;
const COMPACT_TEXTAREA_HEIGHT = 44;
const LOW_HEIGHT_QUERY = "(max-height: 619px)";
const SEARCH_MENU_ID = "chat-search-menu";
const SLASH_TOOL_MENU_ID = "chat-slash-tool-menu";
const NATIVE_WEB_SEARCH_MESSAGE =
	"This model has built-in web search, so web search cannot be turned off.";
const SEARCH_PROVIDERS: ReadonlyArray<{
	value: SearchProvider;
	label: string;
}> = [
	{ value: "duckduckgo", label: "DuckDuckGo" },
	{ value: "duckduckgo_html", label: "DuckDuckGo HTML" },
	{ value: "searxng", label: "SearXNG" },
	{ value: "openserp", label: "OpenSERP" },
];

function draftKey(id: string | null): string {
	return id ?? NEW_CONVERSATION_DRAFT_KEY;
}

function resizeTextarea(element: HTMLTextAreaElement | null) {
	if (!element) return;
	const maxHeight =
		typeof window.matchMedia === "function" &&
		window.matchMedia(LOW_HEIGHT_QUERY).matches
			? COMPACT_TEXTAREA_HEIGHT
			: MAX_TEXTAREA_HEIGHT;
	element.style.height = "auto";
	if (element.scrollHeight > 0) {
		element.style.height = `${Math.min(element.scrollHeight, maxHeight)}px`;
	}
	element.style.overflowY =
		element.scrollHeight > maxHeight ? "auto" : "hidden";
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
	const [historyIdx, setHistoryIdx] = useState<number>(-1);
	const [showSearchMenu, setShowSearchMenu] = useState(false);
	const [slashToolIndex, setSlashToolIndex] = useState(0);
	const [attachments, setAttachments] = useState<Attachment[]>([]);
	const [uploading, setUploading] = useState(false);
	const [dragging, setDragging] = useState(false);
	const [imageStrategy, setImageStrategy] = useState<
		"" | "system_ocr" | "vision_model"
	>("");
	const [visionSelection, setVisionSelection] = useState("");
	const historyDraftRef = useRef("");
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const composerRef = useRef<HTMLFieldSetElement>(null);
	const searchControlRef = useRef<HTMLFieldSetElement>(null);
	const searchMenuButtonRef = useRef<HTMLButtonElement>(null);
	const sendMessage = useConversationStore((state) => state.sendMessage);
	const stopStreaming = useConversationStore((state) => state.stopStreaming);
	const streaming = useConversationStore((state) => state.streaming);
	const activeId = useConversationStore((state) => state.activeId);
	const activeConversation = useConversationStore((state) =>
		state.activeId
			? state.conversations.find(
					(conversation) => conversation.id === state.activeId,
				)
			: undefined,
	);
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
	const defaultProvider = useSettingsStore((state) => state.provider);
	const defaultModel = useSettingsStore((state) => state.model);
	const deepThinking = useSettingsStore((state) => state.deepThinking);
	const setSearchEnabled = useSettingsStore((state) => state.setSearchEnabled);
	const setSearchProvider = useSettingsStore(
		(state) => state.setSearchProvider,
	);
	const openSettings = useSettingsStore((state) => state.openSettings);
	const setDeepThinking = useSettingsStore((state) => state.setDeepThinking);
	const providerProfiles = useProviderStore((state) => state.profiles);
	const activeProvider = activeConversation?.provider || defaultProvider;
	const activeModel = activeConversation?.model || defaultModel;
	const activeModelConfig = providerProfiles
		.find((profile) => profile.id === activeProvider)
		?.model_configs?.find((model) => model.id === activeModel);
	const maximumContextSize = activeModelConfig?.context_window;
	const contextWarningAt = maximumContextSize
		? Math.ceil(maximumContextSize * 0.85)
		: undefined;
	const nativeWebSearch = modelHasCapability(
		providerProfiles,
		activeProvider,
		activeModel,
		"web",
	);
	const deepThinkingAvailable = modelHasCapability(
		providerProfiles,
		activeProvider,
		activeModel,
		"reasoning",
	);
	const visionAvailable = modelHasCapability(
		providerProfiles,
		activeProvider,
		activeModel,
		"vision",
	);
	const visionModels = providerProfiles.flatMap((profile) =>
		(profile.model_configs ?? [])
			.filter((model) => model.capabilities?.includes("vision"))
			.map((model) => ({
				value: `${profile.id}::${model.id}`,
				label: `${profile.name} / ${model.name}`,
			})),
	);
	const hasImages = attachments.some((item) => item.file_category === "image");
	const effectiveSearchEnabled = nativeWebSearch || searchEnabled;
	const slashTools = useMemo(() => matchSlashTools(input), [input]);
	const showSlashTools = slashTools.length > 0;

	const updateInput = useCallback(
		(next: string, conversationId: string | null = activeId) => {
			setInput(next);
			setConversationDraft(conversationId, next);
		},
		[activeId, setConversationDraft],
	);

	useEffect(() => {
		if (!maximumContextSize || input.length <= maximumContextSize) return;
		updateInput(input.slice(0, maximumContextSize));
	}, [input, maximumContextSize, updateInput]);

	// Restore the conversation-local draft only when the conversation changes.
	useEffect(() => {
		const state = useConversationStore.getState();
		setInput(state.drafts[draftKey(activeId)] ?? "");
		setHistoryIdx(-1);
		historyDraftRef.current = "";
		setShowSearchMenu(false);
		setSlashToolIndex(0);
		queueMicrotask(() => {
			resizeTextarea(textareaRef.current);
			textareaRef.current?.focus();
		});
	}, [activeId]);

	const addFiles = useCallback(
		async (files: FileList | File[]) => {
			const candidates = Array.from(files).slice(
				0,
				Math.max(0, 10 - attachments.length),
			);
			if (candidates.length === 0) return;
			let conversationId = useConversationStore.getState().activeId;
			if (!conversationId)
				conversationId = await useConversationStore
					.getState()
					.newConversation();
			if (!conversationId) return;
			setUploading(true);
			try {
				for (const file of candidates) {
					if (file.size > 20 * 1024 * 1024) {
						toast.error(`${file.name} exceeds the 20 MiB limit`);
						continue;
					}
					const attachment = await uploadAttachment(conversationId, file);
					setAttachments((current) => [...current, attachment]);
				}
			} catch (error) {
				toast.error(
					error instanceof Error ? error.message : "Attachment upload failed",
				);
			} finally {
				setUploading(false);
			}
		},
		[attachments.length],
	);

	const removeAttachment = useCallback(async (attachment: Attachment) => {
		const conversationId = useConversationStore.getState().activeId;
		if (!conversationId) return;
		try {
			await deleteAttachment(conversationId, attachment.id);
			setAttachments((current) =>
				current.filter((item) => item.id !== attachment.id),
			);
		} catch {
			toast.error("Failed to remove attachment");
		}
	}, []);

	// Memory quotes use the pending mailbox without changing the active draft owner.
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

	useEffect(() => {
		if (!showSearchMenu) return;
		const handlePointerDown = (event: MouseEvent) => {
			if (!searchControlRef.current?.contains(event.target as Node)) {
				setShowSearchMenu(false);
			}
		};
		document.addEventListener("mousedown", handlePointerDown);
		return () => document.removeEventListener("mousedown", handlePointerDown);
	}, [showSearchMenu]);

	useEffect(() => {
		if (typeof window.matchMedia !== "function") return;
		const media = window.matchMedia(LOW_HEIGHT_QUERY);
		const resize = () => resizeTextarea(textareaRef.current);
		media.addEventListener("change", resize);
		return () => media.removeEventListener("change", resize);
	}, []);

	useEffect(() => {
		if (nativeWebSearch) setShowSearchMenu(false);
	}, [nativeWebSearch]);

	const focusTextarea = useCallback(() => {
		textareaRef.current?.focus();
	}, []);

	const closeSearchMenu = useCallback((returnFocus = false) => {
		setShowSearchMenu(false);
		if (returnFocus) {
			queueMicrotask(() => searchMenuButtonRef.current?.focus());
		}
	}, []);

	const handleSend = useCallback(async () => {
		const raw = input.trim();
		if ((!raw && attachments.length === 0) || streaming || uploading) return;
		if (hasImages && !visionAvailable && !imageStrategy) {
			toast.info("Choose how to process image attachments");
			return;
		}
		if (imageStrategy === "vision_model" && !visionSelection) {
			toast.info("Choose a vision-capable model");
			return;
		}

		setShowSearchMenu(false);
		setInput("");
		clearConversationDraft(activeId);
		resetTextarea(textareaRef.current);
		const [visionProvider, visionModel] = visionSelection.split("::");
		await sendMessage(raw, {
			attachmentIds: attachments.map((item) => item.id),
			modelSupportsVision: visionAvailable,
			imageStrategy: visionAvailable ? "direct" : imageStrategy || undefined,
			visionProvider,
			visionModel,
		});
		if (!useConversationStore.getState().error) {
			setAttachments([]);
			setImageStrategy("");
			setVisionSelection("");
		}
	}, [
		activeId,
		attachments,
		clearConversationDraft,
		hasImages,
		imageStrategy,
		input,
		sendMessage,
		streaming,
		uploading,
		visionAvailable,
		visionSelection,
	]);

	const selectSlashTool = useCallback(
		(tool: SlashTool) => {
			updateInput(`${tool.name} `);
			setSlashToolIndex(0);
			queueMicrotask(() => {
				resizeTextarea(textareaRef.current);
				textareaRef.current?.focus();
			});
		},
		[updateInput],
	);

	const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (showSlashTools) {
			if (event.key === "ArrowDown" || event.key === "ArrowUp") {
				event.preventDefault();
				const direction = event.key === "ArrowDown" ? 1 : -1;
				setSlashToolIndex(
					(current) =>
						(current + direction + slashTools.length) % slashTools.length,
				);
				return;
			}
			if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) {
				event.preventDefault();
				selectSlashTool(slashTools[slashToolIndex] ?? slashTools[0]);
				return;
			}
			if (event.key === "Escape") {
				event.preventDefault();
				updateInput("");
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
		const next = maximumContextSize
			? event.target.value.slice(0, maximumContextSize)
			: event.target.value;
		setHistoryIdx(-1);
		setSlashToolIndex(0);
		updateInput(next);
		resizeTextarea(event.target);
	};

	const charCount = input.length;
	const showContextStatus =
		contextWarningAt !== undefined && charCount >= contextWarningAt;
	const selectedSearchProvider =
		searchProvider === "duckduckgo"
			? "DuckDuckGo"
			: searchProvider === "duckduckgo_html"
				? "DuckDuckGo HTML"
				: searchProvider === "searxng"
					? "SearXNG"
					: "OpenSERP";
	const searchProviders = SEARCH_PROVIDERS;
	return (
		<div className="chat-composer-shell border-t border-border bg-surface px-3 py-3 sm:px-4">
			<fieldset
				ref={composerRef}
				aria-label="Message composer"
				onDragEnter={(event) => {
					event.preventDefault();
					setDragging(true);
				}}
				onDragOver={(event) => {
					event.preventDefault();
					setDragging(true);
				}}
				onDragLeave={(event) => {
					if (!event.currentTarget.contains(event.relatedTarget as Node))
						setDragging(false);
				}}
				onDrop={(event) => {
					event.preventDefault();
					setDragging(false);
					void addFiles(event.dataTransfer.files);
				}}
				className="chat-composer-surface relative mx-auto min-w-0 max-w-3xl rounded-lg border border-border bg-surface-alt p-0 shadow-sm transition-colors focus-within:border-accent"
			>
				{dragging && (
					<div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center rounded-lg border-2 border-dashed border-accent bg-surface/95 text-sm font-medium text-accent">
						Drop files to attach
					</div>
				)}
				{attachments.length > 0 && (
					<div className="flex flex-wrap gap-1.5 px-3 pt-2">
						{attachments.map((attachment) => (
							<span
								key={attachment.id}
								className="flex max-w-56 items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 text-xs text-text-secondary"
							>
								<span className="truncate">{attachment.file_name}</span>
								<button
									type="button"
									aria-label={`Remove ${attachment.file_name}`}
									title="Remove attachment"
									onClick={() => void removeAttachment(attachment)}
									className="shrink-0 text-text-muted hover:text-text-primary"
								>
									<X className="h-3.5 w-3.5" />
								</button>
							</span>
						))}
					</div>
				)}
				<div className="relative">
					<SlashToolMenu
						id={SLASH_TOOL_MENU_ID}
						items={slashTools}
						activeIndex={slashToolIndex}
						onSelect={selectSlashTool}
						onHover={setSlashToolIndex}
					/>
					<textarea
						autoComplete="off"
						ref={textareaRef}
						value={input}
						onChange={handleInput}
						onKeyDown={handleKeyDown}
						placeholder="Type a message"
						rows={2}
						maxLength={maximumContextSize}
						aria-autocomplete="list"
						aria-controls={showSlashTools ? SLASH_TOOL_MENU_ID : undefined}
						aria-activedescendant={
							showSlashTools && slashTools[slashToolIndex]
								? slashToolOptionId(slashTools[slashToolIndex].id)
								: undefined
						}
						className="chat-composer-input block max-h-[220px] min-h-[60px] w-full resize-none bg-transparent px-3.5 pb-1.5 pt-3 text-sm leading-5 text-text-primary placeholder:text-text-muted focus:outline-none focus-visible:shadow-none"
					/>
				</div>

				<div className="chat-composer-toolbar flex min-h-11 items-center justify-between gap-2 px-2 pb-2 pt-1">
					<div className="flex min-w-0 items-center gap-1">
						<input
							ref={fileInputRef}
							type="file"
							autoComplete="off"
							multiple
							accept="image/png,image/jpeg,image/gif,image/webp,image/bmp,text/*,.docx,.odt,.rtf,.html,.htm,.epub,.md,.json,.yaml,.yml,.toml"
							className="hidden"
							onChange={(event) => {
								if (event.target.files) void addFiles(event.target.files);
								event.target.value = "";
							}}
						/>
						<button
							type="button"
							onClick={() => fileInputRef.current?.click()}
							disabled={uploading || attachments.length >= 10}
							aria-label="Attach files"
							title="Attach files"
							className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:opacity-40"
						>
							{uploading ? (
								<Loader2 className="h-4 w-4 animate-spin" />
							) : (
								<Plus className="h-4 w-4" />
							)}
						</button>
						<fieldset
							ref={searchControlRef}
							className={`relative m-0 flex shrink-0 rounded-md border-0 p-0 ${
								effectiveSearchEnabled
									? "bg-accent/10 text-accent"
									: "text-text-secondary"
							}`}
						>
							<legend className="sr-only">Web search controls</legend>
							<button
								type="button"
								onClick={() => {
									setShowSearchMenu(false);
									if (nativeWebSearch) {
										toast.info(NATIVE_WEB_SEARCH_MESSAGE, 5000);
										focusTextarea();
										return;
									}
									setSearchEnabled(!searchEnabled);
								}}
								aria-label={
									nativeWebSearch
										? "Built-in web search enabled"
										: searchEnabled
											? "Disable web search"
											: "Enable web search"
								}
								aria-pressed={effectiveSearchEnabled}
								title={
									nativeWebSearch
										? "Built-in web search is always enabled for this model"
										: searchEnabled
											? `Disable web search (${selectedSearchProvider})`
											: "Enable web search"
								}
								className={`flex h-9 w-8 items-center justify-center transition-colors hover:bg-surface-hover hover:text-text-primary ${
									nativeWebSearch ? "rounded-md" : "rounded-l-md"
								}`}
							>
								<Globe className="h-4 w-4" />
							</button>
							{!nativeWebSearch && (
								<button
									ref={searchMenuButtonRef}
									type="button"
									onClick={() => {
										setShowSearchMenu((open) => !open);
									}}
									aria-label="Open web search settings"
									aria-haspopup="menu"
									aria-expanded={showSearchMenu}
									aria-controls={SEARCH_MENU_ID}
									title="Web search settings"
									className="flex h-9 w-5 items-center justify-center rounded-r-md transition-colors hover:bg-surface-hover hover:text-text-primary"
								>
									<ChevronDown className="h-3 w-3" />
								</button>
							)}

							{!nativeWebSearch && showSearchMenu && (
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
									className="absolute bottom-full left-0 z-30 mb-1 w-56 rounded-lg border border-border bg-surface p-1.5 text-text-primary shadow-2xl"
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
									<div className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium text-text-muted">
										Provider
									</div>
									{searchProviders.map((provider) => {
										const selected = provider.value === searchProvider;
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
												className={`flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left text-xs transition-colors hover:bg-surface-hover hover:text-text-primary ${
													selected
														? "bg-accent/10 text-text-primary"
														: "text-text-secondary"
												}`}
											>
												<span className="truncate">{provider.label}</span>
												<Check
													aria-hidden="true"
													className={`h-3.5 w-3.5 shrink-0 text-accent ${
														selected ? "opacity-100" : "opacity-0"
													}`}
												/>
											</button>
										);
									})}
									<hr className="my-1 border-0 border-t border-border" />
									<button
										type="button"
										role="menuitem"
										onClick={() => {
											closeSearchMenu(false);
											openSettings("search");
										}}
										className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-text-secondary hover:bg-surface-hover hover:text-text-primary"
									>
										<Settings2 className="h-3.5 w-3.5" />
										Configure web search
									</button>
								</div>
							)}
						</fieldset>
						{deepThinkingAvailable && (
							<button
								type="button"
								onClick={() => {
									setShowSearchMenu(false);
									setDeepThinking(!deepThinking);
									focusTextarea();
								}}
								aria-label={
									deepThinking
										? "Disable deep thinking"
										: "Enable deep thinking"
								}
								aria-pressed={deepThinking}
								title={
									deepThinking
										? "Deep thinking enabled"
										: "Enable deep thinking"
								}
								className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-surface-hover hover:text-text-primary ${
									deepThinking
										? "bg-accent/10 text-accent"
										: "text-text-secondary"
								}`}
							>
								<Brain className="h-4 w-4" />
							</button>
						)}
						{hasImages && !visionAvailable && (
							<select
								aria-label="Image processing method"
								value={
									imageStrategy === "vision_model"
										? visionSelection || "vision_model"
										: imageStrategy
								}
								onChange={(event) => {
									const value = event.target.value;
									if (value === "system_ocr") {
										setImageStrategy("system_ocr");
										setVisionSelection("");
									} else {
										setImageStrategy("vision_model");
										setVisionSelection(value === "vision_model" ? "" : value);
									}
								}}
								className="h-9 max-w-48 rounded-md border border-border bg-surface px-2 text-xs text-text-secondary"
							>
								<option value="">Process image...</option>
								<option value="system_ocr">System OCR</option>
								<option value="vision_model">Choose vision model...</option>
								{visionModels.map((model) => (
									<option key={model.value} value={model.value}>
										{model.label}
									</option>
								))}
							</select>
						)}
						{streaming && (
							<output className="ml-1 flex min-w-0 items-center gap-1.5 text-xs text-text-muted">
								<Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
								<span className="truncate">Generating</span>
							</output>
						)}
					</div>

					<div className="flex shrink-0 items-center gap-2">
						{showContextStatus && (
							<output
								aria-label="Context size"
								className="text-[11px] tabular-nums text-warning"
							>
								{charCount} / {maximumContextSize}
							</output>
						)}
						<button
							type="button"
							onClick={streaming ? stopStreaming : () => void handleSend()}
							disabled={
								!streaming &&
								((!input.trim() && attachments.length === 0) || uploading)
							}
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

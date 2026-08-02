import {
	ClipboardPaste,
	Copy,
	Edit3,
	Redo2,
	RefreshCcw,
	Scissors,
	TextSelect,
	Trash2,
	Undo2,
} from "lucide-react";
import {
	type KeyboardEvent as ReactKeyboardEvent,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import {
	canReadClipboardText,
	readClipboardText,
	writeClipboardText,
} from "../../services/clipboard";
import { confirm } from "../../stores/confirmStore";
import { useConversationStore } from "../../stores/conversationStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { toast } from "../../stores/toastStore";
import { globalContextMenuItemDefinition } from "./globalContextMenuItems";

type EditableTarget = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

interface MenuContext {
	x: number;
	y: number;
	target: HTMLElement;
	editable: EditableTarget | null;
	selectedText: string;
	messageId: string | null;
	messageRole: "user" | "assistant" | null;
}

interface MenuItem {
	id: string;
	label: string;
	icon: typeof Copy;
	shortcut?: string;
	disabled?: boolean;
	action: () => void | Promise<void>;
}

interface MenuSeparator {
	id: string;
	separator: true;
}

type MenuEntry = MenuItem | MenuSeparator;

const TEXT_INPUT_TYPES = new Set([
	"email",
	"password",
	"search",
	"tel",
	"text",
	"url",
]);

function editableTarget(target: HTMLElement): EditableTarget | null {
	const candidate = target.closest<HTMLElement>(
		'input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"]',
	);
	if (!candidate) return null;
	if (candidate instanceof HTMLInputElement) {
		return TEXT_INPUT_TYPES.has(candidate.type) ? candidate : null;
	}
	return candidate;
}

function editableSelection(target: EditableTarget): string {
	if (
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement
	) {
		const start = target.selectionStart ?? 0;
		const end = target.selectionEnd ?? start;
		return target.value.slice(start, end);
	}
	return window.getSelection()?.toString() ?? "";
}

function canModify(target: EditableTarget): boolean {
	if (
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement
	) {
		return !target.disabled && !target.readOnly;
	}
	return target.isContentEditable;
}

function replaceSelection(target: EditableTarget, text: string): void {
	target.focus();
	if (
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement
	) {
		const start = target.selectionStart ?? target.value.length;
		const end = target.selectionEnd ?? start;
		target.setRangeText(text, start, end, "end");
		target.dispatchEvent(new Event("input", { bubbles: true }));
		return;
	}
	document.execCommand("insertText", false, text);
}

function selectAll(target: EditableTarget): void {
	target.focus();
	if (
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement
	) {
		target.select();
		return;
	}
	const selection = window.getSelection();
	const range = document.createRange();
	range.selectNodeContents(target);
	selection?.removeAllRanges();
	selection?.addRange(range);
}

function shortcut(command: string): string {
	const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
	return `${isMac ? "⌘" : "Ctrl+"}${command}`;
}

export default function AppContextMenu() {
	const newConversation = useConversationStore(
		(state) => state.newConversation,
	);
	const openSettings = useSettingsStore((state) => state.openSettings);
	const globalContextMenuEnabled = useSettingsStore(
		(state) => state.globalContextMenuEnabled,
	);
	const globalContextMenuItems = useSettingsStore(
		(state) => state.globalContextMenuItems,
	);
	const messages = useConversationStore((state) => state.messages);
	const streaming = useConversationStore((state) => state.streaming);
	const startEditingMessage = useConversationStore(
		(state) => state.startEditingMessage,
	);
	const regenerateMessage = useConversationStore(
		(state) => state.regenerateMessage,
	);
	const deleteMessage = useConversationStore((state) => state.deleteMessage);
	const [context, setContext] = useState<MenuContext | null>(null);
	const [position, setPosition] = useState({ x: 0, y: 0 });
	const menuRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const open = (event: MouseEvent) => {
			if (event.defaultPrevented) return;
			if (!globalContextMenuEnabled) return;
			// Once takeover is enabled, even an empty custom menu suppresses native UI.
			event.preventDefault();
			const target = event.target;
			if (!(target instanceof HTMLElement)) return;
			const editable = editableTarget(target);
			const messageElement = target.closest<HTMLElement>(
				"[data-message-id][data-message-role]",
			);
			const messageRole = messageElement?.dataset.messageRole;
			const selectedText = editable
				? editableSelection(editable)
				: (window.getSelection()?.toString() ?? "");
			const hasGlobalItems = globalContextMenuItems.some(
				(item) => item.visible,
			);
			// All hidden means no global menu, while takeover keeps native UI suppressed.
			if (!editable && !messageElement && !selectedText && !hasGlobalItems)
				return;
			const rect = target.getBoundingClientRect();
			const x = event.clientX || rect.left;
			const y = event.clientY || rect.bottom;
			setPosition({ x, y });
			setContext({
				x,
				y,
				target,
				editable,
				selectedText,
				messageId: messageElement?.dataset.messageId ?? null,
				messageRole:
					messageRole === "user" || messageRole === "assistant"
						? messageRole
						: null,
			});
		};
		const close = (event: Event) => {
			if (
				event.type === "pointerdown" &&
				menuRef.current?.contains(event.target as Node)
			) {
				return;
			}
			setContext(null);
		};
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") setContext(null);
		};

		// Bubble after local surfaces so their purpose-built menus take precedence.
		window.addEventListener("contextmenu", open);
		window.addEventListener("pointerdown", close, true);
		window.addEventListener("scroll", close, true);
		window.addEventListener("resize", close);
		window.addEventListener("blur", close);
		window.addEventListener("keydown", closeOnEscape);
		return () => {
			window.removeEventListener("contextmenu", open);
			window.removeEventListener("pointerdown", close, true);
			window.removeEventListener("scroll", close, true);
			window.removeEventListener("resize", close);
			window.removeEventListener("blur", close);
			window.removeEventListener("keydown", closeOnEscape);
		};
	}, [globalContextMenuEnabled, globalContextMenuItems]);

	useLayoutEffect(() => {
		if (!context || !menuRef.current) return;
		const bounds = menuRef.current.getBoundingClientRect();
		const gutter = 8;
		setPosition({
			x: Math.max(
				gutter,
				Math.min(context.x, window.innerWidth - bounds.width - gutter),
			),
			y: Math.max(
				gutter,
				Math.min(context.y, window.innerHeight - bounds.height - gutter),
			),
		});
		// Keep pointer-opened menus neutral; keyboard navigation moves focus to items.
		menuRef.current.focus({ preventScroll: true });
	}, [context]);

	if (!context) return null;

	const close = () => setContext(null);
	const run = (action: () => void | Promise<void>) => {
		close();
		void Promise.resolve(action()).catch((error) => {
			toast.error(
				error instanceof Error ? error.message : "Context menu action failed",
			);
		});
	};
	const editable = context.editable;
	const modifiable = editable ? canModify(editable) : false;
	const hasSelection = context.selectedText.length > 0;
	const message = context.messageId
		? messages.find((item) => item.id === context.messageId)
		: undefined;
	const confirmDelete = async () => {
		if (!message) return;
		const confirmed = await confirm.ask(
			"Delete message?",
			"This action cannot be undone.",
			true,
		);
		if (confirmed) await deleteMessage(message.id);
	};

	let entries: MenuEntry[];
	if (message && context.messageRole) {
		entries = [
			{
				id: "copy-message",
				label: "Copy",
				icon: Copy,
				shortcut: shortcut("C"),
				action: () =>
					writeClipboardText(context.selectedText || message.content),
			},
			...(context.messageRole === "user"
				? [
						{
							id: "edit-message",
							label: "Edit",
							icon: Edit3,
							disabled: streaming,
							action: () => startEditingMessage(message.id),
						} satisfies MenuItem,
					]
				: [
						{
							id: "regenerate-message",
							label: "Regenerate",
							icon: RefreshCcw,
							disabled: streaming || !message.parent_id,
							action: () => regenerateMessage(message.id),
						} satisfies MenuItem,
					]),
			{ id: "message-separator", separator: true },
			{
				id: "delete-message",
				label: "Delete",
				icon: Trash2,
				disabled: streaming,
				action: confirmDelete,
			},
		];
	} else if (editable) {
		entries = [
			{
				id: "undo",
				label: "Undo",
				icon: Undo2,
				shortcut: shortcut("Z"),
				disabled: !modifiable,
				action: () => {
					editable.focus();
					document.execCommand("undo");
				},
			},
			{
				id: "redo",
				label: "Redo",
				icon: Redo2,
				shortcut: shortcut("Y"),
				disabled: !modifiable,
				action: () => {
					editable.focus();
					document.execCommand("redo");
				},
			},
			{ id: "history-separator", separator: true },
			{
				id: "cut",
				label: "Cut",
				icon: Scissors,
				shortcut: shortcut("X"),
				disabled: !modifiable || !hasSelection,
				action: async () => {
					await writeClipboardText(context.selectedText);
					replaceSelection(editable, "");
				},
			},
			{
				id: "copy",
				label: "Copy",
				icon: Copy,
				shortcut: shortcut("C"),
				disabled: !hasSelection,
				action: () => writeClipboardText(context.selectedText),
			},
			{
				id: "paste",
				label: "Paste",
				icon: ClipboardPaste,
				shortcut: shortcut("V"),
				disabled: !modifiable || !canReadClipboardText(),
				action: async () => {
					const text = await readClipboardText();
					replaceSelection(editable, text);
				},
			},
			{ id: "clipboard-separator", separator: true },
			{
				id: "select-all",
				label: "Select all",
				icon: TextSelect,
				shortcut: shortcut("A"),
				action: () => selectAll(editable),
			},
		];
	} else if (hasSelection) {
		entries = [
			{
				id: "copy",
				label: "Copy",
				icon: Copy,
				shortcut: shortcut("C"),
				action: () => writeClipboardText(context.selectedText),
			},
		];
	} else {
		entries = globalContextMenuItems.flatMap((preference) => {
			if (!preference.visible) return [];
			const definition = globalContextMenuItemDefinition(preference.id);
			if (!definition) return [];
			const entry: MenuItem = {
				id: preference.id,
				label: definition.label,
				icon: definition.icon,
				shortcut: preference.id === "settings" ? shortcut(",") : undefined,
				action:
					preference.id === "new-chat"
						? async () => {
								await newConversation();
							}
						: () => openSettings(),
			};
			return [entry];
		});
	}
	if (entries.length === 0) return null;

	const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
		if (!["ArrowDown", "ArrowUp", "Home", "End", "Tab"].includes(event.key)) {
			return;
		}
		event.preventDefault();
		const buttons = Array.from(
			menuRef.current?.querySelectorAll<HTMLButtonElement>(
				'button[role="menuitem"]:not(:disabled)',
			) ?? [],
		);
		if (buttons.length === 0) return;
		const current = buttons.indexOf(
			document.activeElement as HTMLButtonElement,
		);
		let next = 0;
		if (event.key === "End") next = buttons.length - 1;
		else if (event.key === "Tab") {
			next = event.shiftKey
				? (current - 1 + buttons.length) % buttons.length
				: (current + 1) % buttons.length;
		} else if (event.key === "ArrowDown") next = (current + 1) % buttons.length;
		else if (event.key === "ArrowUp") {
			next = (current - 1 + buttons.length) % buttons.length;
		}
		buttons[next]?.focus();
	};

	return (
		<div
			ref={menuRef}
			role="menu"
			tabIndex={-1}
			aria-label="EncoreHub context menu"
			onKeyDown={handleKeyDown}
			className="fixed z-[100] w-52 rounded-md border border-border bg-workspace p-1 shadow-[0_12px_32px_rgba(0,0,0,0.24)] focus:outline-none focus:shadow-[0_12px_32px_rgba(0,0,0,0.24)]"
			style={{ left: position.x, top: position.y }}
		>
			{entries.map((entry) => {
				if ("separator" in entry) {
					return (
						<hr
							key={entry.id}
							className="my-1 border-0 border-t border-border"
						/>
					);
				}
				const Icon = entry.icon;
				return (
					<button
						key={entry.id}
						type="button"
						role="menuitem"
						disabled={entry.disabled}
						onMouseDown={(event) => event.preventDefault()}
						onClick={() => run(entry.action)}
						className="flex h-8 w-full items-center gap-2 rounded px-2 text-left text-xs text-text-secondary hover:bg-surface-hover hover:text-text-primary focus:bg-surface-hover focus:text-text-primary focus:outline-none disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-text-secondary"
					>
						<Icon className="h-3.5 w-3.5 shrink-0" />
						<span className="min-w-0 flex-1 truncate">{entry.label}</span>
						{entry.shortcut && (
							<kbd className="shrink-0 font-sans text-[10px] text-text-muted">
								{entry.shortcut}
							</kbd>
						)}
					</button>
				);
			})}
		</div>
	);
}

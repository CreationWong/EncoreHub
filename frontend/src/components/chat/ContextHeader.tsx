import {
    ChevronRight,
    Loader2,
    MoreHorizontal,
    PanelLeft,
    PanelLeftClose,
    PanelRight,
    PanelRightClose,
    RefreshCw,
    Trash2,
} from "lucide-react";
import {useEffect, useRef, useState} from "react";
import {DEFAULT_CHARACTER_ID} from "../../services/characters";
import type {Conversation} from "../../services/conversation";
import {useCharacterManagerStore} from "../../stores/characterManagerStore";
import {useCharacterStore} from "../../stores/characterStore";
import {confirm} from "../../stores/confirmStore";
import {useContextManagementStore} from "../../stores/contextManagementStore";
import {useConversationStore} from "../../stores/conversationStore";
import {useSettingsStore} from "../../stores/settingsStore";
import CharacterAvatar from "../character/CharacterAvatar";
import CharacterUpgradeDialog from "../character/CharacterUpgradeDialog";
import {DEFAULT_CHARACTER_NAME} from "../character/DefaultCharacter";
import ProviderSwitcher from "./ProviderSwitcher";

function ConversationActions({
                                 conversation,
                             }: {
    conversation: Conversation;
}) {
    const generateTitle = useConversationStore((state) => state.generateTitle);
    const deleteConversation = useConversationStore(
        (state) => state.deleteConversation,
    );
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const closeOutside = (event: PointerEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
        };
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            setOpen(false);
            triggerRef.current?.focus();
        };
        document.addEventListener("pointerdown", closeOutside);
        window.addEventListener("keydown", closeOnEscape);
        return () => {
            document.removeEventListener("pointerdown", closeOutside);
            window.removeEventListener("keydown", closeOnEscape);
        };
    }, [open]);

    const remove = async () => {
        setOpen(false);
        const accepted = await confirm.ask(
            "Delete Conversation",
            `Delete "${conversation.title}"? This cannot be undone.`,
            true,
        );
        if (accepted) await deleteConversation(conversation.id);
        if (triggerRef.current?.isConnected) triggerRef.current.focus();
    };

    return (
        <div ref={rootRef} className="relative shrink-0">
            <button
                ref={triggerRef}
                type="button"
                onClick={() => setOpen((value) => !value)}
                onKeyDown={(event) => {
                    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
                    event.preventDefault();
                    setOpen(true);
                    requestAnimationFrame(() => {
                        const items =
                            menuRef.current?.querySelectorAll<HTMLButtonElement>(
                                '[role="menuitem"]',
                            ) ?? [];
                        const target =
                            event.key === "ArrowDown" ? items[0] : items[items.length - 1];
                        target?.focus();
                    });
                }}
                aria-label={`Actions for ${conversation.title}`}
                aria-haspopup="menu"
                aria-expanded={open}
                title="Conversation actions"
                className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-control hover:text-text-primary"
            >
                <MoreHorizontal className="h-4 w-4"/>
            </button>

            {open && (
                <div
                    ref={menuRef}
                    role="menu"
                    aria-label={`Actions for ${conversation.title}`}
                    onKeyDown={(event) => {
                        if (
                            event.key !== "ArrowDown" &&
                            event.key !== "ArrowUp" &&
                            event.key !== "Home" &&
                            event.key !== "End"
                        )
                            return;
                        event.preventDefault();
                        const items = Array.from(
                            menuRef.current?.querySelectorAll<HTMLButtonElement>(
                                '[role="menuitem"]',
                            ) ?? [],
                        );
                        const current = items.indexOf(
                            document.activeElement as HTMLButtonElement,
                        );
                        const next =
                            event.key === "Home"
                                ? 0
                                : event.key === "End"
                                    ? items.length - 1
                                    : (current +
                                        (event.key === "ArrowDown" ? 1 : -1) +
                                        items.length) %
                                    items.length;
                        items[next]?.focus();
                    }}
                    className="absolute right-0 top-full z-50 mt-2 w-48 rounded-md border border-border bg-workspace p-1 shadow-lg"
                >
                    <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                            setOpen(false);
                            triggerRef.current?.focus();
                            void generateTitle(conversation.id, true);
                        }}
                        className="flex h-8 w-full items-center gap-2 rounded px-2 text-sm text-text-secondary hover:bg-control hover:text-text-primary"
                    >
                        <RefreshCw className="h-3.5 w-3.5"/>
                        Regenerate title
                    </button>
                    <div className="my-1 border-t border-border"/>
                    <button
                        type="button"
                        role="menuitem"
                        onClick={() => void remove()}
                        className="flex h-8 w-full items-center gap-2 rounded px-2 text-sm text-danger hover:bg-danger-bg"
                    >
                        <Trash2 className="h-3.5 w-3.5"/>
                        Delete conversation
                    </button>
                </div>
            )}
        </div>
    );
}

export default function ContextHeader() {
    const activeId = useConversationStore((state) => state.activeId);
    const conversations = useConversationStore((state) => state.conversations);
    const characters = useCharacterStore((state) => state.characters);
    const openCharacter = useCharacterManagerStore(
        (state) => state.openCharacter,
    );
    const loading = useConversationStore((state) => state.loading);
    const streaming = useConversationStore((state) => state.streaming);
    const sidebarOpen = useSettingsStore((state) => state.sidebarOpen);
    const toggleSidebar = useSettingsStore((state) => state.toggleSidebar);
    const contextPanelOpen = useContextManagementStore(
        (state) => state.contextPanelOpen,
    );
    const setContextPanelOpen = useContextManagementStore(
        (state) => state.setContextPanelOpen,
    );
    const conversation = conversations.find((item) => item.id === activeId);
    const characterId = conversation?.character_id ?? DEFAULT_CHARACTER_ID;
    const latestCharacter = characters.find((item) => item.id === characterId);
    const characterSnapshot = conversation?.character_snapshot;
    const characterName =
        (characterSnapshot ? characterSnapshot.name : latestCharacter?.name) ||
        DEFAULT_CHARACTER_NAME;
    const characterAvatar = characterSnapshot
        ? characterSnapshot.avatar
        : (latestCharacter?.avatar ?? "");
    const title =
        conversation?.title ?? (activeId ? "Conversation" : "New conversation");
    const status = loading
        ? "Loading conversation"
        : streaming
            ? "Generating response"
            : null;

    return (
        <header
            aria-label="Conversation context"
            className="flex h-16 shrink-0 items-center gap-1 border-b border-border bg-workspace px-2"
        >
            <button
                type="button"
                onClick={toggleSidebar}
                aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
                title={sidebarOpen ? "Close sidebar" : "Open sidebar"}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-control hover:text-text-primary"
            >
                {sidebarOpen ? (
                    <PanelLeftClose className="h-4 w-4"/>
                ) : (
                    <PanelLeft className="h-4 w-4"/>
                )}
            </button>

            <button
                type="button"
                onClick={() => latestCharacter && openCharacter(latestCharacter.id)}
                disabled={!latestCharacter}
                aria-label={`Current character: ${characterName}`}
                className="flex min-w-24 max-w-40 flex-[0_3_auto] items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-control disabled:pointer-events-none"
                title={characterName}
            >
                <CharacterAvatar
                    avatar={characterAvatar}
                    characterId={characterId}
                    name={characterName}
                />
                <span className="min-w-0 max-w-32 truncate text-sm font-medium text-text-primary">
					{characterName}
				</span>
            </button>

            <ChevronRight
                aria-hidden="true"
                className="h-3.5 w-3.5 shrink-0 text-text-muted"
            />

            <h1
                title={title}
                className="min-w-8 max-w-72 flex-1 truncate text-sm font-medium text-text-primary"
            >
                {title}
            </h1>

            {conversation && latestCharacter && (
                <CharacterUpgradeDialog
                    conversation={conversation}
                    latestVersion={latestCharacter.version}
                />
            )}

            {status && (
                <output
                    aria-label={status}
                    title={status}
                    className="hidden h-8 shrink-0 items-center gap-1.5 px-1 text-[11px] text-text-muted min-[1200px]:flex"
                >
                    {loading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin"/>
                    ) : (
                        <span className="h-1.5 w-1.5 rounded-full bg-accent"/>
                    )}
                    <span className="hidden min-[1200px]:inline">{status}</span>
                </output>
            )}

            <div
                className="ml-auto w-[32%] min-w-24 max-w-xl shrink-0 min-[900px]:w-[40%] min-[1200px]:w-auto min-[1200px]:flex-[0_2_34rem]">
                <ProviderSwitcher/>
            </div>

            <div className="flex shrink-0 items-center gap-1">
                <button
                    type="button"
                    onClick={() => setContextPanelOpen(!contextPanelOpen)}
                    aria-label={contextPanelOpen ? "Close context panel" : "Open context panel"}
                    title={contextPanelOpen ? "Close context panel" : "Open context panel"}
                    aria-pressed={contextPanelOpen}
                    className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-control hover:text-text-primary"
                >
                    {contextPanelOpen ? (
                        <PanelRightClose className="h-4 w-4"/>
                    ) : (
                        <PanelRight className="h-4 w-4"/>
                    )}
                </button>
                {conversation && <ConversationActions conversation={conversation}/>}
            </div>
        </header>
    );
}

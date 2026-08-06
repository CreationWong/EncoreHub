import {
	ChevronRight,
	Loader2,
	PanelLeft,
	PanelLeftClose,
	PanelRight,
	PanelRightClose,
} from "lucide-react";
import { DEFAULT_CHARACTER_ID } from "../../services/characters";
import { useCharacterManagerStore } from "../../stores/characterManagerStore";
import { useCharacterStore } from "../../stores/characterStore";
import { useContextManagementStore } from "../../stores/contextManagementStore";
import { useConversationStore } from "../../stores/conversationStore";
import { useSettingsStore } from "../../stores/settingsStore";
import CharacterAvatar from "../character/CharacterAvatar";
import CharacterUpgradeDialog from "../character/CharacterUpgradeDialog";
import { DEFAULT_CHARACTER_NAME } from "../character/DefaultCharacter";
import ProviderSwitcher from "./ProviderSwitcher";

export default function ContextHeader() {
	const activeId = useConversationStore((state) => state.activeId);
	const conversations = useConversationStore((state) => state.conversations);
	const characters = useCharacterStore((state) => state.characters);
	const openCharacter = useCharacterManagerStore(
		(state) => state.openCharacter,
	);
	const loading = useConversationStore((state) => state.loading);
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
	const status = loading ? "Loading conversation" : null;

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
					<PanelLeftClose className="h-4 w-4" />
				) : (
					<PanelLeft className="h-4 w-4" />
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
					<Loader2 className="h-3.5 w-3.5 animate-spin" />
					<span className="hidden min-[1200px]:inline">{status}</span>
				</output>
			)}

			<div className="ml-auto min-w-24 max-w-[55%] shrink">
				<ProviderSwitcher />
			</div>

			<div className="flex shrink-0 items-center gap-1">
				<button
					type="button"
					onClick={() => setContextPanelOpen(!contextPanelOpen)}
					aria-label={
						contextPanelOpen ? "Close context panel" : "Open context panel"
					}
					title={
						contextPanelOpen ? "Close context panel" : "Open context panel"
					}
					aria-pressed={contextPanelOpen}
					className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-control hover:text-text-primary"
				>
					{contextPanelOpen ? (
						<PanelRightClose className="h-4 w-4" />
					) : (
						<PanelRight className="h-4 w-4" />
					)}
				</button>
			</div>
		</header>
	);
}

import { MessageSquarePlus, Settings } from "lucide-react";
import type { GlobalContextMenuItemId } from "../../stores/settingsStore";

export const GLOBAL_CONTEXT_MENU_ITEM_DEFINITIONS: ReadonlyArray<{
	id: GlobalContextMenuItemId;
	label: string;
	icon: typeof MessageSquarePlus;
}> = [
	{ id: "new-chat", label: "New conversation", icon: MessageSquarePlus },
	{ id: "settings", label: "Settings", icon: Settings },
];

export function globalContextMenuItemDefinition(id: GlobalContextMenuItemId) {
	return GLOBAL_CONTEXT_MENU_ITEM_DEFINITIONS.find((item) => item.id === id);
}

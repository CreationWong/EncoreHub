import { MessageSquarePlus, Settings } from "lucide-react";
import { t } from "../../i18n";
import type { GlobalContextMenuItemId } from "../../stores/settingsStore";

export const GLOBAL_CONTEXT_MENU_ITEM_DEFINITIONS: ReadonlyArray<{
	id: GlobalContextMenuItemId;
	labelKey: "contextMenu.newChat" | "contextMenu.settings";
	icon: typeof MessageSquarePlus;
}> = [
	{ id: "new-chat", labelKey: "contextMenu.newChat", icon: MessageSquarePlus },
	{ id: "settings", labelKey: "contextMenu.settings", icon: Settings },
];

export function globalContextMenuItemDefinition(id: GlobalContextMenuItemId) {
	const definition = GLOBAL_CONTEXT_MENU_ITEM_DEFINITIONS.find(
		(item) => item.id === id,
	);
	if (!definition) return undefined;
	return { ...definition, label: t(definition.labelKey) };
}

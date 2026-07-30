import { create } from "zustand";

export type WorkspaceTabId = "home" | "workbench" | "settings";

interface WorkspaceState {
	activeTab: WorkspaceTabId;
	openTabs: WorkspaceTabId[];
	openTab: (tab: WorkspaceTabId) => void;
	activateTab: (tab: WorkspaceTabId) => void;
	closeTab: (tab: WorkspaceTabId) => void;
}

const HOME_TAB: WorkspaceTabId = "home";

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
	activeTab: HOME_TAB,
	openTabs: [HOME_TAB],

	openTab: (tab) =>
		set((state) => ({
			activeTab: tab,
			openTabs: state.openTabs.includes(tab)
				? state.openTabs
				: [...state.openTabs, tab],
		})),

	activateTab: (tab) =>
		set((state) => {
			if (!state.openTabs.includes(tab)) return state;
			return { activeTab: tab };
		}),

	closeTab: (tab) =>
		set((state) => {
			if (tab === HOME_TAB || !state.openTabs.includes(tab)) return state;

			const closingIndex = state.openTabs.indexOf(tab);
			const openTabs = state.openTabs.filter((item) => item !== tab);
			if (state.activeTab !== tab) return { openTabs };

			const fallbackIndex = Math.max(
				0,
				Math.min(closingIndex - 1, openTabs.length - 1),
			);
			return {
				openTabs,
				activeTab: openTabs[fallbackIndex] ?? HOME_TAB,
			};
		}),
}));

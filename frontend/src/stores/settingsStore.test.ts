import { beforeEach, describe, expect, it, vi } from "vitest";

const webSearchMocks = vi.hoisted(() => ({
	getSettings: vi.fn(),
	saveSettings: vi.fn(),
}));

vi.mock("../services/webSearch", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../services/webSearch")>();
	return {
		...actual,
		webSearchApi: {
			...actual.webSearchApi,
			getSettings: (...args: unknown[]) => webSearchMocks.getSettings(...args),
			saveSettings: (...args: unknown[]) =>
				webSearchMocks.saveSettings(...args),
		},
	};
});

import { DEFAULT_WEB_SEARCH_SETTINGS } from "../services/webSearch";
import {
	DEFAULT_GLOBAL_CONTEXT_MENU_ITEMS,
	useSettingsStore,
} from "./settingsStore";
import { useWorkspaceStore } from "./workspaceStore";

beforeEach(() => {
	localStorage.clear();
	webSearchMocks.getSettings.mockReset();
	webSearchMocks.saveSettings.mockReset().mockResolvedValue(undefined);
	useSettingsStore.setState({
		sidebarOpen: true,
		sidebarMode: "conversations",
		sidebarWidth: 300,
		deepThinking: false,
		trafficLightWindowControls: false,
		globalContextMenuEnabled: true,
		globalContextMenuItems: DEFAULT_GLOBAL_CONTEXT_MENU_ITEMS.map((item) => ({
			...item,
		})),
		settingsTab: "about",
		devMode: false,
		fullCommunicationLogs: false,
		searchEnabled: false,
		searchProvider: "duckduckgo",
		searchMaxResults: DEFAULT_WEB_SEARCH_SETTINGS.max_results,
		searXNGSearchSettings: { ...DEFAULT_WEB_SEARCH_SETTINGS.searxng },
		openSERPSearchSettings: { ...DEFAULT_WEB_SEARCH_SETTINGS.openserp },
		searchSettingsLoaded: false,
	});
	useWorkspaceStore.setState({
		activeTab: "home",
		openTabs: ["home"],
	});
});

describe("settingsStore web search configuration", () => {
	it("loads Engine-backed search settings as the source of truth", async () => {
		webSearchMocks.getSettings.mockResolvedValue({
			enabled: true,
			provider: "searxng",
			max_results: 8,
			searxng: {
				endpoint: "https://search.example.com/api",
			},
		});

		await useSettingsStore.getState().loadWebSearchSettings();

		expect(useSettingsStore.getState()).toMatchObject({
			searchEnabled: true,
			searchProvider: "searxng",
			searchMaxResults: 8,
			searXNGSearchSettings: {
				endpoint: "https://search.example.com/api",
			},
			searchSettingsLoaded: true,
		});
		expect(localStorage.getItem("encorehub-search-provider")).toBe("searxng");
	});

	it("migrates the previous local selection when Engine has no configuration", async () => {
		localStorage.setItem("encorehub-search-enabled", "1");
		localStorage.setItem("encorehub-search-provider", "searxng");
		useSettingsStore.setState({
			searchEnabled: true,
			searchProvider: "searxng",
		});
		webSearchMocks.getSettings.mockResolvedValue(null);

		await useSettingsStore.getState().loadWebSearchSettings();

		expect(webSearchMocks.saveSettings).toHaveBeenCalledWith(
			expect.objectContaining({ enabled: true, provider: "searxng" }),
		);
		expect(useSettingsStore.getState().searchSettingsLoaded).toBe(true);
	});
});

describe("settingsStore sidebar preferences", () => {
	it("toggles the sidebar directly", () => {
		useSettingsStore.getState().toggleSidebar();
		expect(useSettingsStore.getState().sidebarOpen).toBe(false);

		useSettingsStore.getState().toggleSidebar();
		expect(useSettingsStore.getState().sidebarOpen).toBe(true);
	});

	it("persists the selected sidebar mode", () => {
		useSettingsStore.getState().setSidebarMode("characters");

		expect(useSettingsStore.getState().sidebarMode).toBe("characters");
		expect(localStorage.getItem("encorehub-sidebar-mode")).toBe("characters");
	});

	it("clamps sidebar width to the 260-380 target range", () => {
		useSettingsStore.getState().setSidebarWidth(100);
		expect(useSettingsStore.getState().sidebarWidth).toBe(260);
		useSettingsStore.getState().setSidebarWidth(900);
		expect(useSettingsStore.getState().sidebarWidth).toBe(380);
	});

	it("persists the deep-thinking preference", () => {
		useSettingsStore.getState().setDeepThinking(true);

		expect(useSettingsStore.getState().deepThinking).toBe(true);
		expect(localStorage.getItem("encorehub-deep-thinking")).toBe("1");
	});

	it("persists the optional traffic-light window style", () => {
		useSettingsStore.getState().setTrafficLightWindowControls(true);

		expect(useSettingsStore.getState().trafficLightWindowControls).toBe(true);
		expect(
			localStorage.getItem("encorehub-traffic-light-window-controls"),
		).toBe("1");
	});

	it("opens and closes Settings through the shared workspace tabs", () => {
		useSettingsStore.getState().openSettings("appearance");
		expect(useSettingsStore.getState().settingsTab).toBe("appearance");
		expect(useWorkspaceStore.getState()).toMatchObject({
			activeTab: "settings",
			openTabs: ["home", "settings"],
		});

		useSettingsStore.getState().closeSettings();
		expect(useWorkspaceStore.getState()).toMatchObject({
			activeTab: "home",
			openTabs: ["home"],
		});
	});

	it("persists full communication logging separately from developer mode", () => {
		useSettingsStore.getState().setDevMode(true);
		useSettingsStore.getState().setFullCommunicationLogs(true);

		expect(useSettingsStore.getState()).toMatchObject({
			devMode: true,
			fullCommunicationLogs: true,
		});
		expect(localStorage.getItem("encorehub-dev-mode")).toBe("1");
		expect(localStorage.getItem("encorehub-full-communication-logs")).toBe("1");
	});

	it("rejects full communication logging until developer mode is enabled", () => {
		useSettingsStore.getState().setFullCommunicationLogs(true);

		expect(useSettingsStore.getState().fullCommunicationLogs).toBe(false);
		expect(localStorage.getItem("encorehub-full-communication-logs")).toBe("0");
	});

	it("restores restricted logging and About when developer mode is disabled", () => {
		useSettingsStore.getState().setDevMode(true);
		useSettingsStore.getState().setFullCommunicationLogs(true);
		useSettingsStore.setState({ settingsTab: "logs" });

		useSettingsStore.getState().setDevMode(false);

		expect(useSettingsStore.getState()).toMatchObject({
			settingsTab: "about",
			devMode: false,
			fullCommunicationLogs: false,
		});
		expect(localStorage.getItem("encorehub-full-communication-logs")).toBe("0");
	});
});

describe("settingsStore global context menu preferences", () => {
	it("persists the global menu switch", () => {
		useSettingsStore.getState().setGlobalContextMenuEnabled(false);

		expect(useSettingsStore.getState().globalContextMenuEnabled).toBe(false);
		expect(localStorage.getItem("encorehub-global-context-menu-enabled")).toBe(
			"0",
		);
	});

	it("persists item visibility and drag order", () => {
		useSettingsStore
			.getState()
			.setGlobalContextMenuItemVisible("new-chat", false);
		useSettingsStore
			.getState()
			.moveGlobalContextMenuItem("settings", "new-chat");

		expect(useSettingsStore.getState().globalContextMenuItems).toEqual([
			{ id: "settings", visible: true },
			{ id: "new-chat", visible: false },
		]);
		expect(
			JSON.parse(
				localStorage.getItem("encorehub-global-context-menu-items") ?? "[]",
			),
		).toEqual([
			{ id: "settings", visible: true },
			{ id: "new-chat", visible: false },
		]);
	});
});

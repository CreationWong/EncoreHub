import { beforeEach, describe, expect, it } from "vitest";
import { useSettingsStore } from "./settingsStore";
import { useWorkspaceStore } from "./workspaceStore";

beforeEach(() => {
	localStorage.clear();
	useSettingsStore.setState({
		sidebarOpen: true,
		sidebarMode: "conversations",
		sidebarWidth: 300,
		deepThinking: false,
		trafficLightWindowControls: false,
		settingsTab: "about",
		devMode: false,
		fullCommunicationLogs: false,
	});
	useWorkspaceStore.setState({
		activeTab: "home",
		openTabs: ["home"],
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

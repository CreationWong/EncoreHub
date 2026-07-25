import { beforeEach, describe, expect, it } from "vitest";
import { useSettingsStore } from "./settingsStore";

beforeEach(() => {
	localStorage.clear();
	useSettingsStore.setState({
		sidebarOpen: true,
		focusMode: false,
		sidebarMode: "conversations",
		sidebarWidth: 300,
	});
});

describe("settingsStore focus mode", () => {
	it("hides the sidebar independently and restores it through the sidebar command", () => {
		useSettingsStore.getState().toggleFocusMode();
		expect(useSettingsStore.getState().focusMode).toBe(true);
		expect(useSettingsStore.getState().sidebarOpen).toBe(true);

		useSettingsStore.getState().toggleSidebar();
		expect(useSettingsStore.getState().focusMode).toBe(false);
		expect(useSettingsStore.getState().sidebarOpen).toBe(true);
	});
});

describe("settingsStore sidebar preferences", () => {
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
});

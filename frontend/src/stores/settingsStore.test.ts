import { beforeEach, describe, expect, it } from "vitest";
import { useSettingsStore } from "./settingsStore";

beforeEach(() => {
	localStorage.clear();
	useSettingsStore.setState({
		sidebarOpen: true,
		sidebarMode: "conversations",
		sidebarWidth: 300,
		deepThinking: false,
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
});

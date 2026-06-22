import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setTheme = vi.fn();
const toggleSidebar = vi.fn();
const openSettings = vi.fn();
const setSidebarWidth = vi.fn();

const settingsState = {
	sidebarOpen: true,
	sidebarWidth: 256,
	theme: "dark" as "dark" | "light" | "system",
	setTheme,
	toggleSidebar,
	openSettings,
	setSidebarWidth,
};

vi.mock("../../stores/settingsStore", () => ({
	useSettingsStore: <T,>(sel: (s: unknown) => T): T => sel(settingsState),
	SIDEBAR_MIN_WIDTH: 200,
	SIDEBAR_MAX_WIDTH: 480,
}));

// ConversationList + ProviderSwitcher pull from useConversationStore +
// hit network on mount; stub them so this test stays focused on Sidebar.
vi.mock("./ConversationList", () => ({ default: () => null }));
vi.mock("./ProviderSwitcher", () => ({ default: () => null }));

import Sidebar from "./Sidebar";

beforeEach(() => {
	setTheme.mockReset();
	toggleSidebar.mockReset();
	openSettings.mockReset();
	setSidebarWidth.mockReset();
	settingsState.sidebarOpen = true;
	settingsState.theme = "dark";
});

afterEach(cleanup);

describe("Sidebar theme toggle", () => {
	it("expanded: clicking the Sun (theme is dark) sets theme to light", () => {
		settingsState.theme = "dark";
		render(<Sidebar />);
		const btn = screen.getByTitle("Switch to light");
		fireEvent.click(btn);
		expect(setTheme).toHaveBeenCalledWith("light");
	});

	it("expanded: clicking the Moon (theme is light) sets theme to dark", () => {
		settingsState.theme = "light";
		render(<Sidebar />);
		const btn = screen.getByTitle("Switch to dark");
		fireEvent.click(btn);
		expect(setTheme).toHaveBeenCalledWith("dark");
	});

	it("collapsed: theme button still present and functional", () => {
		settingsState.sidebarOpen = false;
		settingsState.theme = "dark";
		render(<Sidebar />);
		const btn = screen.getByTitle("Switch to light");
		fireEvent.click(btn);
		expect(setTheme).toHaveBeenCalledWith("light");
	});

	it("expanded: Settings button calls openSettings", () => {
		render(<Sidebar />);
		fireEvent.click(screen.getByTitle("Settings (Ctrl+,)"));
		expect(openSettings).toHaveBeenCalled();
	});
});

describe("Sidebar resize", () => {
	it("dragging the resize handle updates the sidebar width", () => {
		settingsState.sidebarOpen = true;
		render(<Sidebar />);
		const handle = screen.getByLabelText("Resize sidebar");
		fireEvent.pointerDown(handle);
		// jsdom's PointerEvent ignores clientX; MouseEvent honors it and the
		// listener matches on the "pointermove" type regardless of constructor.
		window.dispatchEvent(new MouseEvent("pointermove", { clientX: 320 }));
		expect(setSidebarWidth).toHaveBeenCalled();
		// clientX is the desired width since the aside hugs the window's left edge
		// (getBoundingClientRect().left is 0 in jsdom).
		expect(setSidebarWidth).toHaveBeenLastCalledWith(320);
	});

	it("collapsed: no resize handle is rendered", () => {
		settingsState.sidebarOpen = false;
		render(<Sidebar />);
		expect(screen.queryByLabelText("Resize sidebar")).toBeNull();
	});
});

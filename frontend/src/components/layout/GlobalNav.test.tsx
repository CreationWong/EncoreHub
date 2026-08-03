import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerSettingsLeaveGuard } from "../settings/settingsLeaveGuard";

const setTheme = vi.fn();
const openSettings = vi.fn();
const closeSettings = vi.fn();
const openWorkspaceTab = vi.fn();
const activateTab = vi.fn();
const closeTab = vi.fn();
let workspaceState = {
	activeTab: "home" as "home" | "workbench" | "settings",
	openTabs: ["home"] as Array<"home" | "workbench" | "settings">,
};
const titlebarMocks = vi.hoisted(() => ({
	platform: "web" as "web" | "windows",
	toggleMaximize: vi.fn(),
}));

vi.mock("../../services/runtimePlatform", () => ({
	getRuntimePlatform: () => titlebarMocks.platform,
}));

vi.mock("../../hooks/useCustomTitlebar", () => ({
	useCustomTitlebar: () => titlebarMocks.platform === "windows",
}));

vi.mock("../../services/windowControls", () => ({
	toggleCurrentWindowMaximize: (...args: unknown[]) =>
		titlebarMocks.toggleMaximize(...args),
}));

vi.mock("./WindowControls", () => ({
	default: ({ enabled }: { enabled: boolean }) =>
		enabled ? <fieldset aria-label="Window controls" /> : null,
}));

vi.mock("../../stores/settingsStore", () => ({
	useSettingsStore: (
		selector: (state: {
			theme: "system";
			setTheme: typeof setTheme;
			openSettings: typeof openSettings;
			closeSettings: typeof closeSettings;
		}) => unknown,
	) =>
		selector({
			theme: "system",
			setTheme,
			openSettings,
			closeSettings,
		}),
}));

vi.mock("../../stores/workspaceStore", () => ({
	useWorkspaceStore: (
		selector: (state: {
			activeTab: typeof workspaceState.activeTab;
			openTabs: typeof workspaceState.openTabs;
			openTab: typeof openWorkspaceTab;
			activateTab: typeof activateTab;
			closeTab: typeof closeTab;
		}) => unknown,
	) =>
		selector({
			...workspaceState,
			openTab: openWorkspaceTab,
			activateTab,
			closeTab,
		}),
}));

import GlobalNav from "./GlobalNav";

describe("GlobalNav", () => {
	beforeEach(() => {
		document.documentElement.classList.remove("dark");
		setTheme.mockReset();
		openSettings.mockReset();
		closeSettings.mockReset();
		openWorkspaceTab.mockReset();
		activateTab.mockReset();
		closeTab.mockReset();
		workspaceState = { activeTab: "home", openTabs: ["home"] };
		titlebarMocks.platform = "web";
		titlebarMocks.toggleMaximize.mockReset().mockResolvedValue(undefined);
	});

	afterEach(cleanup);

	it("exposes Home, the workbench launcher, appearance, and settings", () => {
		render(<GlobalNav />);

		expect(
			screen.getByRole("navigation", { name: "Global navigation" }),
		).toBeDefined();
		expect(screen.getByRole("button", { name: "Home" })).toBeDefined();
		expect(
			screen.getByRole("button", { name: "Open workbench" }),
		).toBeDefined();
		expect(
			screen.getByRole("button", { name: "Switch appearance" }),
		).toBeDefined();
		expect(
			screen.getByRole("button", { name: "Open appearance menu" }),
		).toBeDefined();
		expect(screen.getByRole("button", { name: "Settings" })).toBeDefined();
		expect(screen.queryByRole("button", { name: "Characters" })).toBeNull();
		expect(screen.queryByRole("group", { name: "Window controls" })).toBeNull();
	});

	it("keeps the workbench plus adjacent to the browser tab strip", () => {
		workspaceState = {
			activeTab: "workbench",
			openTabs: ["home", "workbench"],
		};
		render(<GlobalNav />);

		const nav = screen.getByRole("navigation", { name: "Global navigation" });
		expect(nav.className).not.toContain("w-full");
		expect(nav.firstElementChild?.className).not.toContain("flex-1");
		expect(screen.queryByRole("button", { name: "Characters" })).toBeNull();
	});

	it("marks only Windows titlebar whitespace as draggable", () => {
		titlebarMocks.platform = "windows";
		render(<GlobalNav />);

		const header = screen.getByRole("banner");
		const dragRegion = screen.getByTestId("titlebar-drag-region");
		expect(header.hasAttribute("data-tauri-drag-region")).toBe(true);
		expect(dragRegion.hasAttribute("data-tauri-drag-region")).toBe(true);
		expect(
			screen
				.getByRole("button", { name: "Home" })
				.hasAttribute("data-tauri-drag-region"),
		).toBe(false);
		expect(
			screen.getByRole("group", { name: "Window controls" }),
		).toBeDefined();

		fireEvent.doubleClick(dragRegion);
		expect(titlebarMocks.toggleMaximize).toHaveBeenCalledTimes(1);
	});

	it("routes Home, plus, and Settings through their workspace actions", () => {
		render(<GlobalNav />);

		fireEvent.click(screen.getByRole("button", { name: "Home" }));
		fireEvent.click(screen.getByRole("button", { name: "Open workbench" }));
		fireEvent.click(screen.getByRole("button", { name: "Settings" }));

		expect(activateTab).toHaveBeenCalledWith("home");
		expect(openWorkspaceTab).toHaveBeenCalledWith("workbench");
		expect(openSettings).toHaveBeenCalledTimes(1);
	});

	it("activates and closes dynamic workspace tabs without duplicates", () => {
		workspaceState = {
			activeTab: "settings",
			openTabs: ["home", "workbench", "settings"],
		};
		render(<GlobalNav />);

		fireEvent.click(screen.getByRole("button", { name: "Workbench" }));
		fireEvent.click(
			screen.getByRole("button", { name: "Close Workbench tab" }),
		);
		fireEvent.click(screen.getByRole("button", { name: "Close Settings tab" }));

		expect(activateTab).toHaveBeenCalledWith("workbench");
		expect(closeTab).toHaveBeenCalledWith("workbench");
		expect(closeSettings).toHaveBeenCalledTimes(1);
	});

	it("keeps Settings open when its unsaved-change guard cancels", async () => {
		workspaceState = {
			activeTab: "settings",
			openTabs: ["home", "settings"],
		};
		const unregister = registerSettingsLeaveGuard(async () => false);
		try {
			render(<GlobalNav />);

			fireEvent.click(screen.getByRole("button", { name: "Home" }));
			fireEvent.click(
				screen.getByRole("button", { name: "Close Settings tab" }),
			);
			await Promise.resolve();

			expect(activateTab).not.toHaveBeenCalled();
			expect(closeSettings).not.toHaveBeenCalled();
		} finally {
			unregister();
		}
	});

	it("selects a theme from the appearance menu", () => {
		render(<GlobalNav />);
		fireEvent.click(
			screen.getByRole("button", { name: "Open appearance menu" }),
		);

		const system = screen.getByRole("menuitemradio", { name: "System" });
		expect(system.getAttribute("aria-checked")).toBe("true");
		fireEvent.click(screen.getByRole("menuitemradio", { name: "Light" }));

		expect(setTheme).toHaveBeenCalledWith("light");
		expect(screen.queryByRole("menu", { name: "Appearance" })).toBeNull();
	});

	it("switches the rendered theme directly from the main appearance icon", () => {
		render(<GlobalNav />);
		fireEvent.click(screen.getByRole("button", { name: "Switch appearance" }));

		expect(setTheme).toHaveBeenCalledWith("dark");
		expect(screen.queryByRole("menu", { name: "Appearance" })).toBeNull();
	});

	it("closes the appearance menu on Escape and restores trigger focus", () => {
		render(<GlobalNav />);
		const trigger = screen.getByRole("button", {
			name: "Open appearance menu",
		});
		fireEvent.click(trigger);
		fireEvent.keyDown(window, { key: "Escape" });

		expect(screen.queryByRole("menu", { name: "Appearance" })).toBeNull();
		expect(document.activeElement).toBe(trigger);
	});

	it("moves through appearance options with arrow keys", async () => {
		render(<GlobalNav />);
		const trigger = screen.getByRole("button", {
			name: "Open appearance menu",
		});
		fireEvent.keyDown(trigger, { key: "ArrowDown" });
		const light = screen.getByRole("menuitemradio", { name: "Light" });
		const dark = screen.getByRole("menuitemradio", { name: "Dark" });
		await waitFor(() => expect(document.activeElement).toBe(light));

		fireEvent.keyDown(light, { key: "ArrowDown" });
		expect(document.activeElement).toBe(dark);
		fireEvent.keyDown(dark, { key: "End" });
		expect(document.activeElement).toBe(
			screen.getByRole("menuitemradio", { name: "System" }),
		);
	});
});

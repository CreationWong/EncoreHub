import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const newConversation = vi.fn();
const setTheme = vi.fn();
const openSettings = vi.fn();
const closeSettings = vi.fn();
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

vi.mock("../../stores/conversationStore", () => ({
	useConversationStore: (
		selector: (state: { newConversation: typeof newConversation }) => unknown,
	) => selector({ newConversation }),
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

import GlobalNav from "./GlobalNav";

describe("GlobalNav", () => {
	beforeEach(() => {
		document.documentElement.classList.remove("dark");
		newConversation.mockReset().mockResolvedValue("conversation-1");
		setTheme.mockReset();
		openSettings.mockReset();
		closeSettings.mockReset();
		titlebarMocks.platform = "web";
		titlebarMocks.toggleMaximize.mockReset().mockResolvedValue(undefined);
	});

	afterEach(cleanup);

	it("exposes only the connected home, new, appearance, and settings commands", () => {
		render(<GlobalNav />);

		expect(
			screen.getByRole("navigation", { name: "Global navigation" }),
		).toBeDefined();
		expect(screen.getByRole("button", { name: "Home" })).toBeDefined();
		expect(
			screen.getByRole("button", { name: "New conversation" }),
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

	it("routes home, new conversation, and settings to the existing stores", () => {
		render(<GlobalNav />);

		fireEvent.click(screen.getByRole("button", { name: "Home" }));
		fireEvent.click(screen.getByRole("button", { name: "New conversation" }));
		fireEvent.click(screen.getByRole("button", { name: "Settings" }));

		expect(closeSettings).toHaveBeenCalledTimes(1);
		expect(newConversation).toHaveBeenCalledTimes(1);
		expect(openSettings).toHaveBeenCalledTimes(1);
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

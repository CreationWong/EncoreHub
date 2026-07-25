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
		newConversation.mockReset().mockResolvedValue("conversation-1");
		setTheme.mockReset();
		openSettings.mockReset();
		closeSettings.mockReset();
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
		expect(screen.getByRole("button", { name: "Appearance" })).toBeDefined();
		expect(screen.getByRole("button", { name: "Settings" })).toBeDefined();
		expect(screen.queryByRole("button", { name: "Characters" })).toBeNull();
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
		fireEvent.click(screen.getByRole("button", { name: "Appearance" }));

		const system = screen.getByRole("menuitemradio", { name: "System" });
		expect(system.getAttribute("aria-checked")).toBe("true");
		fireEvent.click(screen.getByRole("menuitemradio", { name: "Light" }));

		expect(setTheme).toHaveBeenCalledWith("light");
		expect(screen.queryByRole("menu", { name: "Appearance" })).toBeNull();
	});

	it("closes the appearance menu on Escape and restores trigger focus", () => {
		render(<GlobalNav />);
		const trigger = screen.getByRole("button", { name: "Appearance" });
		fireEvent.click(trigger);
		fireEvent.keyDown(window, { key: "Escape" });

		expect(screen.queryByRole("menu", { name: "Appearance" })).toBeNull();
		expect(document.activeElement).toBe(trigger);
	});

	it("moves through appearance options with arrow keys", async () => {
		render(<GlobalNav />);
		const trigger = screen.getByRole("button", { name: "Appearance" });
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

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setProvider = vi.fn();
const settingsState = {
	provider: "deepseek",
	model: "deepseek-chat",
	setProvider,
};

const providerState = {
	profiles: [
		{
			id: "deepseek",
			name: "DeepSeek",
			enabled: true,
			models: ["deepseek-chat", "deepseek-reasoner"],
		},
		{
			id: "disabled",
			name: "Disabled",
			enabled: false,
			models: ["disabled-model"],
		},
	],
};

vi.mock("../../stores/settingsStore", () => ({
	useSettingsStore: <T,>(selector: (state: typeof settingsState) => T): T =>
		selector(settingsState),
}));

vi.mock("../../stores/providerStore", () => ({
	useProviderStore: <T,>(selector: (state: typeof providerState) => T): T =>
		selector(providerState),
}));

import ProviderSwitcher from "./ProviderSwitcher";

beforeEach(() => setProvider.mockReset());
afterEach(cleanup);

describe("ProviderSwitcher", () => {
	it("shows the current global selection and changes models", () => {
		render(<ProviderSwitcher />);
		const trigger = screen.getByRole("button", {
			name: "Select provider and model",
		});
		expect(trigger.getAttribute("title")).toBe("DeepSeek · deepseek-chat");

		fireEvent.click(trigger);
		expect(screen.queryByText("Disabled")).toBeNull();
		fireEvent.click(
			screen.getByRole("menuitemradio", { name: "deepseek-reasoner" }),
		);
		expect(setProvider).toHaveBeenCalledWith("deepseek", "deepseek-reasoner");
	});

	it("closes on Escape and returns focus to the trigger", () => {
		render(<ProviderSwitcher />);
		const trigger = screen.getByRole("button", {
			name: "Select provider and model",
		});
		fireEvent.click(trigger);
		fireEvent.keyDown(window, { key: "Escape" });

		expect(screen.queryByRole("menu")).toBeNull();
		expect(document.activeElement).toBe(trigger);
	});
});

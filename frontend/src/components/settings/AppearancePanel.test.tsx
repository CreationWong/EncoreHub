import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "../../stores/settingsStore";

const runtime = vi.hoisted(() => ({ platform: "windows" }));

vi.mock("../../services/runtimePlatform", () => ({
	getRuntimePlatform: () => runtime.platform,
}));

import AppearancePanel from "./AppearancePanel";

describe("AppearancePanel", () => {
	beforeEach(() => {
		localStorage.clear();
		runtime.platform = "windows";
		useSettingsStore.setState({
			theme: "dark",
			trafficLightWindowControls: false,
		});
	});

	afterEach(cleanup);

	it("changes the application theme from a compact segmented control", () => {
		render(<AppearancePanel />);
		fireEvent.click(screen.getByRole("button", { name: "Light" }));

		expect(useSettingsStore.getState().theme).toBe("light");
		expect(
			screen
				.getByRole("button", { name: "Light" })
				.getAttribute("aria-pressed"),
		).toBe("true");
	});

	it("offers and persists the optional traffic-light style on Windows", () => {
		render(<AppearancePanel />);
		const toggle = screen.getByRole("switch", {
			name: "Use traffic-light window controls",
		});
		fireEvent.click(toggle);

		expect(useSettingsStore.getState().trafficLightWindowControls).toBe(true);
		expect(
			localStorage.getItem("encorehub-traffic-light-window-controls"),
		).toBe("1");
	});

	it("does not expose the traffic-light style switch on macOS", () => {
		runtime.platform = "macos";
		render(<AppearancePanel />);

		expect(
			screen.queryByRole("switch", {
				name: "Use traffic-light window controls",
			}),
		).toBeNull();
		expect(screen.queryByText("Window controls")).toBeNull();
	});
});

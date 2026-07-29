import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "../../stores/settingsStore";

vi.mock("./ProvidersPanel", () => ({ default: () => <p>Providers panel</p> }));
vi.mock("./AppearancePanel", () => ({
	default: () => <p>Appearance panel</p>,
}));
vi.mock("./SkillsPanel", () => ({ default: () => <p>Skills panel</p> }));
vi.mock("./KnowledgePanel", () => ({ default: () => <p>Knowledge panel</p> }));
vi.mock("./MemoryPanel", () => ({ default: () => <p>Memories panel</p> }));
vi.mock("./SecurityPanel", () => ({ default: () => <p>Security panel</p> }));
vi.mock("./AboutPanel", () => ({ default: () => <p>About panel</p> }));
vi.mock("./DeveloperPanel", () => ({ default: () => <p>Developer panel</p> }));

import SettingsModal from "./SettingsModal";

describe("SettingsModal information architecture", () => {
	beforeEach(() => {
		useSettingsStore.setState({
			settingsOpen: true,
			settingsTab: "about",
			devMode: false,
		});
	});

	afterEach(cleanup);

	it("groups settings and keeps About permanently available", async () => {
		render(<SettingsModal />);

		expect(
			screen.getByRole("navigation", { name: "Settings sections" }),
		).toBeDefined();
		expect(screen.getByText("General")).toBeDefined();
		expect(screen.getByText("Capabilities")).toBeDefined();
		expect(screen.getByText("Data & safety")).toBeDefined();
		expect(screen.getByText("System")).toBeDefined();
		expect(await screen.findByText("About panel")).toBeDefined();
		expect(screen.queryByRole("button", { name: "Developer" })).toBeNull();
	});

	it("reveals the Developer destination only when developer tools are enabled", async () => {
		useSettingsStore.setState({ devMode: true });
		render(<SettingsModal />);

		fireEvent.click(screen.getByRole("button", { name: "Developer" }));
		expect(await screen.findByText("Developer panel")).toBeDefined();
		expect(useSettingsStore.getState().settingsTab).toBe("developer");
	});

	it("returns to About if developer mode is disabled on the Developer tab", async () => {
		useSettingsStore.setState({ settingsTab: "developer", devMode: false });
		render(<SettingsModal />);

		expect(await screen.findByText("About panel")).toBeDefined();
		expect(useSettingsStore.getState().settingsTab).toBe("about");
	});
});

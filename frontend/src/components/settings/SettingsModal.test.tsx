import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type SettingsTab, useSettingsStore } from "../../stores/settingsStore";

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
vi.mock("./ProcessesPanel", () => ({ default: () => <p>Processes panel</p> }));
vi.mock("./LogsPanel", () => ({ default: () => <p>Logs panel</p> }));
vi.mock("./DatabasePanel", () => ({ default: () => <p>Database panel</p> }));

import SettingsModal from "./SettingsModal";

describe("Settings workspace information architecture", () => {
	beforeEach(() => {
		useSettingsStore.setState({
			settingsTab: "about",
			devMode: false,
		});
	});

	afterEach(cleanup);

	it("groups settings and keeps About permanently available", async () => {
		render(<SettingsModal />);

		expect(screen.getByRole("region", { name: "Settings" })).toBeDefined();
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(screen.queryByRole("button", { name: "Close settings" })).toBeNull();
		expect(
			screen.getByRole("navigation", { name: "Settings sections" }),
		).toBeDefined();
		expect(screen.getByText("General")).toBeDefined();
		expect(screen.getByText("Capabilities")).toBeDefined();
		expect(screen.getByText("Data & safety")).toBeDefined();
		expect(screen.getByText("System")).toBeDefined();
		expect(await screen.findByText("About panel")).toBeDefined();
		for (const label of ["Developer", "Processes", "Logs", "Database"]) {
			expect(screen.queryByRole("button", { name: label })).toBeNull();
		}
	});

	it("reveals each developer destination only when developer tools are enabled", async () => {
		useSettingsStore.setState({ devMode: true });
		render(<SettingsModal />);

		const destinations = [
			["Developer", "Developer panel", "developer"],
			["Processes", "Processes panel", "processes"],
			["Logs", "Logs panel", "logs"],
			["Database", "Database panel", "database"],
		] as const;

		for (const [label, panel, tab] of destinations) {
			fireEvent.click(screen.getByRole("button", { name: label }));
			expect(await screen.findByText(panel)).toBeDefined();
			expect(useSettingsStore.getState().settingsTab).toBe(tab);
		}
	});

	it.each([
		"developer",
		"processes",
		"logs",
		"database",
	] satisfies SettingsTab[])(
		"returns to About if developer mode is disabled on the %s tab",
		async (settingsTab) => {
			useSettingsStore.setState({ settingsTab, devMode: false });
			render(<SettingsModal />);

			expect(await screen.findByText("About panel")).toBeDefined();
			expect(useSettingsStore.getState().settingsTab).toBe("about");
		},
	);
});

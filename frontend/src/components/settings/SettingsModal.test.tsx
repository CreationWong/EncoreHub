import {
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type SettingsTab, useSettingsStore } from "../../stores/settingsStore";
import { registerSettingsLeaveGuard } from "./settingsLeaveGuard";

vi.mock("./ProvidersPanel", () => ({ default: () => <p>Providers panel</p> }));
vi.mock("./AppearancePanel", () => ({
	default: () => <p>Appearance panel</p>,
}));
vi.mock("./ContextMenuPanel", () => ({
	default: () => <p>Context menu panel</p>,
}));
vi.mock("./SkillsPanel", () => ({ default: () => <p>Skills panel</p> }));
vi.mock("./SearchPanel", () => ({ default: () => <p>Search panel</p> }));
vi.mock("./KnowledgePanel", () => ({ default: () => <p>Knowledge panel</p> }));
vi.mock("./MemoryPanel", () => ({ default: () => <p>Memories panel</p> }));
vi.mock("./ModelMetadataPanel", () => ({
	default: () => <p>Model metadata panel</p>,
}));
vi.mock("./UsagePanel", () => ({ default: () => <p>Usage panel</p> }));
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

	it("opens web search configuration as an AI tool", async () => {
		render(<SettingsModal />);

		fireEvent.click(screen.getByRole("button", { name: "Web search" }));
		expect(await screen.findByText("Search panel")).toBeDefined();
		expect(useSettingsStore.getState().settingsTab).toBe("search");
	});

	it("opens model metadata providers as an AI tool", async () => {
		render(<SettingsModal />);

		fireEvent.click(screen.getByRole("button", { name: "Model metadata" }));

		expect(await screen.findByText("Model metadata panel")).toBeDefined();
		expect(useSettingsStore.getState().settingsTab).toBe("model-metadata");
	});

	it("opens global context menu management as an interface setting", async () => {
		render(<SettingsModal />);

		fireEvent.click(screen.getByRole("button", { name: "Context menu" }));

		expect(await screen.findByText("Context menu panel")).toBeDefined();
		expect(useSettingsStore.getState().settingsTab).toBe("context-menu");
	});

	it("does not leave Providers when its unsaved-change guard cancels", async () => {
		useSettingsStore.setState({ settingsTab: "providers" });
		const unregister = registerSettingsLeaveGuard(async () => false);
		try {
			render(<SettingsModal />);

			fireEvent.click(screen.getByRole("button", { name: "Appearance" }));
			await Promise.resolve();

			expect(useSettingsStore.getState().settingsTab).toBe("providers");
		} finally {
			unregister();
		}
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
		expect(screen.getByText("Interface")).toBeDefined();
		expect(screen.getByText("AI & tools")).toBeDefined();
		expect(screen.getByText("Data & privacy")).toBeDefined();
		expect(screen.getByText("System")).toBeDefined();
		const titlesIn = (group: string) =>
			within(screen.getByRole("group", { name: group }))
				.getAllByRole("button")
				.map((button) => button.getAttribute("title"));
		expect(titlesIn("Interface")).toEqual(["Appearance", "Context menu"]);
		expect(titlesIn("AI & tools")).toEqual([
			"Providers",
			"Model metadata",
			"Web search",
			"Skills",
			"Usage",
		]);
		expect(titlesIn("Data & privacy")).toEqual([
			"Knowledge",
			"Memories",
			"Security",
		]);
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

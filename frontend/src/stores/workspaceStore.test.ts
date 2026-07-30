import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspaceStore } from "./workspaceStore";

beforeEach(() => {
	useWorkspaceStore.setState({
		activeTab: "home",
		openTabs: ["home"],
	});
});

describe("workspaceStore browser-style tabs", () => {
	it("opens each workspace once and activates an existing tab", () => {
		const workspace = useWorkspaceStore.getState();
		workspace.openTab("settings");
		workspace.openTab("workbench");
		workspace.openTab("settings");

		expect(useWorkspaceStore.getState()).toMatchObject({
			activeTab: "settings",
			openTabs: ["home", "settings", "workbench"],
		});
	});

	it("returns to the tab on the left when closing the active tab", () => {
		useWorkspaceStore.setState({
			activeTab: "settings",
			openTabs: ["home", "workbench", "settings"],
		});

		useWorkspaceStore.getState().closeTab("settings");

		expect(useWorkspaceStore.getState()).toMatchObject({
			activeTab: "workbench",
			openTabs: ["home", "workbench"],
		});
	});

	it("keeps Home pinned and leaves the active tab alone when closing another", () => {
		useWorkspaceStore.setState({
			activeTab: "settings",
			openTabs: ["home", "workbench", "settings"],
		});

		useWorkspaceStore.getState().closeTab("home");
		useWorkspaceStore.getState().closeTab("workbench");

		expect(useWorkspaceStore.getState()).toMatchObject({
			activeTab: "settings",
			openTabs: ["home", "settings"],
		});
	});
});

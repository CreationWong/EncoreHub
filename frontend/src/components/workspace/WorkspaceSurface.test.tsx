import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceStore } from "../../stores/workspaceStore";

vi.mock("../chat/ChatView", () => ({
	default: () => <div>Chat workspace</div>,
}));
vi.mock("../sidebar/Sidebar", () => ({
	default: () => <aside>Conversation sidebar</aside>,
}));
vi.mock("../settings/SettingsModal", () => ({
	default: () => <div>Settings workspace</div>,
}));
vi.mock("./WorkspaceLauncher", () => ({
	default: () => <div>Workbench workspace</div>,
}));

import WorkspaceSurface from "./WorkspaceSurface";

describe("WorkspaceSurface", () => {
	beforeEach(() => {
		useWorkspaceStore.setState({
			activeTab: "home",
			openTabs: ["home"],
		});
	});

	afterEach(cleanup);

	it("keeps chat and its sidebar mounted as the Home workspace", () => {
		render(<WorkspaceSurface />);

		expect(screen.getByText("Chat workspace")).toBeDefined();
		expect(screen.getByText("Conversation sidebar")).toBeDefined();
	});

	it("keeps open workspaces mounted while showing only the active tab", async () => {
		useWorkspaceStore.setState({
			activeTab: "settings",
			openTabs: ["home", "settings"],
		});
		const { rerender } = render(<WorkspaceSurface />);
		await waitFor(() =>
			expect(screen.getByText("Settings workspace")).toBeDefined(),
		);
		expect(screen.getByText("Conversation sidebar")).toBeDefined();
		expect(
			document.querySelector('[data-workspace-tab="home"]')?.className,
		).toContain("hidden");

		useWorkspaceStore.setState({
			activeTab: "workbench",
			openTabs: ["home", "settings", "workbench"],
		});
		rerender(<WorkspaceSurface />);
		await waitFor(() =>
			expect(screen.getByText("Workbench workspace")).toBeDefined(),
		);
		expect(screen.getByText("Settings workspace")).toBeDefined();
		expect(
			document
				.querySelector('[data-workspace-tab="settings"]')
				?.hasAttribute("hidden"),
		).toBe(true);
	});
});

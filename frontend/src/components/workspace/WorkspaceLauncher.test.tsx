import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const newConversation = vi.fn();
const openSettings = vi.fn();
const activateTab = vi.fn();
const openTab = vi.fn();

vi.mock("../../stores/conversationStore", () => ({
	useConversationStore: (
		selector: (state: { newConversation: typeof newConversation }) => unknown,
	) => selector({ newConversation }),
}));

vi.mock("../../stores/settingsStore", () => ({
	useSettingsStore: (
		selector: (state: {
			openSettings: typeof openSettings;
		}) => unknown,
	) => selector({ openSettings }),
}));

vi.mock("../../stores/workspaceStore", () => ({
	useWorkspaceStore: (
		selector: (state: {
			activateTab: typeof activateTab;
			openTab: typeof openTab;
		}) => unknown,
	) => selector({ activateTab, openTab }),
}));

import WorkspaceLauncher from "./WorkspaceLauncher";

describe("WorkspaceLauncher", () => {
	beforeEach(() => {
		newConversation.mockReset().mockResolvedValue("conversation-1");
		openSettings.mockReset();
		activateTab.mockReset();
		openTab.mockReset();
	});

	afterEach(cleanup);

	it("launches existing application actions from the workbench", async () => {
		render(<WorkspaceLauncher />);

		fireEvent.click(screen.getByRole("button", { name: "New conversation" }));
		await waitFor(() => expect(activateTab).toHaveBeenCalledWith("home"));

		expect(screen.queryByRole("button", { name: "Characters" })).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Multi-AI chat" }));
		expect(openTab).toHaveBeenCalledWith("multi-chat");

		fireEvent.click(screen.getByRole("button", { name: "Settings" }));
		expect(openSettings).toHaveBeenCalledWith();
		expect(screen.queryByRole("button", { name: "Providers" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Developer" })).toBeNull();
	});
});

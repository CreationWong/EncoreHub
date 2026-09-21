import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../services/groupChat", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../../services/groupChat")>();
	return {
		...actual,
		groupChatSettingsApi: { load: vi.fn(), save: vi.fn() },
	};
});

import { groupChatSettingsApi } from "../../services/groupChat";
import GroupChatSettingsPanel from "./GroupChatSettingsPanel";

const loadMock = vi.mocked(groupChatSettingsApi.load);
const saveMock = vi.mocked(groupChatSettingsApi.save);

beforeEach(() => {
	vi.clearAllMocks();
	loadMock.mockResolvedValue({
		auto_chat_enabled: true,
		max_auto_turns: 6,
		allow_bot_mentions: true,
		paused: false,
		user_persona: { name: "我", avatar: "", description: "" },
	});
	saveMock.mockResolvedValue();
});

afterEach(cleanup);

describe("GroupChatSettingsPanel", () => {
	it("loads the global defaults and saves edits", async () => {
		render(<GroupChatSettingsPanel />);

		const name = await screen.findByDisplayValue("我");
		expect(name).toBeDefined();

		const maxTurns = screen.getByLabelText(/Max auto turns|连续自动轮数/);
		fireEvent.change(maxTurns, { target: { value: "" } });

		fireEvent.click(screen.getByRole("button", { name: /Save settings/ }));

		await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
		expect(saveMock).toHaveBeenCalledWith(
			expect.objectContaining({
				max_auto_turns: null,
				paused: false,
				user_persona: expect.objectContaining({ name: "我" }),
			}),
		);
	});
});

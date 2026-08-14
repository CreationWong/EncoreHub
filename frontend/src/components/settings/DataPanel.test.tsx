/** Interaction tests for user-data backup and destructive cleanup workflows. */

import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
	overview,
	conversations,
	exportData,
	exportConversations,
	importData,
	deleteConversations,
	clearHistory,
	clearCache,
	reloadAfterDataChange,
	show,
	toastSuccess,
	toastError,
} = vi.hoisted(() => ({
	overview: vi.fn(),
	conversations: vi.fn(),
	exportData: vi.fn(),
	exportConversations: vi.fn(),
	importData: vi.fn(),
	deleteConversations: vi.fn(),
	clearHistory: vi.fn(),
	clearCache: vi.fn(),
	reloadAfterDataChange: vi.fn(),
	show: vi.fn(),
	toastSuccess: vi.fn(),
	toastError: vi.fn(),
}));

vi.mock("../../services/dataManagement", () => ({
	dataManagementApi: {
		overview,
		conversations,
		exportData,
		exportConversations,
		importData,
		deleteConversations,
		clearHistory,
		clearCache,
	},
}));
vi.mock("../../stores/conversationStore", () => ({
	useConversationStore: (
		selector: (state: {
			reloadAfterDataChange: typeof reloadAfterDataChange;
		}) => unknown,
	) => selector({ reloadAfterDataChange }),
}));
vi.mock("../../stores/confirmStore", () => ({
	useConfirmStore: (selector: (state: { show: typeof show }) => unknown) =>
		selector({ show }),
}));
vi.mock("../../stores/toastStore", () => ({
	toast: {
		success: (...args: unknown[]) => toastSuccess(...args),
		error: (...args: unknown[]) => toastError(...args),
	},
}));

import DataPanel from "./DataPanel";

const summary = {
	conversations: 3,
	messages: 14,
	attachments: 2,
	attachment_bytes: 2048,
	memories: 4,
	knowledge_documents: 1,
	cache_entries: 5,
};

describe("DataPanel", () => {
	beforeEach(() => {
		for (const mock of [
			overview,
			conversations,
			exportData,
			exportConversations,
			importData,
			deleteConversations,
			clearHistory,
			clearCache,
			reloadAfterDataChange,
			show,
			toastSuccess,
			toastError,
		])
			mock.mockReset();
		overview.mockResolvedValue(summary);
		conversations.mockResolvedValue([
			{
				id: "c1",
				title: "First conversation",
				message_count: 8,
				attachment_count: 1,
				updated_at: "2026-08-12T00:00:00Z",
			},
			{
				id: "c2",
				title: "Second conversation",
				message_count: 6,
				attachment_count: 0,
				updated_at: "2026-08-11T00:00:00Z",
			},
		]);
		reloadAfterDataChange.mockResolvedValue(undefined);
	});

	afterEach(cleanup);

	it("shows data counts and clears history only after confirmation", async () => {
		show.mockResolvedValue("confirm");
		clearHistory.mockResolvedValue({ conversations: 3, deleted_blobs: 2 });
		render(<DataPanel />);

		await screen.findByText("14");
		fireEvent.click(
			screen.getByRole("button", { name: "Clear all conversation history" }),
		);

		await waitFor(() => expect(clearHistory).toHaveBeenCalledOnce());
		expect(reloadAfterDataChange).toHaveBeenCalledOnce();
		expect(show).toHaveBeenCalledWith(
			expect.objectContaining({ danger: true }),
		);
	});

	it("does not clear history when confirmation is cancelled", async () => {
		show.mockResolvedValue("cancel");
		render(<DataPanel />);
		await screen.findByText("14");

		fireEvent.click(
			screen.getByRole("button", { name: "Clear all conversation history" }),
		);
		await waitFor(() => expect(show).toHaveBeenCalledOnce());

		expect(clearHistory).not.toHaveBeenCalled();
	});

	it("exports only the selected atomic data domains", async () => {
		exportData.mockResolvedValue({
			schema: "encorehub.user-data",
			version: 1,
			exported_at: "2026-08-12T00:00:00Z",
			domains: ["characters", "conversations", "memories"],
			tables: {},
			blobs: {},
		});
		Object.defineProperty(URL, "createObjectURL", {
			configurable: true,
			value: vi.fn(() => "blob:backup"),
		});
		Object.defineProperty(URL, "revokeObjectURL", {
			configurable: true,
			value: vi.fn(),
		});
		const anchorClick = vi
			.spyOn(HTMLAnchorElement.prototype, "click")
			.mockImplementation(() => {});
		render(<DataPanel />);
		await screen.findByText("14");

		fireEvent.click(screen.getByRole("checkbox", { name: /Knowledge/ }));
		fireEvent.click(screen.getByRole("button", { name: "Export" }));

		await waitFor(() =>
			expect(exportData).toHaveBeenCalledWith([
				"characters",
				"conversations",
				"memories",
			]),
		);
		anchorClick.mockRestore();
	});

	it("atomically deletes only selected conversations after confirmation", async () => {
		show.mockResolvedValue("confirm");
		deleteConversations.mockResolvedValue({
			conversations: 1,
			deleted_blobs: 1,
		});
		render(<DataPanel />);
		await screen.findByText("First conversation");

		fireEvent.click(
			screen.getByRole("checkbox", { name: /First conversation/ }),
		);
		fireEvent.click(
			screen.getByRole("button", { name: "Delete selected conversations" }),
		);

		await waitFor(() =>
			expect(deleteConversations).toHaveBeenCalledWith(["c1"]),
		);
		expect(show).toHaveBeenCalledWith(
			expect.objectContaining({
				title: "Delete 1 selected conversations?",
				danger: true,
			}),
		);
		expect(reloadAfterDataChange).toHaveBeenCalledOnce();
	});

	it("filters conversations and selects only the visible result", async () => {
		render(<DataPanel />);
		await screen.findByText("First conversation");

		fireEvent.change(
			screen.getByRole("searchbox", { name: "Search conversations" }),
			{
				target: { value: "Second" },
			},
		);

		expect(screen.queryByText("First conversation")).toBeNull();
		expect(screen.getByText("Second conversation")).toBeDefined();
		fireEvent.click(
			screen.getByRole("checkbox", { name: "Toggle all conversations" }),
		);
		expect(screen.getByText("1 selected")).toBeDefined();
		expect(
			(
				screen.getByRole("checkbox", {
					name: /Second conversation/,
				}) as HTMLInputElement
			).checked,
		).toBe(true);
	});
});

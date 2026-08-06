import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Memory, MemoryGroup } from "../../services/memories";
import { confirm } from "../../stores/confirmStore";
import { useConversationStore } from "../../stores/conversationStore";
import { useSettingsStore } from "../../stores/settingsStore";
import CurrentMemoryPanel from "./CurrentMemoryPanel";

const { deleteMemory, listGroups, listMemories } = vi.hoisted(() => ({
	deleteMemory: vi.fn(),
	listGroups: vi.fn(),
	listMemories: vi.fn(),
}));

vi.mock("../../services/memories", async (importOriginal) => {
	const original =
		await importOriginal<typeof import("../../services/memories")>();
	return {
		...original,
		memoriesApi: {
			...original.memoriesApi,
			delete: deleteMemory,
			list: listMemories,
			listGroups,
		},
	};
});

const groups: MemoryGroup[] = [
	{
		id: "character-archivist",
		profile_id: "default",
		name: "Archivist",
		group_type: "character",
		owner_character_id: "archivist",
		archived_at: null,
		created_at: "2026-08-01T00:00:00.000Z",
		updated_at: "2026-08-01T00:00:00.000Z",
	},
	{
		id: "global",
		profile_id: "default",
		name: "Global",
		group_type: "global",
		owner_character_id: null,
		archived_at: null,
		created_at: "2026-08-01T00:00:00.000Z",
		updated_at: "2026-08-01T00:00:00.000Z",
	},
];

const memories: Memory[] = [
	{
		id: "memory-1",
		scope: "character",
		memory_type: "semantic",
		conversation_id: "conversation-1",
		group_id: "character-archivist",
		source_character_id: "archivist",
		state: "long_term",
		kind: "fact",
		canonical_key: null,
		reason: "Useful project context",
		source_turn_id: "turn-1",
		created_by_model: "gpt-test",
		confidence: 0.9,
		content: "EncoreHub uses Tauri for the desktop shell.",
		importance: 0.8,
		created_at: "2026-08-01T00:00:00.000Z",
		last_accessed_at: "2026-08-01T00:00:00.000Z",
	},
	{
		id: "memory-2",
		scope: "global",
		memory_type: "semantic",
		conversation_id: null,
		group_id: "global",
		source_character_id: null,
		state: "permanent",
		kind: "preference",
		canonical_key: "language",
		reason: "Stable preference",
		source_turn_id: null,
		created_by_model: "gpt-test",
		confidence: 1,
		content: "The user prefers concise answers.",
		importance: 1,
		created_at: "2026-08-02T00:00:00.000Z",
		last_accessed_at: "2026-08-02T00:00:00.000Z",
	},
];

beforeEach(() => {
	listMemories
		.mockReset()
		.mockResolvedValue({ memories, total: memories.length });
	listGroups.mockReset().mockResolvedValue({ groups, total: groups.length });
	deleteMemory.mockReset().mockResolvedValue(undefined);
	vi.spyOn(confirm, "ask").mockResolvedValue(true);
	useConversationStore.setState({
		activeId: "conversation-1",
		conversations: [
			{
				id: "conversation-1",
				title: "Memory planning",
				provider: "openai",
				model: "gpt-test",
				character_id: "archivist",
				message_count: 0,
				created_at: "2026-08-01T00:00:00.000Z",
				updated_at: "2026-08-01T00:00:00.000Z",
			},
		],
		pendingDraft: null,
	});
	useSettingsStore.setState({ settingsTab: "about" });
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("CurrentMemoryPanel", () => {
	it("loads only memories visible to the active conversation character", async () => {
		render(<CurrentMemoryPanel />);

		expect(
			await screen.findByText("EncoreHub uses Tauri for the desktop shell."),
		).toBeDefined();
		expect(listMemories).toHaveBeenCalledWith({ character_id: "archivist" });
		expect(screen.getByText("2 available memories")).toBeDefined();
	});

	it("filters, quotes, deletes, and opens full memory management", async () => {
		render(<CurrentMemoryPanel />);
		await screen.findByText("EncoreHub uses Tauri for the desktop shell.");

		fireEvent.change(screen.getByLabelText("Memory group filter"), {
			target: { value: "global" },
		});
		expect(screen.queryByText(/EncoreHub uses Tauri/)).toBeNull();
		expect(screen.getByText("The user prefers concise answers.")).toBeDefined();

		fireEvent.click(screen.getByRole("button", { name: "Quote memory" }));
		expect(useConversationStore.getState().pendingDraft).toBe(
			"> [memory] The user prefers concise answers.",
		);

		fireEvent.click(screen.getByRole("button", { name: "Delete memory" }));
		await waitFor(() => expect(deleteMemory).toHaveBeenCalledWith("memory-2"));
		expect(screen.queryByText("The user prefers concise answers.")).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Manage all memory" }));
		expect(useSettingsStore.getState().settingsTab).toBe("memories");
	});
});

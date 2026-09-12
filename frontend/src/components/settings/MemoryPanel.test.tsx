// Interaction tests for role-scoped memory settings and group management.

import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const list = vi.fn();
const search = vi.fn();
const del = vi.fn();
const update = vi.fn();
const listGroups = vi.fn();
const getCharacterSettings = vi.fn();
const updateCharacterSettings = vi.fn();
const createGroup = vi.fn();
const updateGroup = vi.fn();
const deleteGroup = vi.fn();
vi.mock("../../services/memories", () => ({
	memoriesApi: {
		list: (options?: unknown) => list(options),
		search: (opts: unknown) => search(opts),
		delete: (id: string) => del(id),
		update: (id: string, input: unknown) => update(id, input),
		listGroups: (options?: unknown) => listGroups(options),
		getCharacterSettings: (id: string) => getCharacterSettings(id),
		updateCharacterSettings: (id: string, input: unknown) =>
			updateCharacterSettings(id, input),
		createGroup: (name: string) => createGroup(name),
		updateGroup: (id: string, input: unknown) => updateGroup(id, input),
		deleteGroup: (id: string, input: unknown) => deleteGroup(id, input),
	},
}));

const confirmAsk = vi.fn();
vi.mock("../../stores/confirmStore", () => ({
	confirm: { ask: (...args: unknown[]) => confirmAsk(...args) },
}));

const characterFixture = {
	id: "default",
	name: "Default character",
	avatar: "",
	description: "",
	system_prompt: "",
	default_provider: "",
	default_model: "",
	opening_message: "",
	tags: [],
	version: 1,
	revision: 1,
	active_branch: "main",
	created_at: "",
	updated_at: "",
	deleted_at: null,
};
vi.mock("../../services/characters", () => ({
	listCharacters: () =>
		Promise.resolve({ characters: [characterFixture], total: 1 }),
}));

const appendDraft = vi.fn();
const closeSettings = vi.fn();
vi.mock("../../stores/conversationStore", () => ({
	useConversationStore: <T,>(sel: (s: unknown) => T): T => sel({ appendDraft }),
}));
vi.mock("../../stores/settingsStore", () => ({
	useSettingsStore: <T,>(sel: (s: unknown) => T): T => sel({ closeSettings }),
}));

import MemoryPanel from "./MemoryPanel";

const memFixture = {
	id: "m1",
	scope: "global",
	memory_type: "semantic",
	conversation_id: null,
	group_id: "character:default",
	source_character_id: "default",
	state: "long_term",
	kind: "fact",
	canonical_key: null,
	reason: "Durable project context.",
	source_turn_id: null,
	created_by_model: "test-model",
	confidence: 0.9,
	content: "EncoreHub uses Tauri for the desktop shell.",
	importance: 0.8,
	created_at: "2026-08-01T00:00:00.000Z",
	last_accessed_at: "2026-08-02T00:00:00.000Z",
};

const characterGroup = {
	id: "character:default",
	profile_id: "local",
	name: "Default character",
	group_type: "character",
	owner_character_id: "default",
	archived_at: null,
	created_at: "",
	updated_at: "",
};

const customGroup = {
	...characterGroup,
	id: "custom:project",
	name: "Project shared",
	group_type: "custom",
	owner_character_id: null,
};

const settingsFixture = {
	settings: {
		character_id: "default",
		default_mode: "simple",
		realistic_enabled: false,
		updated_at: "",
	},
	inherited_groups: [],
	visible_group_ids: ["character:default", "global"],
};

beforeEach(() => {
	list.mockReset().mockResolvedValue({ memories: [memFixture], total: 1 });
	search
		.mockReset()
		.mockResolvedValue({ results: [memFixture], query: "Tauri" });
	del.mockReset().mockResolvedValue(undefined);
	update.mockReset().mockResolvedValue(memFixture);
	listGroups
		.mockReset()
		.mockResolvedValue({ groups: [characterGroup, customGroup], total: 2 });
	getCharacterSettings.mockReset().mockResolvedValue(settingsFixture);
	updateCharacterSettings.mockReset().mockResolvedValue(settingsFixture);
	createGroup.mockReset().mockImplementation((name: string) =>
		Promise.resolve({
			...customGroup,
			id: "custom:new",
			name,
		}),
	);
	updateGroup
		.mockReset()
		.mockImplementation((id: string, input: Record<string, unknown>) =>
			Promise.resolve({ ...customGroup, id, ...input }),
		);
	deleteGroup.mockReset();
	confirmAsk.mockReset().mockResolvedValue(true);
	appendDraft.mockReset();
	closeSettings.mockReset();
});

afterEach(cleanup);

describe("MemoryPanel", () => {
	it("renders the list returned by memoriesApi.list", async () => {
		const { container } = render(<MemoryPanel />);
		await waitFor(() => expect(list).toHaveBeenCalled());
		await waitFor(() => {
			expect(screen.getByText(/EncoreHub uses Tauri/)).toBeDefined();
			expect(screen.getAllByText("fact").length).toBeGreaterThan(0);
			expect(screen.getAllByText("long_term").length).toBeGreaterThan(0);
		});
		expect(container.firstElementChild?.className).toContain("h-full");
		expect(container.firstElementChild?.className).toContain("bg-surface");
		expect(
			screen.getByRole("button", { name: "Add memory group" }),
		).toBeDefined();
	});

	it("Enter on the search box hits memoriesApi.search with q + top_k", async () => {
		render(<MemoryPanel />);
		await waitFor(() =>
			expect(screen.getByText(/EncoreHub uses Tauri/)).toBeDefined(),
		);

		const input = screen.getByPlaceholderText(/Search memories/);
		fireEvent.change(input, { target: { value: "Tauri" } });
		fireEvent.keyDown(input, { key: "Enter" });

		await waitFor(() =>
			expect(search).toHaveBeenCalledWith({
				q: "Tauri",
				group_id: "character:default",
				top_k: 30,
			}),
		);
	});

	it("passes state and kind filters to the list request", async () => {
		render(<MemoryPanel />);
		await waitFor(() => expect(list).toHaveBeenCalled());

		fireEvent.change(screen.getByLabelText("Filter by state"), {
			target: { value: "long_term" },
		});
		await waitFor(() =>
			expect(list).toHaveBeenCalledWith(
				expect.objectContaining({ state: "long_term" }),
			),
		);
	});

	it("edits a memory through memoriesApi.update", async () => {
		render(<MemoryPanel />);
		await waitFor(() => screen.getByText(/EncoreHub uses Tauri/));

		fireEvent.click(screen.getByTitle("Edit"));
		fireEvent.change(screen.getByLabelText("Memory content"), {
			target: { value: "The user maintains EncoreHub." },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save memory" }));

		await waitFor(() =>
			expect(update).toHaveBeenCalledWith("m1", {
				content: "The user maintains EncoreHub.",
			}),
		);
	});

	it("saves role mode and inherited groups separately from memory type", async () => {
		render(<MemoryPanel />);
		await waitFor(() =>
			expect(getCharacterSettings).toHaveBeenCalledWith("default"),
		);

		fireEvent.change(screen.getByLabelText("Default mode"), {
			target: { value: "rag" },
		});
		fireEvent.click(screen.getByRole("checkbox"));
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

		await waitFor(() =>
			expect(updateCharacterSettings).toHaveBeenCalledWith("default", {
				default_mode: "rag",
				realistic_enabled: false,
				inherited_groups: [
					{
						character_id: "default",
						group_id: "custom:project",
						access_mode: "read",
						priority: 0,
					},
				],
			}),
		);
	});

	it("toggles the realistic flag required by Realistic mode", async () => {
		render(<MemoryPanel />);
		await waitFor(() =>
			expect(getCharacterSettings).toHaveBeenCalledWith("default"),
		);

		fireEvent.click(screen.getByRole("switch", { name: "Realistic memory" }));
		fireEvent.change(screen.getByLabelText("Default mode"), {
			target: { value: "realistic" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

		await waitFor(() =>
			expect(updateCharacterSettings).toHaveBeenCalledWith(
				"default",
				expect.objectContaining({
					default_mode: "realistic",
					realistic_enabled: true,
				}),
			),
		);
	});

	it("creates a custom group from the group navigation", async () => {
		render(<MemoryPanel />);
		await waitFor(() => expect(listGroups).toHaveBeenCalled());

		fireEvent.click(screen.getByTitle("Create group"));
		fireEvent.change(screen.getByLabelText("Memory group name"), {
			target: { value: "Shared research" },
		});
		fireEvent.click(screen.getByTitle("Save"));

		await waitFor(() =>
			expect(createGroup).toHaveBeenCalledWith("Shared research"),
		);
		await waitFor(() =>
			expect(screen.getAllByText("Shared research").length).toBeGreaterThan(0),
		);
	});

	it("quotes a memory by appending to the draft without discarding it", async () => {
		render(<MemoryPanel />);
		await waitFor(() => screen.getByText(/EncoreHub uses Tauri/));
		fireEvent.click(screen.getByTitle("Quote into chat input"));
		expect(appendDraft).toHaveBeenCalledWith(
			"> [memory] EncoreHub uses Tauri for the desktop shell.",
		);
		expect(closeSettings).toHaveBeenCalled();
	});

	it("confirms before deleting and removes the row on success", async () => {
		render(<MemoryPanel />);
		await waitFor(() => screen.getByText(/EncoreHub uses Tauri/));
		fireEvent.click(screen.getByTitle("Delete"));
		await waitFor(() => expect(confirmAsk).toHaveBeenCalled());
		await waitFor(() => expect(del).toHaveBeenCalledWith("m1"));
		await waitFor(() =>
			expect(screen.queryByText(/EncoreHub uses Tauri/)).toBeNull(),
		);
	});

	it("keeps the row when deletion is cancelled", async () => {
		confirmAsk.mockResolvedValueOnce(false);
		render(<MemoryPanel />);
		await waitFor(() => screen.getByText(/EncoreHub uses Tauri/));
		fireEvent.click(screen.getByTitle("Delete"));
		await waitFor(() => expect(confirmAsk).toHaveBeenCalled());
		expect(del).not.toHaveBeenCalled();
		expect(screen.getByText(/EncoreHub uses Tauri/)).toBeDefined();
	});
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.fn();
vi.mock("./api", () => ({
	apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

import {
	createCharacter,
	deleteCharacter,
	getCharacter,
	listCharacters,
	previewCharacterUpgrade,
	updateCharacter,
	upgradeConversationCharacter,
} from "./characters";

beforeEach(() => apiFetch.mockReset().mockResolvedValue(undefined));

describe("characters service", () => {
	it("exposes character CRUD through encoded gateway routes", async () => {
		await listCharacters();
		await getCharacter("role/one");
		await createCharacter({ name: "Archivist", tags: ["research"] });
		await updateCharacter("role/one", 3, { system_prompt: "Use sources" });
		await deleteCharacter("role/one");

		expect(apiFetch.mock.calls[0]).toEqual(["/characters"]);
		expect(apiFetch.mock.calls[1]).toEqual(["/characters/role%2Fone"]);
		expect(JSON.parse(apiFetch.mock.calls[2][1].body)).toEqual({
			name: "Archivist",
			tags: ["research"],
		});
		expect(JSON.parse(apiFetch.mock.calls[3][1].body)).toEqual({
			expected_version: 3,
			system_prompt: "Use sources",
		});
		expect(apiFetch.mock.calls[4]).toEqual([
			"/characters/role%2Fone",
			{ method: "DELETE" },
		]);
	});

	it("previews and explicitly applies conversation character upgrades", async () => {
		await previewCharacterUpgrade("conversation/one");
		await upgradeConversationCharacter("conversation/one", 2);

		expect(apiFetch.mock.calls[0]).toEqual([
			"/conversations/conversation%2Fone/character-upgrade",
		]);
		expect(apiFetch.mock.calls[1][0]).toBe(
			"/conversations/conversation%2Fone/character-upgrade",
		);
		expect(JSON.parse(apiFetch.mock.calls[1][1].body)).toEqual({
			expected_character_version: 2,
		});
	});
});

import { describe, expect, it } from "vitest";
import type { Conversation } from "../../services/conversation";
import { groupConversations } from "./conversationGroups";

function conversation(id: string, updatedAt: string): Conversation {
	return {
		id,
		title: id,
		provider: "openai",
		model: "gpt-4o",
		message_count: 0,
		created_at: updatedAt,
		updated_at: updatedAt,
	};
}

describe("groupConversations", () => {
	it("groups conversations by local calendar day and newest first", () => {
		const groups = groupConversations(
			[
				conversation("older", "2026-07-10T12:00:00+08:00"),
				conversation("week", "2026-07-20T12:00:00+08:00"),
				conversation("yesterday", "2026-07-24T23:59:00+08:00"),
				conversation("today-early", "2026-07-25T08:00:00+08:00"),
				conversation("today-late", "2026-07-25T11:00:00+08:00"),
			],
			new Date("2026-07-25T12:00:00+08:00"),
		);

		expect(groups.map((group) => group.id)).toEqual([
			"today",
			"yesterday",
			"week",
			"older",
		]);
		expect(groups[0].conversations.map((item) => item.id)).toEqual([
			"today-late",
			"today-early",
		]);
	});

	it("puts invalid timestamps in Older and omits empty groups", () => {
		const groups = groupConversations(
			[conversation("invalid", "not-a-date")],
			new Date("2026-07-25T12:00:00+08:00"),
		);

		expect(groups).toHaveLength(1);
		expect(groups[0].id).toBe("older");
		expect(groups[0].conversations[0].id).toBe("invalid");
	});
});

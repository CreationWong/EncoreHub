import { describe, expect, it } from "vitest";
import type { ConversationParticipant } from "../../services/conversation";
import { activeMentionQuery, mentionedCharacterIds } from "./GroupComposer";

function participant(
	id: string,
	position: number,
	name: string,
): ConversationParticipant {
	return {
		character_id: id,
		character_version: 1,
		position,
		character_snapshot: {
			name,
			avatar: "",
			description: "",
			system_prompt: "",
			opening_message: "",
			tags: [],
		},
		provider: "openai",
		model: "gpt-test",
	};
}

describe("group composer mentions", () => {
	it("detects a mention query only while the caret sits inside the token", () => {
		expect(activeMentionQuery("hello @建模", 9)).toBe("建模");
		expect(activeMentionQuery("hello @建模 继续", 11)).toBeNull();
		expect(activeMentionQuery("mail@example.com", 16)).toBeNull();
	});

	it("resolves mentioned members from the final draft text", () => {
		const participants = [
			participant("char-a", 0, "建模bot1"),
			participant("char-b", 1, "论文挑刺"),
		];

		expect(mentionedCharacterIds("@论文挑刺 看下稿子", participants)).toEqual([
			"char-b",
		]);
		expect(mentionedCharacterIds("大家先暂停", participants)).toEqual([]);
		expect(
			mentionedCharacterIds("@建模bot1 和 @论文挑刺 都看看", participants),
		).toEqual(["char-a", "char-b"]);
	});
});

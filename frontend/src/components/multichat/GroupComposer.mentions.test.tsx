import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { ConversationParticipant } from "../../services/conversation";
import GroupComposer from "./GroupComposer";

const participants: ConversationParticipant[] = [
	{
		character_id: "char-a",
		character_version: 1,
		position: 0,
		character_snapshot: {
			name: "建模bot1",
			avatar: "",
			description: "",
			system_prompt: "",
			opening_message: "",
			tags: [],
		},
		provider: "openai",
		model: "gpt-test",
	},
	{
		character_id: "char-b",
		character_version: 1,
		position: 1,
		character_snapshot: {
			name: "论文挑刺",
			avatar: "",
			description: "",
			system_prompt: "",
			opening_message: "",
			tags: [],
		},
		provider: "openai",
		model: "gpt-test",
	},
];

function Harness({ streaming = false }: { streaming?: boolean }) {
	const [sent, setSent] = useState<string>("");
	return (
		<>
			<GroupComposer
				participants={participants}
				streaming={streaming}
				onSend={(content, mentions) =>
					setSent(JSON.stringify({ content, mentions }))
				}
				onStop={() => {}}
			/>
			<output data-testid="sent">{sent}</output>
		</>
	);
}

/** Place the caret so the menu state is computed as it is for a real user. */
function typeWithCaret(
	textarea: HTMLTextAreaElement,
	value: string,
	caret: number,
) {
	textarea.focus();
	fireEvent.change(textarea, { target: { value } });
	textarea.setSelectionRange(caret, caret);
}

afterEach(cleanup);

describe("GroupComposer mentions", () => {
	it("highlights a selected CJK mention inline in the draft", () => {
		const { container } = render(<Harness />);
		const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;

		typeWithCaret(textarea, "测试@", 3);
		fireEvent.click(screen.getByRole("button", { name: /建模bot1/ }));

		expect(textarea.value).toBe("测试@建模bot1 ");
		const mention = container.querySelector('[data-mention="建模bot1"]');
		expect(mention?.textContent).toBe("@建模bot1");
	});

	it("removes a whole mention token with one Backspace", () => {
		render(<Harness />);
		const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;

		// "测试" + "@建模bot1" ends at index 9; the trailing space is after it.
		typeWithCaret(textarea, "测试@建模bot1 ", 9);
		expect(textarea.selectionStart).toBe(9);
		fireEvent.keyDown(textarea, { key: "Backspace" });

		expect(textarea.value).toBe("测试 ");
	});

	it("confirms the menu selection with ArrowDown and Tab", () => {
		render(<Harness />);
		const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;

		typeWithCaret(textarea, "@", 1);
		fireEvent.keyDown(textarea, { key: "ArrowDown" });
		fireEvent.keyDown(textarea, { key: "Tab" });

		expect(textarea.value).toBe("@论文挑刺 ");
	});

	it("opens the menu even when '@' follows a latin word", () => {
		render(<Harness />);
		const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;

		typeWithCaret(textarea, "abc@", 4);
		expect(
			screen.getByRole("list", { name: "Mention a member" }),
		).toBeDefined();
	});

	it("still sends while members are speaking", () => {
		render(<Harness streaming />);
		const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;

		expect(screen.getByRole("button", { name: "Stop" })).toBeDefined();
		typeWithCaret(textarea, "我也说一句", 5);
		fireEvent.keyDown(textarea, { key: "Enter" });

		expect(screen.getByTestId("sent").textContent).toContain("我也说一句");
	});

	it("keeps a bare '@' literal when the menu is dismissed", () => {
		render(<Harness />);
		const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;

		typeWithCaret(textarea, "测试@", 3);
		fireEvent.keyDown(textarea, { key: "Escape" });
		fireEvent.keyDown(textarea, { key: "Enter" });

		expect(screen.getByTestId("sent").textContent).toContain("测试@");
	});
});

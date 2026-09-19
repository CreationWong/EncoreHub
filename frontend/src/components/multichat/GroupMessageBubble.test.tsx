import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import GroupMessageBubble from "./GroupMessageBubble";

afterEach(cleanup);

describe("GroupMessageBubble", () => {
	it("aligns the member avatar frame with the name row instead of stretching", () => {
		render(
			<GroupMessageBubble
				speaker="建模bot1"
				accent="#4263eb"
				variant="assistant"
				content="收到。"
			/>,
		);

		const article = screen.getByText("建模bot1").closest("article");
		const avatarFrame = article?.querySelector("span");
		// A flex row stretches its items by default, which painted the accent
		// ring down the whole message; the frame must stay avatar-sized.
		expect(avatarFrame?.className).toContain("self-start");
		expect(avatarFrame?.className).toContain("shrink-0");
	});

	it("keeps user messages white-on-accent without markdown recoloring", () => {
		render(
			<GroupMessageBubble
				speaker="You"
				variant="user"
				content="你们介绍一下自己"
			/>,
		);

		const bubble = screen.getByText("你们介绍一下自己").closest("div");
		expect(bubble?.className).toContain("bg-accent");
		expect(bubble?.className).toContain("text-white");
		expect(screen.getByText("你们介绍一下自己").className).toContain(
			"whitespace-pre-wrap",
		);
	});

	it("tints each member reply with its accent so speakers stay separable", () => {
		render(
			<GroupMessageBubble
				speaker="建模bot1"
				accent="#4263eb"
				variant="assistant"
				content="收到。"
			/>,
		);

		const article = screen.getByText("建模bot1").closest("article");
		const tinted = article?.querySelector<HTMLElement>(
			'[style*="background-color"]',
		);
		expect(tinted?.style.backgroundColor).toBe("rgba(66, 99, 235, 0.14)");
		expect(tinted?.style.borderColor).toBe("rgba(66, 99, 235, 0.45)");
	});

	it("labels collapsed reasoning without claiming the member is thinking", () => {
		render(
			<GroupMessageBubble
				speaker="论文挑刺"
				variant="assistant"
				content="成稿我来挑刺。"
				reasoning="先看摘要是否对题。"
			/>,
		);

		const toggle = screen.getByRole("button", { name: /Reasoning/ });
		expect(screen.queryByText("Thinking")).toBeNull();

		fireEvent.click(toggle);
		expect(screen.getByText("先看摘要是否对题。")).toBeDefined();
	});

	it("renders skipped members as a muted note instead of an empty bubble", () => {
		render(
			<GroupMessageBubble
				speaker="公式推导"
				variant="assistant"
				content=""
				status="skipped"
			/>,
		);

		expect(screen.getByText(/公式推导/)).toBeDefined();
		expect(screen.getByText(/Skipped this turn/)).toBeDefined();
	});
});

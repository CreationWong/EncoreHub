import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Message } from "../../services/conversation";
import MessageBubble from "./MessageBubble";

afterEach(cleanup);

function msg(
	over: Partial<Message> & { content: string; role: Message["role"] },
): Message {
	return {
		id: over.id ?? "m1",
		parent_id: over.parent_id ?? null,
		tool_calls: over.tool_calls ?? [],
		created_at: over.created_at ?? "2026-01-01T00:00:00Z",
		...over,
	};
}

describe("MessageBubble: user", () => {
	it("renders content as plain text and is right-aligned via flex justify-end", () => {
		const { container } = render(
			<MessageBubble message={msg({ role: "user", content: "hi there" })} />,
		);
		expect(container.textContent).toContain("hi there");
		// User branch wraps everything in a div with justify-end
		expect(container.querySelector(".justify-end")).not.toBeNull();
	});
});

describe("MessageBubble: assistant", () => {
	it("renders markdown — fenced code becomes a CodeBlock with language label", () => {
		const md = ["here is some code", "", "```ts", "const x = 1;", "```"].join(
			"\n",
		);
		const { container } = render(
			<MessageBubble message={msg({ role: "assistant", content: md })} />,
		);
		// language label appears in the CodeBlock header
		expect(container.textContent).toContain("ts");
		// the actual code is rendered (syntax highlighter splits it into spans,
		// so we look for substring rather than an exact match)
		expect(container.textContent).toContain("const x = 1");
	});

	it("shows a blinking cursor while streaming", () => {
		const { container } = render(
			<MessageBubble
				message={msg({ role: "assistant", content: "partial" })}
				isStreaming
			/>,
		);
		expect(container.querySelector(".animate-cursor-blink")).not.toBeNull();
	});
});

describe("MessageBubble: system", () => {
	it("renders fenced JSON via markdown — /inspect output is now readable", () => {
		const body = `Conversation state:\n\`\`\`json\n${JSON.stringify({ activeId: "c1", messageCount: 2 }, null, 2)}\n\`\`\``;
		const { container } = render(
			<MessageBubble message={msg({ role: "system", content: body })} />,
		);
		expect(container.textContent).toContain("json"); // language label
		expect(container.textContent).toContain('"activeId"');
		// Must NOT fall back to a literal <pre> with raw backticks
		expect(container.querySelector("pre.font-sans")).toBeNull();
	});
});

describe("MessageBubble: reasoning", () => {
	it("renders a collapsed reasoning toggle that expands on click", () => {
		render(
			<MessageBubble
				message={msg({
					role: "assistant",
					content: "the answer",
					reasoning: "first I considered X then Y",
				})}
			/>,
		);
		// Collapsed: toggle label shows, but reasoning text is hidden.
		const toggle = screen.getByText("Thought process");
		expect(screen.queryByText(/first I considered X/)).toBeNull();
		fireEvent.click(toggle);
		expect(screen.getByText(/first I considered X/)).not.toBeNull();
	});

	it("auto-expands reasoning while streaming with no content yet", () => {
		render(
			<MessageBubble
				message={msg({
					role: "assistant",
					content: "",
					reasoning: "thinking out loud",
				})}
				isStreaming
			/>,
		);
		// No click needed — streaming pre-content shows the reasoning live.
		expect(screen.getByText("thinking out loud")).not.toBeNull();
		expect(screen.getByText("Thinking…")).not.toBeNull();
	});
});

describe("MessageBubble: tool calls", () => {
	it("renders a tool-call card with name and status, expandable to args", () => {
		render(
			<MessageBubble
				message={msg({
					role: "assistant",
					content: "done",
					tool_calls: [
						{
							id: "t1",
							name: "get_weather",
							arguments: '{"city":"NYC"}',
							status: "success",
							result: "72F",
						},
					],
				})}
			/>,
		);
		expect(screen.getByText("get_weather")).not.toBeNull();
		expect(screen.getByText("success")).not.toBeNull();
		// Args/result hidden until expanded.
		expect(screen.queryByText(/"city":"NYC"/)).toBeNull();
		fireEvent.click(screen.getByText("get_weather"));
		expect(screen.getByText(/"city":"NYC"/)).not.toBeNull();
		expect(screen.getByText("72F")).not.toBeNull();
	});
});

describe("MessageBubble: copy button", () => {
	it("clicking the assistant copy button writes the message to clipboard", async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		Object.assign(navigator, { clipboard: { writeText } });

		render(
			<MessageBubble
				message={msg({ role: "assistant", content: "hello world" })}
			/>,
		);

		// There may be multiple "Copy" buttons (message + per-codeblock); the
		// assistant message-level one is the first match.
		const copyBtns = screen.getAllByTitle("Copy");
		fireEvent.click(copyBtns[0]);

		expect(writeText).toHaveBeenCalledWith("hello world");
	});
});

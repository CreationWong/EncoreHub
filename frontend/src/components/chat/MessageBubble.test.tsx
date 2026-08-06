import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "../../services/conversation";

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("../../stores/toastStore", () => ({
	toast: {
		success: (...args: unknown[]) => toastSuccess(...args),
		error: (...args: unknown[]) => toastError(...args),
	},
}));

import MessageBubble from "./MessageBubble";

function msg(
	over: Partial<Message> & { content: string; role: Message["role"] },
): Message {
	return {
		id: over.id ?? "m1",
		parent_id: over.parent_id ?? null,
		tool_calls: over.tool_calls ?? [],
		attachments: over.attachments ?? [],
		status: over.status ?? "completed",
		created_at: over.created_at ?? "2026-01-01T00:00:00Z",
		...over,
	};
}

beforeEach(() => {
	toastSuccess.mockReset();
	toastError.mockReset();
});

afterEach(cleanup);

describe("MessageBubble user presentation", () => {
	it("renders a compact, right-aligned neutral bubble without an avatar", () => {
		const { container } = render(
			<MessageBubble message={msg({ role: "user", content: "hi there" })} />,
		);

		const article = screen.getByLabelText("User message");
		expect(article.className).toContain("justify-end");
		expect(container.querySelector(".bg-control")?.textContent).toContain(
			"hi there",
		);
		expect(container.querySelector(".max-w-\\[72\\%\\]")).not.toBeNull();
		expect(screen.queryByText("User")).toBeNull();
	});

	it("renders image attachments as right-aligned thumbnails above the text", async () => {
		const createObjectURL = vi.fn(() => "blob:attachment-preview");
		const revokeObjectURL = vi.fn();
		Object.defineProperties(URL, {
			createObjectURL: { configurable: true, value: createObjectURL },
			revokeObjectURL: { configurable: true, value: revokeObjectURL },
		});
		vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
			new Response(new Blob(["image"], { type: "image/png" }), {
				status: 200,
			}),
		);

		const { container, unmount } = render(
			<MessageBubble
				message={msg({
					role: "user",
					content: "What is shown?",
					attachments: [
						{
							id: "attachment-1",
							conversation_id: "conversation-1",
							file_name: "screen.png",
							mime_type: "image/png",
							file_category: "image",
							size_bytes: 5,
							processing_status: "ready",
							processing_method: "system_ocr",
							error_message: "",
						},
					],
				})}
			/>,
		);

		const image = await screen.findByRole("img", { name: "screen.png" });
		expect(image.getAttribute("src")).toBe("blob:attachment-preview");
		expect(container.querySelector(".justify-end img")).not.toBeNull();
		expect(
			image.compareDocumentPosition(screen.getByText("What is shown?")),
		).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
		unmount();
		expect(revokeObjectURL).toHaveBeenCalledWith("blob:attachment-preview");
	});

	it("edits a user turn in place and keeps cancellation local", () => {
		const cancel = vi.fn();
		const submit = vi.fn();
		render(
			<MessageBubble
				message={msg({ role: "user", content: "original question" })}
				editing
				onEditCancel={cancel}
				onEditSubmit={submit}
			/>,
		);

		const editor = screen.getByRole("textbox", { name: "Edit user message" });
		expect((editor as HTMLTextAreaElement).value).toBe("original question");
		fireEvent.change(editor, { target: { value: "revised question" } });
		fireEvent.click(screen.getByRole("button", { name: "Cancel editing" }));
		expect(cancel).toHaveBeenCalledOnce();
		expect(submit).not.toHaveBeenCalled();
	});
});

describe("MessageBubble assistant document flow", () => {
	it("renders legacy messages that omit tool_calls without crashing", () => {
		const legacyMessage = {
			...msg({ role: "assistant", content: "Legacy answer" }),
			tool_calls: undefined,
		} as unknown as Message;

		render(<MessageBubble message={legacyMessage} />);

		expect(screen.getByText("Legacy answer")).toBeDefined();
		expect(screen.queryByLabelText("Tool executions")).toBeNull();
	});

	it("starts every assistant turn with the current character identity", () => {
		render(
			<MessageBubble
				message={msg({ role: "assistant", content: "Document answer" })}
			/>,
		);

		expect(screen.getByLabelText("Assistant message")).toBeDefined();
		const identity = screen.getByLabelText("Response from Default character");
		const answer = screen.getByText("Document answer");
		expect(identity.textContent).toContain("Default character");
		expect(identity.compareDocumentPosition(answer)).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING,
		);
		expect(screen.getByText("Document answer")).toBeDefined();
	});

	it("renders Markdown code with a language label and accessible copy button", () => {
		const fence = String.fromCharCode(96).repeat(3);
		const markdown = [
			"here is some code",
			"",
			`${fence}ts`,
			"const x = 1;",
			fence,
		].join("\n");
		const { container } = render(
			<MessageBubble message={msg({ role: "assistant", content: markdown })} />,
		);

		expect(container.textContent).toContain("ts");
		expect(container.textContent).toContain("const x = 1");
		expect(screen.getByRole("button", { name: "Copy" })).toBeDefined();
	});

	it("uses a stable streaming cursor and suppresses copy until completion", () => {
		const { container } = render(
			<MessageBubble
				message={msg({
					role: "assistant",
					content: "partial",
					status: "pending",
				})}
				isStreaming
			/>,
		);

		expect(container.querySelector(".animate-cursor-blink")).not.toBeNull();
		expect(screen.getByText("Generating")).toBeDefined();
		expect(screen.queryByRole("button", { name: "Copy reply" })).toBeNull();
	});

	it("renders a truthful empty-answer state", () => {
		render(<MessageBubble message={msg({ role: "assistant", content: "" })} />);
		expect(screen.getByText("No response content")).toBeDefined();
	});
});

describe("MessageBubble reasoning", () => {
	it("loads historical reasoning collapsed and labels it without fake duration", () => {
		render(
			<MessageBubble
				message={msg({
					role: "assistant",
					content: "the answer",
					reasoning: "first I considered X then Y",
				})}
			/>,
		);

		const toggle = screen.getByRole("button", { name: "Processed" });
		expect(toggle.className).not.toContain("w-full");
		expect(
			toggle.querySelector("svg:last-child")?.getAttribute("class"),
		).not.toContain("ml-auto");
		expect(toggle.getAttribute("aria-expanded")).toBe("false");
		expect(screen.queryByText(/first I considered X/)).toBeNull();
		expect(screen.queryByText(/\d+s/)).toBeNull();
		fireEvent.click(toggle);
		expect(screen.getByText(/first I considered X/)).toBeDefined();
	});

	it("keeps reasoning expanded while answer content streams", () => {
		render(
			<MessageBubble
				message={msg({
					role: "assistant",
					content: "answer has started",
					reasoning: "streamed reasoning",
					status: "pending",
				})}
				isStreaming
			/>,
		);

		expect(screen.getByRole("button", { name: "Thinking" })).toBeDefined();
		expect(screen.getByText("streamed reasoning")).toBeDefined();
		expect(screen.getByText("answer has started")).toBeDefined();
	});

	it("uses stopped and failed reasoning labels from persisted state", () => {
		const { rerender } = render(
			<MessageBubble
				message={msg({
					role: "assistant",
					content: "partial",
					reasoning: "reasoning",
					status: "stopped",
				})}
			/>,
		);
		expect(screen.getByRole("button", { name: "Stopped" })).toBeDefined();

		rerender(
			<MessageBubble
				message={msg({
					role: "assistant",
					content: "partial",
					reasoning: "reasoning",
					status: "failed",
				})}
			/>,
		);
		expect(
			screen.getByRole("button", { name: "Processing failed" }),
		).toBeDefined();
	});
});

describe("MessageBubble tool execution", () => {
	it("renders compact pending, completed, and failed tool states", () => {
		render(
			<MessageBubble
				message={msg({
					role: "assistant",
					content: "done",
					tool_calls: [
						{
							id: "pending",
							name: "pending_tool",
							arguments: "{}",
							status: "pending",
						},
						{
							id: "success",
							name: "get_weather",
							arguments: '{"city":"NYC"}',
							status: "success",
							result: "72F",
						},
						{
							id: "error",
							name: "failed_tool",
							arguments: "{}",
							status: "error",
						},
					],
				})}
			/>,
		);

		const executions = screen.getByLabelText("Tool executions");
		expect(executions.className).toContain("max-w-fit");
		expect(executions.className).not.toContain("border-y");
		expect(screen.getByText("Pending")).toBeDefined();
		expect(screen.getByText("Completed")).toBeDefined();
		expect(screen.getByText("Failed")).toBeDefined();
		expect(screen.queryByText(/"city":"NYC"/)).toBeNull();
		fireEvent.click(screen.getByText("get_weather"));
		expect(screen.getByText(/"city":"NYC"/)).toBeDefined();
		expect(screen.getByText("72F")).toBeDefined();
	});
});

describe("MessageBubble reply footer", () => {
	it("places exact non-zero token usage in the reply footer", () => {
		render(
			<MessageBubble
				message={msg({
					role: "assistant",
					content: "answer",
					token_count: 13126,
				})}
			/>,
		);

		const footer = screen.getByLabelText("Reply actions and status");
		expect(footer.textContent).toContain("13,126 tokens");
		expect(
			screen.getByTitle("Legacy total token count").closest("footer"),
		).toBe(footer);
	});

	it("does not render unknown or zero token placeholders", () => {
		const { rerender } = render(
			<MessageBubble
				message={msg({
					role: "assistant",
					content: "answer",
					token_count: 0,
				})}
			/>,
		);
		expect(screen.queryByText(/tokens/)).toBeNull();

		rerender(
			<MessageBubble
				message={msg({
					role: "assistant",
					content: "answer",
				})}
			/>,
		);
		expect(screen.queryByText(/tokens/)).toBeNull();
	});

	it("copies only final answer content, excluding reasoning and tools", async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		Object.assign(navigator, { clipboard: { writeText } });
		render(
			<MessageBubble
				message={msg({
					role: "assistant",
					content: "final answer only",
					reasoning: "reasoning must stay private",
					tool_calls: [
						{
							id: "tool",
							name: "inspect",
							arguments: '{"private":true}',
							result: "tool result",
							status: "success",
						},
					],
				})}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Copy reply" }));
		await waitFor(() =>
			expect(writeText).toHaveBeenCalledWith("final answer only"),
		);
		expect(toastSuccess).toHaveBeenCalledWith("Copied to clipboard");
		expect(writeText).toHaveBeenCalledTimes(1);
	});

	it("shows failed and stopped lifecycle states beside footer metrics", () => {
		const { rerender } = render(
			<MessageBubble
				message={msg({
					role: "assistant",
					content: "partial",
					status: "failed",
					token_count: 12,
				})}
			/>,
		);
		expect(screen.getByTitle("Message status: Failed")).toBeDefined();

		rerender(
			<MessageBubble
				message={msg({
					role: "assistant",
					content: "partial",
					status: "stopped",
					token_count: 12,
				})}
			/>,
		);
		expect(screen.getByTitle("Message status: Stopped")).toBeDefined();
	});
});

describe("MessageBubble system and tool roles", () => {
	it("renders system Markdown and standalone tool content without chat bubbles", () => {
		const fence = String.fromCharCode(96).repeat(3);
		const body = [
			"Conversation state:",
			`${fence}json`,
			JSON.stringify({ activeId: "c1" }, null, 2),
			fence,
		].join("\n");
		const { rerender } = render(
			<MessageBubble message={msg({ role: "system", content: body })} />,
		);
		expect(screen.getByLabelText("System message").textContent).toContain(
			'"activeId"',
		);

		rerender(
			<MessageBubble
				message={msg({ role: "tool", content: "standalone result" })}
			/>,
		);
		expect(screen.getByLabelText("Tool message").textContent).toContain(
			"standalone result",
		);
	});
});

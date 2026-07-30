import { afterEach, describe, expect, it, vi } from "vitest";
import { chatApi } from "./chat";
import type { Message } from "./conversation";

function message(overrides: Partial<Message>): Message {
	return {
		id: "turn-1",
		role: "user",
		content: "hello",
		parent_id: null,
		tool_calls: [],
		status: "pending",
		created_at: "2026-07-16T00:00:00Z",
		...overrides,
	};
}

function sseResponse(
	frames: Array<{ event: string; data: unknown }>,
): Response {
	const body = frames
		.map(
			({ event, data }) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
		)
		.join("");
	return new Response(body, {
		status: 200,
		headers: { "Content-Type": "text/event-stream" },
	});
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("chatApi.sendMessageStream", () => {
	it("normalizes omitted tool calls in persisted SSE messages", async () => {
		const wireUser = {
			id: "turn-omitted-tools",
			role: "user",
			content: "hello",
			parent_id: null,
			status: "completed",
			created_at: "2026-07-16T00:00:00Z",
		};
		const wireAssistant = {
			id: "assistant-omitted-tools",
			role: "assistant",
			content: "answer",
			parent_id: "turn-omitted-tools",
			status: "completed",
			created_at: "2026-07-16T00:00:01Z",
			tool_calls: null,
		};
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				sseResponse([
					{ event: "turn_started", data: { user_message: wireUser } },
					{
						event: "done",
						data: {
							user_message: wireUser,
							assistant_message: wireAssistant,
							usage: { input_tokens: 1, output_tokens: 1 },
						},
					},
				]),
			),
		);
		const onTurnStarted = vi.fn();
		const onDone = vi.fn();

		await chatApi.sendMessageStream("c1", "hello", "key", {
			onTurnStarted,
			onDelta: vi.fn(),
			onDone,
			onError: vi.fn(),
		});

		expect(onTurnStarted).toHaveBeenCalledWith({
			...wireUser,
			tool_calls: [],
		});
		expect(onDone).toHaveBeenCalledWith({
			user_message: { ...wireUser, tool_calls: [] },
			assistant_message: { ...wireAssistant, tool_calls: [] },
			usage: { input_tokens: 1, output_tokens: 1 },
		});
	});

	it("reconciles the persisted turn and authoritative done payload", async () => {
		const pendingUser = message({});
		const completedUser = message({ status: "completed" });
		const assistant = message({
			id: "assistant-1",
			role: "assistant",
			content: "answer",
			parent_id: "turn-1",
			status: "completed",
			token_count: 10,
		});
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				sseResponse([
					{ event: "turn_started", data: { user_message: pendingUser } },
					{
						event: "delta",
						data: { content: "answer", duration_ms: 120 },
					},
					{
						event: "usage",
						data: { input_tokens: 1, output_tokens: 2, duration_ms: 250 },
					},
					{
						event: "usage",
						data: { input_tokens: 3, output_tokens: 4, duration_ms: 400 },
					},
					{
						event: "done",
						data: {
							user_message: completedUser,
							assistant_message: assistant,
							usage: { input_tokens: 4, output_tokens: 6 },
						},
					},
				]),
			),
		);
		const onTurnStarted = vi.fn();
		const onDelta = vi.fn();
		const onUsage = vi.fn();
		const onTelemetry = vi.fn();
		const onDone = vi.fn();
		const onError = vi.fn();

		await chatApi.sendMessageStream("c1", "hello", "key", {
			onTurnStarted,
			onDelta,
			onUsage,
			onTelemetry,
			onDone,
			onError,
		});

		expect(onTurnStarted).toHaveBeenCalledWith(pendingUser);
		expect(onDelta).toHaveBeenCalledWith("answer");
		expect(onUsage.mock.calls).toEqual([
			[1, 2],
			[3, 4],
		]);
		expect(onTelemetry.mock.calls).toEqual([[120], [250], [400]]);
		expect(onDone).toHaveBeenCalledWith({
			user_message: completedUser,
			assistant_message: assistant,
			usage: { input_tokens: 4, output_tokens: 6 },
		});
		expect(onError).not.toHaveBeenCalled();
	});

	it("sends supported deep-thinking controls in the stream request", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			sseResponse([
				{
					event: "error",
					data: { code: "test_end", message: "stop fixture" },
				},
			]),
		);
		vi.stubGlobal("fetch", fetchMock);

		await chatApi.sendMessageStream(
			"c1",
			"hello",
			"key",
			{
				onDelta: vi.fn(),
				onDone: vi.fn(),
				onError: vi.fn(),
			},
			undefined,
			false,
			undefined,
			{ reasoning_effort: "high" },
		);

		const request = fetchMock.mock.calls[0][1] as RequestInit;
		expect(JSON.parse(String(request.body))).toEqual({
			content: "hello",
			stream: true,
			reasoning_effort: "high",
		});
	});

	it("sends the replaced user message id for inline edits", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			sseResponse([
				{
					event: "error",
					data: { code: "test_end", message: "stop fixture" },
				},
			]),
		);
		vi.stubGlobal("fetch", fetchMock);

		await chatApi.sendMessageStream(
			"c1",
			"revised question",
			"key",
			{
				onDelta: vi.fn(),
				onDone: vi.fn(),
				onError: vi.fn(),
			},
			undefined,
			false,
			undefined,
			undefined,
			{ replaceMessageId: "user-original" },
		);

		const request = fetchMock.mock.calls[0][1] as RequestInit;
		expect(JSON.parse(String(request.body))).toEqual({
			content: "revised question",
			stream: true,
			replace_message_id: "user-original",
		});
	});

	it("decodes structured terminal errors without treating them as done", async () => {
		const failedUser = message({ status: "failed" });
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				sseResponse([
					{
						event: "error",
						data: {
							code: "provider_error",
							message: "Provider stream failed",
							user_message: failedUser,
						},
					},
				]),
			),
		);
		const onDone = vi.fn();
		const onError = vi.fn();

		await chatApi.sendMessageStream("c1", "hello", "key", {
			onDelta: vi.fn(),
			onDone,
			onError,
		});

		expect(onError).toHaveBeenCalledWith({
			code: "provider_error",
			message: "Provider stream failed",
			user_message: failedUser,
			assistant_message: undefined,
		});
		expect(onDone).not.toHaveBeenCalled();
	});

	it("rejects a stream that closes without an authoritative terminal frame", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValue(
					sseResponse([{ event: "delta", data: { content: "partial" } }]),
				),
		);
		const onDone = vi.fn();
		const onError = vi.fn();

		await chatApi.sendMessageStream("c1", "hello", "key", {
			onDelta: vi.fn(),
			onDone,
			onError,
		});

		expect(onError).toHaveBeenCalledWith({
			code: "stream_incomplete",
			message: "Stream ended before the turn was finalized",
		});
		expect(onDone).not.toHaveBeenCalled();
	});
});

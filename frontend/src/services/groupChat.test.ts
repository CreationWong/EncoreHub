import { afterEach, describe, expect, it, vi } from "vitest";
import type { Message } from "./conversation";
import { sendGroupMessageStream } from "./groupChat";

function message(overrides: Partial<Message>): Message {
	return {
		id: "message-1",
		role: "user",
		content: "hello",
		parent_id: null,
		tool_calls: [],
		status: "completed",
		created_at: "2026-09-19T00:00:00Z",
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

describe("sendGroupMessageStream", () => {
	it("routes participant events and reconciles authoritative messages", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				sseResponse([
					{
						event: "turn_started",
						data: { user_message: message({ id: "turn-1" }) },
					},
					{
						event: "participant_started",
						data: {
							participant_id: "char-a",
							name: "建模bot",
							avatar: "",
							provider: "openai",
							model: "gpt-test",
							position: 0,
						},
					},
					{
						event: "delta",
						data: { participant_id: "char-a", content: "收到。" },
					},
					{
						event: "delta",
						data: { participant_id: "char-a", content: "我先拆题。" },
					},
					{
						event: "participant_done",
						data: {
							participant_id: "char-a",
							content: "收到。我先拆题。",
							reasoning: "",
						},
					},
					{
						event: "participant_skipped",
						data: { participant_id: "char-b" },
					},
					{
						event: "done",
						data: {
							user_message: message({ id: "turn-1" }),
							assistant_messages: [
								message({
									id: "assistant-1",
									role: "assistant",
									content: "收到。我先拆题。",
									sender_character_id: "char-a",
								}),
							],
							usage: { input_tokens: 12, output_tokens: 7 },
						},
					},
				]),
			),
		);

		const started: string[] = [];
		const deltas: Array<[string, string]> = [];
		const skipped: string[] = [];
		let doneMessages = 0;
		let error: unknown;

		await sendGroupMessageStream(
			"conv-1",
			"开始",
			{ openai: "sk-test" },
			["char-a"],
			{
				onParticipantStarted: (participant) =>
					started.push(participant.participant_id),
				onDelta: (participantId, content) =>
					deltas.push([participantId, content]),
				onParticipantSkipped: (participantId) => skipped.push(participantId),
				onDone: (result) => {
					doneMessages = result.assistant_messages.length;
					expect(result.assistant_messages[0].sender_character_id).toBe(
						"char-a",
					);
				},
				onError: (streamError) => {
					error = streamError;
				},
			},
		);

		expect(error).toBeUndefined();
		expect(started).toEqual(["char-a"]);
		expect(deltas).toEqual([
			["char-a", "收到。"],
			["char-a", "我先拆题。"],
		]);
		expect(skipped).toEqual(["char-b"]);
		expect(doneMessages).toBe(1);

		const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
		const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		const headers = init.headers as Record<string, string>;
		expect(headers["X-openai-Key"]).toBe("sk-test");
		expect(String(init.body)).toContain('"mentions":["char-a"]');
	});

	it("surfaces a structured terminal error", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				sseResponse([
					{
						event: "error",
						data: {
							code: "provider_error",
							message: "Provider request failed",
						},
					},
				]),
			),
		);

		let received: { code: string; message: string } | null = null;
		await sendGroupMessageStream("conv-1", "hi", {}, [], {
			onDelta: () => {},
			onDone: () => {
				throw new Error("done must not fire for a terminal error");
			},
			onError: (error) => {
				received = error;
			},
		});

		expect(received).toEqual({
			code: "provider_error",
			message: "Provider request failed",
		});
	});
});

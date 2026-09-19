// Group-chat streaming client.
//
// A group turn returns one SSE response that walks the member roster in order.
// Every event that belongs to a member carries participant_id; the terminal
// done/error event carries the authoritative Engine messages. This module is
// the only place that knows the group event names, so the store stays a pure
// state reducer over these callbacks.

import { buildHeaders } from "./api";
import { parseEvent } from "./chat";
import { apiBase } from "./config";
import {
	type Message,
	type MessagePayload,
	normalizeMessage,
} from "./conversation";
import { diagnosticFetch } from "./diagnosticFetch";

/** One member segment announced at the start of its generation. */
export interface GroupParticipantStart {
	participant_id: string;
	name: string;
	avatar: string;
	provider: string;
	model: string;
	position: number;
}

/** Terminal payload after the whole turn was committed to Engine. */
export interface GroupStreamDonePayload {
	user_message: Message;
	assistant_messages: Message[];
	usage: { input_tokens: number; output_tokens: number };
}

export interface GroupStreamErrorPayload {
	code: string;
	message: string;
	user_message?: Message;
	assistant_messages?: Message[];
}

export interface GroupStreamCallbacks {
	onTurnStarted?: (userMessage: Message) => void;
	onParticipantStarted?: (participant: GroupParticipantStart) => void;
	onDelta: (participantId: string, content: string) => void;
	onReasoning?: (participantId: string, content: string) => void;
	onUsage?: (participantId: string, input: number, output: number) => void;
	onParticipantDone?: (
		participantId: string,
		content: string,
		reasoning: string,
	) => void;
	onParticipantSkipped?: (participantId: string) => void;
	onParticipantError?: (participantId: string, message: string) => void;
	onDone: (result: GroupStreamDonePayload) => void;
	onError: (error: GroupStreamErrorPayload) => void;
}

function normalizeMessages(payload: MessagePayload[] | undefined): Message[] {
	return (payload ?? []).map(normalizeMessage);
}

/**
 * Send one user message to a group conversation and consume the SSE stream.
 *
 * `providerKeys` maps provider ids to session API keys; each entry becomes an
 * X-<Provider>-Key header so members on different providers each receive their
 * own credential. Keys are never persisted here.
 */
export async function sendGroupMessageStream(
	convId: string,
	content: string,
	providerKeys: Record<string, string>,
	mentions: string[],
	callbacks: GroupStreamCallbacks,
	signal?: AbortSignal,
): Promise<void> {
	const headers: Record<string, string> = {};
	for (const [provider, key] of Object.entries(providerKeys)) {
		if (provider && key) headers[`X-${provider}-Key`] = key;
	}

	try {
		const res = await diagnosticFetch(
			`${apiBase()}/conversations/${convId}/group-chat`,
			{
				method: "POST",
				headers: buildHeaders(headers),
				body: JSON.stringify({
					content,
					stream: true,
					...(mentions.length > 0 ? { mentions } : {}),
				}),
				signal,
			},
		);

		if (!res.ok) {
			const text = await res.text();
			let message = `Request failed (${res.status})`;
			try {
				const parsed = JSON.parse(text);
				message = parsed.error ?? parsed.message ?? message;
			} catch {
				/* keep the bounded status message */
			}
			callbacks.onError({ code: "http_error", message });
			return;
		}

		const reader = res.body?.getReader();
		if (!reader) {
			callbacks.onError({
				code: "empty_stream",
				message: "Gateway returned no response body",
			});
			return;
		}

		const decoder = new TextDecoder();
		let buffer = "";
		let terminalReceived = false;

		const handleEvent = (block: string) => {
			const ev = parseEvent(block);
			if (!ev || terminalReceived) return;
			let parsed: Record<string, unknown>;
			try {
				parsed = JSON.parse(ev.data) as Record<string, unknown>;
			} catch {
				return;
			}

			switch (ev.event) {
				case "turn_started": {
					const user = parsed.user_message as MessagePayload | undefined;
					if (user?.id) callbacks.onTurnStarted?.(normalizeMessage(user));
					return;
				}
				case "participant_started": {
					callbacks.onParticipantStarted?.({
						participant_id: String(parsed.participant_id ?? ""),
						name: String(parsed.name ?? ""),
						avatar: String(parsed.avatar ?? ""),
						provider: String(parsed.provider ?? ""),
						model: String(parsed.model ?? ""),
						position: Number(parsed.position ?? 0),
					});
					return;
				}
				case "delta": {
					callbacks.onDelta(
						String(parsed.participant_id ?? ""),
						String(parsed.content ?? ""),
					);
					return;
				}
				case "reasoning": {
					callbacks.onReasoning?.(
						String(parsed.participant_id ?? ""),
						String(parsed.content ?? ""),
					);
					return;
				}
				case "usage": {
					callbacks.onUsage?.(
						String(parsed.participant_id ?? ""),
						Number(parsed.input_tokens ?? 0),
						Number(parsed.output_tokens ?? 0),
					);
					return;
				}
				case "participant_done": {
					callbacks.onParticipantDone?.(
						String(parsed.participant_id ?? ""),
						String(parsed.content ?? ""),
						String(parsed.reasoning ?? ""),
					);
					return;
				}
				case "participant_skipped": {
					callbacks.onParticipantSkipped?.(String(parsed.participant_id ?? ""));
					return;
				}
				case "participant_error": {
					callbacks.onParticipantError?.(
						String(parsed.participant_id ?? ""),
						String(parsed.message ?? "Provider request failed"),
					);
					return;
				}
				case "error": {
					terminalReceived = true;
					callbacks.onError({
						code: String(parsed.code ?? "group_error"),
						message: String(parsed.message ?? "Group chat failed"),
						...(parsed.user_message
							? {
									user_message: normalizeMessage(
										parsed.user_message as MessagePayload,
									),
								}
							: {}),
						...(Array.isArray(parsed.assistant_messages)
							? {
									assistant_messages: normalizeMessages(
										parsed.assistant_messages as MessagePayload[],
									),
								}
							: {}),
					});
					return;
				}
				case "done": {
					terminalReceived = true;
					const user = parsed.user_message as MessagePayload | undefined;
					if (!user?.id) {
						callbacks.onError({
							code: "malformed_done",
							message: "Gateway done event omitted the user message",
						});
						return;
					}
					const usage = parsed.usage as
						| { input_tokens?: number; output_tokens?: number }
						| undefined;
					callbacks.onDone({
						user_message: normalizeMessage(user),
						assistant_messages: normalizeMessages(
							parsed.assistant_messages as MessagePayload[] | undefined,
						),
						usage: {
							input_tokens: Number(usage?.input_tokens ?? 0),
							output_tokens: Number(usage?.output_tokens ?? 0),
						},
					});
					return;
				}
				default:
					return;
			}
		};

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			let separator = buffer.indexOf("\n\n");
			while (separator >= 0) {
				const block = buffer.slice(0, separator);
				buffer = buffer.slice(separator + 2);
				handleEvent(block);
				separator = buffer.indexOf("\n\n");
			}
		}

		if (!terminalReceived) {
			callbacks.onError({
				code: "stream_incomplete",
				message: "Stream ended without a terminal event",
			});
		}
	} catch (error) {
		if ((error as Error)?.name === "AbortError") return;
		callbacks.onError({
			code: "network_error",
			message: error instanceof Error ? error.message : "Group chat failed",
		});
	}
}

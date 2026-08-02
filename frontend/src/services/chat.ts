import type { AdvancedParameters } from "../stores/contextManagementStore";
import type { SearchProvider } from "../stores/settingsStore";
import { apiFetch, buildHeaders } from "./api";
import { apiBase } from "./config";
import {
	type Message,
	type MessagePayload,
	normalizeMessage,
} from "./conversation";
import { diagnosticFetch } from "./diagnosticFetch";

interface ChatResponsePayload {
	conversation_id: string;
	user_message?: MessagePayload;
	assistant_message?: MessagePayload;
	reply: string;
	provider: string;
	model: string;
	usage?: StreamUsage;
}

interface ChatResponse
	extends Omit<ChatResponsePayload, "user_message" | "assistant_message"> {
	user_message?: Message;
	assistant_message?: Message;
}

export interface StreamUsage {
	input_tokens: number;
	output_tokens: number;
}

export interface DeepThinkingRequest {
	reasoning_effort?: "low" | "medium" | "high";
	thinking_budget?: number;
	/** Explicitly override providers whose reasoning mode is enabled by default. */
	disable_reasoning?: boolean;
}

export interface ChatTurnOptions {
	replaceMessageId?: string;
	// These controls affect only the active provider request; Engine keeps the complete transcript.
	parameters?: AdvancedParameters;
	contextSummary?: string;
	contextKeepRecent?: number;
}

interface UserSystemContext {
	date: string;
	time: string;
	timezone: string;
}

function padDateTimePart(value: number): string {
	return String(value).padStart(2, "0");
}

/** Capture the user's clock at send time; the Gateway process may use another timezone. */
export function getUserSystemContext(now = new Date()): UserSystemContext {
	const timezone =
		Intl.DateTimeFormat().resolvedOptions().timeZone ||
		`UTC${formatUtcOffset(now.getTimezoneOffset())}`;
	return {
		date: `${now.getFullYear()}-${padDateTimePart(now.getMonth() + 1)}-${padDateTimePart(now.getDate())}`,
		time: `${padDateTimePart(now.getHours())}:${padDateTimePart(now.getMinutes())}:${padDateTimePart(now.getSeconds())}`,
		timezone,
	};
}

function formatUtcOffset(offsetMinutes: number): string {
	const absoluteMinutes = Math.abs(offsetMinutes);
	const sign = offsetMinutes <= 0 ? "+" : "-";
	return `${sign}${padDateTimePart(Math.floor(absoluteMinutes / 60))}:${padDateTimePart(absoluteMinutes % 60)}`;
}

export interface StreamDonePayload {
	user_message: Message;
	assistant_message: Message | null;
	usage: StreamUsage;
}

export interface StreamErrorPayload {
	code: string;
	message: string;
	user_message?: Message;
	assistant_message?: Message | null;
}

/** A tool call streamed from the gateway, identified by its fragment index. */
export interface StreamToolCall {
	index: number;
	id?: string;
	name: string;
	arguments: string;
	result?: string;
	status?: "pending" | "success" | "error";
}

export interface StreamCallbacks {
	onTurnStarted?: (userMessage: Message) => void;
	onDelta: (content: string) => void;
	onReasoning?: (content: string) => void;
	onToolCall?: (call: {
		index: number;
		id?: string;
		name?: string;
		arguments?: string;
	}) => void;
	onToolResult?: (result: {
		id: string;
		result: string;
		status: string;
	}) => void;
	onUsage?: (input: number, output: number) => void;
	onTelemetry?: (durationMs: number) => void;
	onWarning?: (message: string) => void;
	onTitleUpdate?: (data: { conversation_id: string; title: string }) => void;
	onTitleError?: (message: string) => void;
	onDone: (result: StreamDonePayload) => void;
	onError: (error: StreamErrorPayload) => void;
}

interface ParsedSseEvent {
	event: string;
	data: string;
}

/**
 * Parse a complete SSE event block (one or more lines, separated by \n).
 * Per the SSE spec, events are delimited by a blank line in the byte stream.
 */
function parseEvent(block: string): ParsedSseEvent | null {
	let event = "message";
	const dataLines: string[] = [];
	for (const raw of block.split("\n")) {
		const line = raw.replace(/\r$/, "");
		if (!line || line.startsWith(":")) continue;
		if (line.startsWith("event:")) {
			event = line.slice(6).trim();
		} else if (line.startsWith("data:")) {
			dataLines.push(line.slice(5).replace(/^ /, ""));
		}
	}
	if (dataLines.length === 0) return null;
	return { event, data: dataLines.join("\n") };
}

export const chatApi = {
	async sendMessage(
		convId: string,
		content: string,
		providerKey?: string,
		search?: boolean,
		searchProvider?: SearchProvider,
		deepThinking?: DeepThinkingRequest,
	): Promise<ChatResponse> {
		const headers: Record<string, string> = {};
		if (providerKey) headers["X-Provider-Key"] = providerKey;

		const response = await apiFetch<ChatResponsePayload>(
			`/conversations/${convId}/chat`,
			{
				method: "POST",
				headers,
				body: JSON.stringify({
					content,
					user_system_context: getUserSystemContext(),
					...(search && { search: true, search_provider: searchProvider }),
					...deepThinking,
				}),
			},
		);
		return {
			...response,
			user_message: response.user_message
				? normalizeMessage(response.user_message)
				: undefined,
			assistant_message: response.assistant_message
				? normalizeMessage(response.assistant_message)
				: undefined,
		};
	},

	/** Send a message and consume the SSE stream with callbacks. */
	async sendMessageStream(
		convId: string,
		content: string,
		providerKey: string | undefined,
		callbacks: StreamCallbacks,
		signal?: AbortSignal,
		search?: boolean,
		searchProvider?: SearchProvider,
		deepThinking?: DeepThinkingRequest,
		turnOptions?: ChatTurnOptions,
	): Promise<void> {
		const extra: Record<string, string> = {};
		if (providerKey) extra["X-Provider-Key"] = providerKey;

		try {
			const res = await diagnosticFetch(
				`${apiBase()}/conversations/${convId}/chat`,
				{
					method: "POST",
					headers: buildHeaders(extra),
					body: JSON.stringify({
						content,
						stream: true,
						user_system_context: getUserSystemContext(),
						...(turnOptions?.replaceMessageId && {
							replace_message_id: turnOptions.replaceMessageId,
						}),
						...(search && { search: true, search_provider: searchProvider }),
						...deepThinking,
						...(turnOptions?.parameters && {
							temperature: turnOptions.parameters.temperature,
							top_p: turnOptions.parameters.topP,
							max_completion_tokens: turnOptions.parameters.maxCompletionTokens,
							...(turnOptions.parameters.seed.trim()
								? { seed: Number(turnOptions.parameters.seed) }
								: {}),
							...(turnOptions.parameters.stopSequences.trim()
								? {
										stop: turnOptions.parameters.stopSequences
											.split(",")
											.map((item) => item.trim())
											.filter(Boolean),
									}
								: {}),
							frequency_penalty: turnOptions.parameters.frequencyPenalty,
							presence_penalty: turnOptions.parameters.presencePenalty,
							logprobs: turnOptions.parameters.logprobs,
							top_logprobs: turnOptions.parameters.logprobs
								? turnOptions.parameters.topLogprobs
								: 0,
							json_mode:
								turnOptions.parameters.responseFormat === "json_object",
						}),
						...(turnOptions?.contextSummary && {
							context_summary: turnOptions.contextSummary,
							context_keep_recent: turnOptions.contextKeepRecent,
						}),
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

			// Non-streaming fallback (gateway may downgrade to JSON).
			const contentType = res.headers.get("content-type") || "";
			if (contentType.includes("application/json")) {
				const data: ChatResponsePayload = await res.json();
				if (!data.user_message || !data.assistant_message) {
					callbacks.onError({
						code: "invalid_response",
						message: "Gateway response did not include persisted messages",
					});
					return;
				}
				const userMessage = normalizeMessage(data.user_message);
				const assistantMessage = normalizeMessage(data.assistant_message);
				callbacks.onTurnStarted?.(userMessage);
				callbacks.onDone({
					user_message: userMessage,
					assistant_message: assistantMessage,
					usage: data.usage ?? { input_tokens: 0, output_tokens: 0 },
				});
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

				switch (ev.event) {
					case "turn_started": {
						try {
							const parsed = JSON.parse(ev.data);
							if (parsed.user_message?.id) {
								callbacks.onTurnStarted?.(
									normalizeMessage(parsed.user_message as MessagePayload),
								);
							}
						} catch {
							/* final done/error reconciliation remains authoritative */
						}
						break;
					}
					case "delta": {
						// Gateway emits {content:"..."}; tolerate legacy raw text
						// and {text:"..."} wrappers for forward/backward compat.
						let delta = ev.data;
						if (delta.startsWith("{")) {
							try {
								const j = JSON.parse(delta);
								delta = j.content ?? j.text ?? "";
								if (Number.isFinite(j.duration_ms) && j.duration_ms >= 0) {
									callbacks.onTelemetry?.(j.duration_ms);
								}
							} catch {
								/* keep raw */
							}
						}
						if (delta) {
							callbacks.onDelta(delta);
						}
						break;
					}
					case "reasoning": {
						try {
							const j = JSON.parse(ev.data);
							if (j.content) callbacks.onReasoning?.(j.content);
							if (Number.isFinite(j.duration_ms) && j.duration_ms >= 0) {
								callbacks.onTelemetry?.(j.duration_ms);
							}
						} catch {
							/* ignore malformed reasoning frame */
						}
						break;
					}
					case "tool_call": {
						try {
							const j = JSON.parse(ev.data);
							callbacks.onToolCall?.({
								index: j.index ?? 0,
								id: j.id,
								name: j.name,
								arguments: j.arguments,
							});
						} catch {
							/* ignore malformed tool_call frame */
						}
						break;
					}
					case "tool_result": {
						try {
							const j = JSON.parse(ev.data);
							callbacks.onToolResult?.({
								id: j.id ?? "",
								result: j.result ?? "",
								status: j.status ?? "success",
							});
						} catch {
							/* ignore malformed tool_result frame */
						}
						break;
					}
					case "usage": {
						try {
							const j = JSON.parse(ev.data);
							callbacks.onUsage?.(j.input_tokens ?? 0, j.output_tokens ?? 0);
							if (Number.isFinite(j.duration_ms) && j.duration_ms >= 0) {
								callbacks.onTelemetry?.(j.duration_ms);
							}
						} catch {
							/* ignore malformed usage frame */
						}
						break;
					}
					case "warning": {
						try {
							const j = JSON.parse(ev.data);
							callbacks.onWarning?.(j.message ?? ev.data);
						} catch {
							callbacks.onWarning?.(ev.data);
						}
						break;
					}
					case "title_update": {
						try {
							const j = JSON.parse(ev.data);
							callbacks.onTitleUpdate?.(j);
						} catch {
							/* ignore malformed title_update frame */
						}
						break;
					}
					case "title_error": {
						try {
							const j = JSON.parse(ev.data);
							callbacks.onTitleError?.(j.message ?? "Failed to generate title");
						} catch {
							callbacks.onTitleError?.("Failed to generate title");
						}
						break;
					}
					case "error": {
						terminalReceived = true;
						try {
							const parsed = JSON.parse(ev.data);
							const userMessage = parsed.user_message
								? normalizeMessage(parsed.user_message as MessagePayload)
								: undefined;
							const assistantMessage =
								parsed.assistant_message == null
									? parsed.assistant_message
									: normalizeMessage(
											parsed.assistant_message as MessagePayload,
										);
							callbacks.onError({
								code: parsed.code ?? "stream_error",
								message: parsed.message ?? "Gateway stream failed",
								user_message: userMessage,
								assistant_message: assistantMessage,
							});
						} catch {
							callbacks.onError({
								code: "malformed_error",
								message: "Gateway returned a malformed stream error",
							});
						}
						break;
					}
					case "done": {
						terminalReceived = true;
						try {
							const parsed = JSON.parse(ev.data);
							if (!parsed.user_message?.id || !parsed.assistant_message?.id) {
								throw new Error("persisted messages missing");
							}
							callbacks.onDone({
								user_message: normalizeMessage(
									parsed.user_message as MessagePayload,
								),
								assistant_message: normalizeMessage(
									parsed.assistant_message as MessagePayload,
								),
								usage: parsed.usage ?? { input_tokens: 0, output_tokens: 0 },
							});
						} catch {
							callbacks.onError({
								code: "malformed_done",
								message: "Gateway completion was not authoritative",
							});
						}
						break;
					}
					default:
						// Unknown event — ignore quietly.
						break;
				}
			};

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });

				// SSE events are separated by a blank line: \n\n (or \r\n\r\n).
				while (true) {
					const sepIdx = buffer.indexOf("\n\n");
					if (sepIdx === -1) break;
					const block = buffer.slice(0, sepIdx);
					buffer = buffer.slice(sepIdx + 2);
					handleEvent(block);
				}
			}

			// Flush any trailing partial event
			if (buffer.trim()) handleEvent(buffer);

			if (!terminalReceived && !signal?.aborted) {
				callbacks.onError({
					code: "stream_incomplete",
					message: "Stream ended before the turn was finalized",
				});
			}
		} catch (err) {
			if (err instanceof DOMException && err.name === "AbortError") {
				// The store reloads the Engine state after a local Stop.
				return;
			}
			callbacks.onError({
				code: "transport_error",
				message: err instanceof Error ? err.message : "Stream failed",
			});
		}
	},
};

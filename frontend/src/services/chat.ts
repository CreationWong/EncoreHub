import { apiFetch, buildHeaders } from "./api";
import { API_BASE } from "./config";
import type { Message } from "./conversation";

interface ChatResponse {
	conversation_id: string;
	user_message?: Message;
	assistant_message?: Message;
	reply: string;
	provider: string;
	model: string;
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
	onDone: (fullContent: string) => void;
	onError: (error: string) => void;
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
	): Promise<ChatResponse> {
		const headers: Record<string, string> = {};
		if (providerKey) headers["X-Provider-Key"] = providerKey;

		return apiFetch<ChatResponse>(`/conversations/${convId}/chat`, {
			method: "POST",
			headers,
			body: JSON.stringify({ content }),
		});
	},

	/** Send a message and consume the SSE stream with callbacks. */
	async sendMessageStream(
		convId: string,
		content: string,
		providerKey: string | undefined,
		callbacks: StreamCallbacks,
		signal?: AbortSignal,
	): Promise<void> {
		const extra: Record<string, string> = {};
		if (providerKey) extra["X-Provider-Key"] = providerKey;

		try {
			const res = await fetch(`${API_BASE}/conversations/${convId}/chat`, {
				method: "POST",
				headers: buildHeaders(extra),
				body: JSON.stringify({ content, stream: true }),
				signal,
			});

			if (!res.ok) {
				const text = await res.text();
				let msg = text;
				try {
					msg = JSON.parse(text).error || text;
				} catch {
					/* use raw */
				}
				callbacks.onError(msg);
				return;
			}

			// Non-streaming fallback (gateway may downgrade to JSON).
			const contentType = res.headers.get("content-type") || "";
			if (contentType.includes("application/json")) {
				const data: ChatResponse = await res.json();
				callbacks.onDone(data.reply);
				return;
			}

			const reader = res.body?.getReader();
			if (!reader) {
				callbacks.onError("No response body");
				return;
			}

			const decoder = new TextDecoder();
			let buffer = "";
			let fullContent = "";

			const handleEvent = (block: string) => {
				const ev = parseEvent(block);
				if (!ev) return;

				switch (ev.event) {
					case "delta": {
						// Gateway emits {content:"..."}; tolerate legacy raw text
						// and {text:"..."} wrappers for forward/backward compat.
						let delta = ev.data;
						if (delta.startsWith("{")) {
							try {
								const j = JSON.parse(delta);
								delta = j.content ?? j.text ?? "";
							} catch {
								/* keep raw */
							}
						}
						if (delta) {
							fullContent += delta;
							callbacks.onDelta(delta);
						}
						break;
					}
					case "reasoning": {
						try {
							const j = JSON.parse(ev.data);
							if (j.content) callbacks.onReasoning?.(j.content);
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
						} catch {
							/* ignore malformed usage frame */
						}
						break;
					}
					case "error": {
						callbacks.onError(ev.data);
						break;
					}
					case "done":
						// handled after loop
						break;
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

			callbacks.onDone(fullContent);
		} catch (err) {
			if (err instanceof DOMException && err.name === "AbortError") {
				// User cancelled — preserve whatever we already streamed.
				return;
			}
			callbacks.onError(err instanceof Error ? err.message : "Stream failed");
		}
	},
};

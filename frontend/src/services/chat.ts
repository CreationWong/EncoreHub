import { apiFetch } from "./api";
import type { Message } from "./conversation";

const BASE_URL = "http://127.0.0.1:8080/api/v1";

interface ChatResponse {
  conversation_id: string;
  user_message?: Message;
  assistant_message?: Message;
  reply: string;
  provider: string;
  model: string;
}

export interface StreamCallbacks {
  onDelta: (content: string) => void;
  onUsage?: (input: number, output: number) => void;
  onDone: (fullContent: string) => void;
  onError: (error: string) => void;
}

export const chatApi = {
  async sendMessage(
    convId: string,
    content: string,
    providerKey?: string,
  ): Promise<ChatResponse> {
    const headers: Record<string, string> = {};
    if (providerKey) {
      headers["X-Provider-Key"] = providerKey;
    }

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
  ): Promise<void> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (providerKey) {
      headers["X-Provider-Key"] = providerKey;
    }

    try {
      const res = await fetch(`${BASE_URL}/conversations/${convId}/chat`, {
        method: "POST",
        headers,
        body: JSON.stringify({ content, stream: true }),
      });

      if (!res.ok) {
        const text = await res.text();
        let msg = text;
        try {
          msg = JSON.parse(text).error || text;
        } catch { /* use raw */ }
        callbacks.onError(msg);
        return;
      }

      // If response is JSON (non-streaming fallback), parse directly
      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const data: ChatResponse = await res.json();
        callbacks.onDone(data.reply);
        return;
      }

      // Parse SSE stream
      const reader = res.body?.getReader();
      if (!reader) {
        callbacks.onError("No response body");
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let fullContent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            // Track current event type for the next data line
            continue;
          }
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            try {
              // Try JSON first
              const parsed = JSON.parse(data);
              fullContent += parsed.content || parsed.text || "";
              callbacks.onDelta(parsed.content || parsed.text || "");
            } catch {
              // Plain text delta
              fullContent += data;
              callbacks.onDelta(data);
            }
          }
        }
      }

      callbacks.onDone(fullContent);
    } catch (err) {
      callbacks.onError(err instanceof Error ? err.message : "Stream failed");
    }
  },
};

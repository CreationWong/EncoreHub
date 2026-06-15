import { apiFetch } from "./api";
import type { Message } from "./conversation";

interface ChatResponse {
  conversation_id: string;
  user_message?: Message;
  assistant_message?: Message;
  reply: string;
  provider: string;
  model: string;
}

export const chatApi = {
  async sendMessage(convId: string, content: string): Promise<ChatResponse> {
    return apiFetch<ChatResponse>(`/conversations/${convId}/chat`, {
      method: "POST",
      body: JSON.stringify({ content }),
    });
  },
};

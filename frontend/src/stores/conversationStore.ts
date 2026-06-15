import { create } from "zustand";
import type { Conversation, ConversationDetail, Message } from "../services/conversation";
import * as convApi from "../services/conversation";
import { chatApi } from "../services/chat";
import { useSettingsStore } from "./settingsStore";

interface ConversationState {
  conversations: Conversation[];
  activeId: string | null;
  messages: Message[];
  loading: boolean;
  streaming: boolean;
  streamingContent: string;
  error: string | null;

  loadList: () => Promise<void>;
  selectConversation: (id: string) => Promise<void>;
  newConversation: () => Promise<string>;
  deleteConversation: (id: string) => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  clearError: () => void;
}

export const useConversationStore = create<ConversationState>((set, get) => ({
  conversations: [],
  activeId: null,
  messages: [],
  loading: false,
  streaming: false,
  streamingContent: "",
  error: null,

  loadList: async () => {
    try {
      const resp = await convApi.listConversations();
      set({ conversations: resp.conversations });
    } catch (err) {
      console.error("Failed to load conversations:", err);
    }
  },

  selectConversation: async (id: string) => {
    set({ activeId: id, loading: true, streaming: false, streamingContent: "", error: null });
    try {
      const detail = await convApi.getConversation(id);
      set({ messages: detail.messages, loading: false });
    } catch (err) {
      console.error("Failed to load conversation:", err);
      set({ loading: false, error: "Failed to load conversation" });
    }
  },

  newConversation: async () => {
    try {
      const { provider, model } = useSettingsStore.getState();
      const conv = await convApi.createConversation(
        "New Chat",
        provider || "",
        model || "",
      );
      await get().loadList();
      set({ activeId: conv.id, messages: [], streamingContent: "", error: null });
      return conv.id;
    } catch (err) {
      console.error("Failed to create conversation:", err);
      set({ error: "Failed to create conversation" });
      return "";
    }
  },

  deleteConversation: async (id: string) => {
    try {
      await convApi.deleteConversation(id);
      const { activeId } = get();
      if (activeId === id) {
        set({ activeId: null, messages: [], streamingContent: "" });
      }
      await get().loadList();
    } catch (err) {
      console.error("Failed to delete conversation:", err);
      set({ error: "Failed to delete conversation" });
    }
  },

  sendMessage: async (content: string) => {
    const { activeId, messages } = get();
    let convId = activeId;

    if (!convId) {
      convId = await get().newConversation();
      if (!convId) return;
    }

    // Get API key from settings
    const { provider, apiKeys } = useSettingsStore.getState();
    const providerKey = provider ? apiKeys[provider] : undefined;

    // Optimistic user message
    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content,
      parent_id: null,
      tool_calls: [],
      created_at: new Date().toISOString(),
    };

    set({
      messages: [...messages, userMsg],
      streaming: true,
      streamingContent: "",
      error: null,
    });

    // Try streaming first, fall back to non-streaming
    await chatApi.sendMessageStream(convId, content, providerKey, {
      onDelta(delta) {
        set((s) => ({ streamingContent: s.streamingContent + delta }));
      },
      onDone(fullContent) {
        const final = fullContent || "(empty response)";
        set((s) => ({
          messages: [
            ...s.messages.filter((m) => m.id !== userMsg.id),
            userMsg,
            {
              id: `asst-${Date.now()}`,
              role: "assistant",
              content: final,
              parent_id: userMsg.id,
              tool_calls: [],
              created_at: new Date().toISOString(),
            },
          ],
          streaming: false,
          streamingContent: "",
        }));
        get().loadList(); // refresh for title updates
      },
      onError(errorMsg) {
        console.error("Stream error:", errorMsg);
        set((s) => ({
          messages: s.messages.filter((m) => m.id !== userMsg.id),
          streaming: false,
          streamingContent: "",
          error: errorMsg,
        }));
      },
    });
  },

  clearError: () => set({ error: null }),
}));

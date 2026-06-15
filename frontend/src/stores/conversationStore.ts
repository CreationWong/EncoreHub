import { create } from "zustand";
import type { Conversation, ConversationDetail, Message } from "../services/conversation";
import * as convApi from "../services/conversation";
import { chatApi } from "../services/chat";

interface ConversationState {
  // Data
  conversations: Conversation[];
  activeId: string | null;
  messages: Message[];
  loading: boolean;
  streaming: boolean;
  streamingContent: string;

  // Actions
  loadList: () => Promise<void>;
  selectConversation: (id: string) => Promise<void>;
  newConversation: () => Promise<string>;
  deleteConversation: (id: string) => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  appendStreamDelta: (content: string) => void;
  finishStream: (fullContent: string) => void;
}

export const useConversationStore = create<ConversationState>((set, get) => ({
  conversations: [],
  activeId: null,
  messages: [],
  loading: false,
  streaming: false,
  streamingContent: "",

  loadList: async () => {
    try {
      const resp = await convApi.listConversations();
      set({ conversations: resp.conversations });
    } catch (err) {
      console.error("Failed to load conversations:", err);
    }
  },

  selectConversation: async (id: string) => {
    set({ activeId: id, loading: true, streaming: false, streamingContent: "" });
    try {
      const detail = await convApi.getConversation(id);
      set({ messages: detail.messages, loading: false });
    } catch (err) {
      console.error("Failed to load conversation:", err);
      set({ loading: false });
    }
  },

  newConversation: async () => {
    try {
      const conv = await convApi.createConversation();
      await get().loadList();
      set({ activeId: conv.id, messages: [], streamingContent: "" });
      return conv.id;
    } catch (err) {
      console.error("Failed to create conversation:", err);
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
    }
  },

  sendMessage: async (content: string) => {
    const { activeId, messages } = get();
    let convId = activeId;

    // Auto-create conversation if none active
    if (!convId) {
      convId = await get().newConversation();
      if (!convId) return;
    }

    // Optimistic user message
    const userMsg: Message = {
      id: `temp-${Date.now()}`,
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
    });

    try {
      const resp = await chatApi.sendMessage(convId, content);
      // Replace temp message + add real reply
      set((state) => ({
        messages: [
          ...state.messages.filter((m) => m.id !== userMsg.id),
          resp.user_message ?? userMsg,
          resp.assistant_message ?? {
            id: `resp-${Date.now()}`,
            role: "assistant",
            content: resp.reply,
            parent_id: null,
            tool_calls: [],
            created_at: new Date().toISOString(),
          },
        ],
        streaming: false,
        streamingContent: "",
      }));
      // Refresh list for title update
      get().loadList();
    } catch (err) {
      console.error("Failed to send message:", err);
      set((state) => ({
        messages: state.messages.filter((m) => m.id !== userMsg.id),
        streaming: false,
        streamingContent: "",
      }));
    }
  },

  appendStreamDelta: (content: string) => {
    set((state) => ({
      streamingContent: state.streamingContent + content,
    }));
  },

  finishStream: (fullContent: string) => {
    set((state) => ({
      messages: [
        ...state.messages,
        {
          id: `stream-${Date.now()}`,
          role: "assistant",
          content: fullContent,
          parent_id: null,
          tool_calls: [],
          created_at: new Date().toISOString(),
        },
      ],
      streaming: false,
      streamingContent: "",
    }));
  },
}));

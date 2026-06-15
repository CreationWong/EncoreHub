import { useEffect, useRef } from "react";
import { useConversationStore } from "../../stores/conversationStore";
import MessageBubble from "./MessageBubble";
import InputBox from "./InputBox";
import { MessageSquare, X } from "lucide-react";

export default function ChatView() {
  const messages = useConversationStore((s) => s.messages);
  const streaming = useConversationStore((s) => s.streaming);
  const streamingContent = useConversationStore((s) => s.streamingContent);
  const loading = useConversationStore((s) => s.loading);
  const activeId = useConversationStore((s) => s.activeId);
  const error = useConversationStore((s) => s.error);
  const clearError = useConversationStore((s) => s.clearError);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  return (
    <div className="flex flex-col h-full">
      {/* Error toast */}
      {error && (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-400">
          <span className="flex-1">{error}</span>
          <button type="button" onClick={clearError} className="hover:text-red-300">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Empty state */}
      {!activeId && (
        <div className="flex-1 flex flex-col">
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center space-y-4">
              <div className="flex justify-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/10">
                  <MessageSquare className="h-8 w-8 text-accent" />
                </div>
              </div>
              <h2 className="text-xl font-semibold text-text-primary">EncoreHub</h2>
              <p className="text-sm text-text-muted max-w-sm">
                Start a new conversation or select one from the sidebar.
                <br />
                Supports OpenAI, Anthropic, Gemini, and more.
              </p>
            </div>
          </div>
          <InputBox />
        </div>
      )}

      {/* Loading */}
      {activeId && loading && (
        <div className="flex-1 flex items-center justify-center">
          <div className="h-5 w-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* Chat */}
      {activeId && !loading && (
        <>
          <div className="flex-1 overflow-y-auto">
            {messages.length === 0 && !streaming && (
              <div className="flex items-center justify-center h-full">
                <p className="text-sm text-text-muted">
                  Send a message to start the conversation.
                </p>
              </div>
            )}

            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}

            {streaming && streamingContent && (
              <MessageBubble
                message={{
                  id: "streaming",
                  role: "assistant",
                  content: streamingContent,
                  parent_id: null,
                  tool_calls: [],
                  created_at: new Date().toISOString(),
                }}
                isStreaming
              />
            )}

            {streaming && !streamingContent && (
              <div className="flex items-center gap-2 px-4 py-3 text-text-muted text-sm">
                <div className="h-4 w-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                Thinking...
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          <InputBox />
        </>
      )}
    </div>
  );
}

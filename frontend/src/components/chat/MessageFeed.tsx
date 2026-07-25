import { useEffect, useRef } from "react";
import { useConversationStore } from "../../stores/conversationStore";
import MessageBubble from "./MessageBubble";

export default function MessageFeed() {
	const messages = useConversationStore((state) => state.messages);
	const streaming = useConversationStore((state) => state.streaming);
	const streamingContent = useConversationStore(
		(state) => state.streamingContent,
	);
	const streamingReasoning = useConversationStore(
		(state) => state.streamingReasoning,
	);
	const streamingToolCalls = useConversationStore(
		(state) => state.streamingToolCalls,
	);
	const bottomRef = useRef<HTMLDivElement>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: preserve current scroll behavior until CUI-05
	useEffect(() => {
		bottomRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages, streamingContent, streamingReasoning]);

	return (
		<div className="h-full overflow-y-auto overscroll-contain">
			<div className="mx-auto max-w-3xl">
				{messages.length === 0 && !streaming && (
					<div className="flex items-center justify-center py-24">
						<p className="text-sm text-text-muted">No messages yet.</p>
					</div>
				)}

				{messages.map((message) => (
					<MessageBubble key={message.id} message={message} />
				))}

				{streaming &&
					(streamingContent ||
						streamingReasoning ||
						streamingToolCalls.length > 0) && (
						<MessageBubble
							message={{
								id: "streaming",
								role: "assistant",
								content: streamingContent,
								reasoning: streamingReasoning || undefined,
								parent_id: null,
								tool_calls: streamingToolCalls
									.filter((toolCall) => toolCall.name)
									.map((toolCall) => ({
										id: toolCall.id ?? `tc-${toolCall.index}`,
										name: toolCall.name,
										arguments: toolCall.arguments,
										result: toolCall.result,
										status: toolCall.status ?? "pending",
									})),
								status: "pending",
								created_at: new Date().toISOString(),
							}}
							isStreaming
						/>
					)}

				{streaming &&
					!streamingContent &&
					!streamingReasoning &&
					streamingToolCalls.length === 0 && (
						<div className="flex items-center gap-2 px-4 py-4 text-sm text-text-muted">
							<div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
							Thinking...
						</div>
					)}

				<div ref={bottomRef} />
			</div>
		</div>
	);
}

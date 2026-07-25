import { useEffect, useRef, useState } from "react";
import type { Message } from "../../services/conversation";
import { useConversationStore } from "../../stores/conversationStore";
import MessageBubble from "./MessageBubble";

function lastUserMessageId(messages: Message[]): string | null {
	for (let index = messages.length - 1; index >= 0; index--) {
		if (messages[index]?.role === "user") return messages[index].id;
	}
	return null;
}

function reasoningKey(message: Message): string {
	return message.parent_id ?? message.id;
}

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
	const [reasoningExpansion, setReasoningExpansion] = useState<
		Record<string, boolean>
	>({});
	const streamingParentId = lastUserMessageId(messages);
	const streamingReasoningKey = streamingParentId ?? "streaming";

	// biome-ignore lint/correctness/useExhaustiveDependencies: preserve current scroll behavior until CUI-05
	useEffect(() => {
		bottomRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages, streamingContent, streamingReasoning]);

	return (
		<div className="h-full overflow-y-auto overscroll-contain">
			<div className="mx-auto w-full max-w-[1080px]">
				{messages.length === 0 && !streaming && (
					<div className="flex items-center justify-center py-24">
						<p className="text-sm text-text-muted">No messages yet.</p>
					</div>
				)}

				{messages.map((message) => {
					const expansionKey = reasoningKey(message);
					return (
						<MessageBubble
							key={message.id}
							message={message}
							reasoningExpanded={reasoningExpansion[expansionKey]}
							onReasoningExpandedChange={(expanded) =>
								setReasoningExpansion((current) => ({
									...current,
									[expansionKey]: expanded,
								}))
							}
						/>
					);
				})}

				{streaming && (
					<MessageBubble
						message={{
							id: "streaming",
							role: "assistant",
							content: streamingContent,
							reasoning: streamingReasoning || undefined,
							parent_id: streamingParentId,
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
							created_at: "",
						}}
						isStreaming
						reasoningExpanded={reasoningExpansion[streamingReasoningKey]}
						onReasoningExpandedChange={(expanded) =>
							setReasoningExpansion((current) => ({
								...current,
								[streamingReasoningKey]: expanded,
							}))
						}
					/>
				)}

				<div ref={bottomRef} />
			</div>
		</div>
	);
}

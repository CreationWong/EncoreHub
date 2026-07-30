import { ArrowDownToLine } from "lucide-react";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import type { MutableRefObject } from "react";
import type { Message } from "../../services/conversation";
import { useConversationStore } from "../../stores/conversationStore";
import AnswerBody from "./AnswerBody";
import AssistantIdentity from "./AssistantIdentity";
import MessageBubble from "./MessageBubble";

const FOLLOW_THRESHOLD_PX = 96;

export function estimateStreamingTokens(content: string): number {
	if (!content) return 0;
	return Math.ceil(new TextEncoder().encode(content).length / 4);
}

function lastUserMessageId(messages: Message[]): string | null {
	for (let index = messages.length - 1; index >= 0; index--) {
		if (messages[index]?.role === "user") return messages[index].id;
	}
	return null;
}

function reasoningKey(message: Message): string {
	return message.parent_id ?? message.id;
}

function maxScrollTop(element: HTMLElement): number {
	return Math.max(0, element.scrollHeight - element.clientHeight);
}

function distanceFromBottom(element: HTMLElement): number {
	return Math.max(0, maxScrollTop(element) - element.scrollTop);
}

function cancelFrame(frameRef: MutableRefObject<number | null>) {
	if (frameRef.current === null) return;
	cancelAnimationFrame(frameRef.current);
	frameRef.current = null;
}

export default function MessageFeed() {
	const activeId = useConversationStore((state) => state.activeId);
	const messages = useConversationStore((state) => state.messages);
	const conversation = useConversationStore((state) =>
		state.conversations?.find((item) => item.id === state.activeId),
	);
	const streaming = useConversationStore((state) => state.streaming);
	const streamingContent = useConversationStore(
		(state) => state.streamingContent,
	);
	const streamingReasoning = useConversationStore(
		(state) => state.streamingReasoning,
	);
	const streamingDurationMs =
		useConversationStore((state) => state.streamingDurationMs) ?? 0;
	const streamingToolCalls = useConversationStore(
		(state) => state.streamingToolCalls,
	);
	const editingMessageId = useConversationStore(
		(state) => state.editingMessageId,
	);
	const cancelEditingMessage = useConversationStore(
		(state) => state.cancelEditingMessage,
	);
	const submitEditedMessage = useConversationStore(
		(state) => state.submitEditedMessage,
	);
	const setConversationScrollPosition = useConversationStore(
		(state) => state.setConversationScrollPosition,
	);
	const scrollerRef = useRef<HTMLDivElement>(null);
	const followFrameRef = useRef<number | null>(null);
	const scrollFrameRef = useRef<number | null>(null);
	const restoreFrameRef = useRef<number | null>(null);
	const followingRef = useRef(true);
	const restoringRef = useRef(false);
	const [showBackToLatest, setShowBackToLatest] = useState(false);
	const [reasoningExpansion, setReasoningExpansion] = useState<
		Record<string, boolean>
	>({});
	const streamingParentId = lastUserMessageId(messages);
	const streamingReasoningKey = streamingParentId ?? "streaming";
	const streamingTokenEstimate = estimateStreamingTokens(
		streamingContent + streamingReasoning,
	);
	const openingMessage =
		conversation?.character_snapshot?.opening_message?.trim();

	const writeScrollPosition = useCallback(
		(scrollTop: number) => {
			if (activeId) setConversationScrollPosition(activeId, scrollTop);
		},
		[activeId, setConversationScrollPosition],
	);

	const scrollToLatest = useCallback(() => {
		const element = scrollerRef.current;
		if (!element) return;
		const nextScrollTop = maxScrollTop(element);
		element.scrollTop = nextScrollTop;
		followingRef.current = true;
		setShowBackToLatest(false);
		writeScrollPosition(nextScrollTop);
	}, [writeScrollPosition]);

	const scheduleScrollToLatest = useCallback(() => {
		if (followFrameRef.current !== null) return;
		followFrameRef.current = requestAnimationFrame(() => {
			followFrameRef.current = null;
			if (followingRef.current && !restoringRef.current) scrollToLatest();
		});
	}, [scrollToLatest]);

	useLayoutEffect(() => {
		const element = scrollerRef.current;
		if (!element) return;

		cancelFrame(followFrameRef);
		cancelFrame(scrollFrameRef);
		cancelFrame(restoreFrameRef);
		restoringRef.current = true;
		setShowBackToLatest(false);
		const conversationId = activeId;
		const savedScrollTop = conversationId
			? useConversationStore.getState().scrollPositions[conversationId]
			: undefined;

		restoreFrameRef.current = requestAnimationFrame(() => {
			restoreFrameRef.current = null;
			const current = scrollerRef.current;
			if (!current) return;
			const nextScrollTop =
				savedScrollTop === undefined
					? maxScrollTop(current)
					: Math.min(savedScrollTop, maxScrollTop(current));
			current.scrollTop = nextScrollTop;
			followingRef.current = distanceFromBottom(current) <= FOLLOW_THRESHOLD_PX;
			setShowBackToLatest(!followingRef.current);
			restoringRef.current = false;
			if (conversationId) {
				setConversationScrollPosition(conversationId, nextScrollTop);
			}
		});

		return () => {
			if (conversationId) {
				setConversationScrollPosition(conversationId, element.scrollTop);
			}
			cancelFrame(followFrameRef);
			cancelFrame(scrollFrameRef);
			cancelFrame(restoreFrameRef);
			restoringRef.current = false;
		};
	}, [activeId, setConversationScrollPosition]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: each content source intentionally triggers a post-render follow check
	useEffect(() => {
		if (!restoringRef.current && followingRef.current) {
			scheduleScrollToLatest();
		}
	}, [
		messages,
		scheduleScrollToLatest,
		streamingContent,
		streamingDurationMs,
		streamingReasoning,
		streamingToolCalls,
	]);

	const handleScroll = () => {
		const element = scrollerRef.current;
		if (!element || restoringRef.current) return;

		if (distanceFromBottom(element) > FOLLOW_THRESHOLD_PX) {
			followingRef.current = false;
			cancelFrame(followFrameRef);
		}
		if (scrollFrameRef.current !== null) return;

		scrollFrameRef.current = requestAnimationFrame(() => {
			scrollFrameRef.current = null;
			const current = scrollerRef.current;
			if (!current) return;
			const nextScrollTop = current.scrollTop;
			const nearBottom = distanceFromBottom(current) <= FOLLOW_THRESHOLD_PX;
			followingRef.current = nearBottom;
			setShowBackToLatest(!nearBottom);
			writeScrollPosition(nextScrollTop);
		});
	};

	return (
		<div className="relative h-full min-h-0">
			<div
				ref={scrollerRef}
				data-testid="message-feed-scroller"
				onScroll={handleScroll}
				className="app-message-feed-scroller h-full overflow-y-auto overscroll-contain"
			>
				<div className="mx-auto w-full max-w-[1080px]">
					{messages.length === 0 && !streaming && openingMessage && (
						<article
							aria-label="Character opening message"
							className="app-message app-message-assistant px-4 py-5"
						>
							<AssistantIdentity />
							<AnswerBody content={openingMessage} />
						</article>
					)}

					{messages.length === 0 && !streaming && !openingMessage && (
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
								editing={message.id === editingMessageId}
								onEditCancel={cancelEditingMessage}
								onEditSubmit={(content) =>
									submitEditedMessage(message.id, content)
								}
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
								output_tokens: streamingTokenEstimate || null,
								duration_ms:
									streamingDurationMs > 0 ? streamingDurationMs : null,
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
				</div>
			</div>

			{showBackToLatest && (
				<button
					type="button"
					onClick={() => {
						followingRef.current = true;
						scheduleScrollToLatest();
					}}
					aria-label="Back to latest"
					title="Back to latest"
					className="absolute bottom-4 right-4 flex h-9 w-9 items-center justify-center rounded-md border border-border bg-surface text-text-secondary shadow-lg transition-colors hover:bg-surface-hover hover:text-text-primary"
				>
					<ArrowDownToLine className="h-4 w-4" />
				</button>
			)}
		</div>
	);
}

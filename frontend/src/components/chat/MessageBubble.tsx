import { Info, Wrench } from "lucide-react";
import type { Message } from "../../services/conversation";
import AnswerBody from "./AnswerBody";
import MarkdownRenderer from "./MarkdownRenderer";
import ReasoningSection from "./ReasoningSection";
import ReplyFooter from "./ReplyFooter";
import ToolExecutionList from "./ToolExecutionList";
import UserBubble from "./UserBubble";

interface MessageBubbleProps {
	message: Message;
	isStreaming?: boolean;
	reasoningExpanded?: boolean;
	onReasoningExpandedChange?: (expanded: boolean) => void;
}

function SystemMessage({ message }: { message: Message }) {
	return (
		<article
			aria-label="System message"
			className="flex gap-3 px-4 py-3 text-text-muted"
		>
			<Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
			<MarkdownRenderer
				content={message.content}
				size="xs"
				muted
				className="min-w-0 flex-1"
			/>
		</article>
	);
}

function ToolMessage({ message }: { message: Message }) {
	return (
		<article
			aria-label="Tool message"
			className="flex gap-3 px-4 py-3 text-text-muted"
		>
			<Wrench className="mt-0.5 h-3.5 w-3.5 shrink-0" />
			<div className="min-w-0 flex-1">
				{message.tool_calls.length > 0 ? (
					<ToolExecutionList calls={message.tool_calls} />
				) : (
					<MarkdownRenderer content={message.content} size="xs" muted />
				)}
			</div>
		</article>
	);
}

export default function MessageBubble({
	message,
	isStreaming = false,
	reasoningExpanded,
	onReasoningExpandedChange,
}: MessageBubbleProps) {
	if (message.role === "user") return <UserBubble message={message} />;
	if (message.role === "system") return <SystemMessage message={message} />;
	if (message.role === "tool") return <ToolMessage message={message} />;

	return (
		<article aria-label="Assistant message" className="px-4 py-5">
			{message.reasoning && (
				<ReasoningSection
					reasoning={message.reasoning}
					status={message.status}
					streaming={isStreaming}
					expanded={reasoningExpanded}
					onExpandedChange={onReasoningExpandedChange}
				/>
			)}
			<ToolExecutionList calls={message.tool_calls} />
			<AnswerBody content={message.content} streaming={isStreaming} />
			<ReplyFooter
				content={message.content}
				status={message.status}
				tokenCount={message.token_count}
				streaming={isStreaming}
			/>
		</article>
	);
}

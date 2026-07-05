import { ChevronRight, Info, Sparkles, User, Wrench } from "lucide-react";
import { useState } from "react";
import type { Message, ToolCall } from "../../services/conversation";
import CopyButton from "./CopyButton";
import MarkdownRenderer from "./MarkdownRenderer";

interface Props {
	message: Message;
	isStreaming?: boolean;
}

/**
 * Collapsible chain-of-thought block. Visually muted (small text, left rule)
 * to set it apart from the answer. Defaults collapsed; auto-expands while the
 * reasoning is still streaming so the user sees it think in real time.
 */
function ReasoningBlock({
	reasoning,
	streaming,
}: { reasoning: string; streaming?: boolean }) {
	const [open, setOpen] = useState(false);
	const expanded = open || !!streaming;
	return (
		<div className="mb-2">
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className="flex items-center gap-1 text-[11px] text-text-muted transition-colors hover:text-text-primary"
			>
				<ChevronRight
					className={`h-3 w-3 transition-transform ${expanded ? "rotate-90" : ""}`}
				/>
				<span>{streaming ? "Thinking…" : "Thought process"}</span>
			</button>
			{expanded && (
				<div className="mt-1 border-l-2 border-border pl-3 text-xs text-text-muted">
					<p className="whitespace-pre-wrap break-words">{reasoning}</p>
				</div>
			)}
		</div>
	);
}

function statusColor(status?: string): string {
	switch (status) {
		case "success":
			return "text-green-500";
		case "error":
			return "text-red-500";
		default:
			return "text-text-muted";
	}
}

/** A single tool invocation: name, arguments, and (if executed) result. */
function ToolCallCard({ call }: { call: ToolCall }) {
	const [open, setOpen] = useState(false);
	return (
		<div className="my-2 overflow-hidden rounded-lg border border-border bg-surface-alt/30 text-xs">
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-hover"
			>
				<Wrench className="h-3.5 w-3.5 shrink-0 text-accent" />
				<span className="font-mono font-medium text-text-primary">
					{call.name}
				</span>
				<span
					className={`ml-auto text-[10px] uppercase ${statusColor(call.status)}`}
				>
					{call.status ?? "pending"}
				</span>
				<ChevronRight
					className={`h-3 w-3 shrink-0 text-text-muted transition-transform ${open ? "rotate-90" : ""}`}
				/>
			</button>
			{open && (
				<div className="border-t border-border px-3 py-2">
					<div className="mb-1 text-[10px] uppercase text-text-muted">
						Arguments
					</div>
					<pre className="overflow-x-auto rounded-md bg-surface px-2.5 py-2 font-mono text-text-primary whitespace-pre-wrap break-words">
						{call.arguments || "{}"}
					</pre>
					{call.result && (
						<>
							<div className="mt-2 mb-1 text-[10px] uppercase text-text-muted">
								Result
							</div>
							<pre className="overflow-x-auto rounded-md bg-surface px-2.5 py-2 font-mono text-text-primary whitespace-pre-wrap break-words">
								{call.result}
							</pre>
						</>
					)}
				</div>
			)}
		</div>
	);
}

function tokenLabel(count: number): string {
	if (count >= 1000) {
		return `${(count / 1000).toFixed(1)}k tokens`;
	}
	return `${count} tokens`;
}

export default function MessageBubble({ message, isStreaming }: Props) {
	const isUser = message.role === "user";
	const isSystem = message.role === "system";
	const isTool = message.role === "tool";

	if (isSystem) {
		return (
			<div className="group flex gap-3 px-4 py-2">
				<Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-muted" />
				<MarkdownRenderer
					content={message.content}
					size="xs"
					muted
					className="min-w-0 flex-1"
				/>
			</div>
		);
	}

	if (isTool) {
		return (
			<div className="group flex gap-3 px-4 py-2">
				<Wrench className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-muted" />
				<div className="min-w-0 flex-1">
					{message.tool_calls?.length > 0 ? (
						message.tool_calls.map((tc) => (
							<ToolCallCard key={tc.id} call={tc} />
						))
					) : (
						<MarkdownRenderer content={message.content} size="xs" muted />
					)}
				</div>
			</div>
		);
	}

	if (isUser) {
		return (
			<div className="group flex justify-end px-4 py-3">
				<div className="flex max-w-[85%] items-end gap-2">
					<div className="opacity-0 transition-opacity group-hover:opacity-100">
						<CopyButton text={message.content} />
					</div>
					<div className="rounded-2xl rounded-br-sm bg-accent px-4 py-2.5 text-sm text-white shadow-sm">
						<p className="whitespace-pre-wrap break-words">{message.content}</p>
					</div>
					<div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
						<User className="h-3.5 w-3.5" />
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="group flex gap-3 px-4 py-4 hover:bg-surface-alt/30">
			<div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
				<Sparkles className="h-3.5 w-3.5" />
			</div>
			<div className="min-w-0 flex-1 pt-0.5">
				<div className="mb-1 flex items-center justify-between">
					<span className="text-xs font-medium text-text-muted">Assistant</span>
					<div className="flex items-center gap-2">
						{message.token_count ? (
							<span className="select-none text-[10px] text-text-muted/50 tabular-nums">
								{tokenLabel(message.token_count)}
							</span>
						) : null}
						{!isStreaming && message.content && (
							<div className="opacity-0 transition-opacity group-hover:opacity-100">
								<CopyButton text={message.content} />
							</div>
						)}
					</div>
				</div>
				{message.reasoning && (
					<ReasoningBlock
						reasoning={message.reasoning}
						streaming={isStreaming && !message.content}
					/>
				)}
				{message.tool_calls?.map((tc) => (
					<ToolCallCard key={tc.id} call={tc} />
				))}
				<MarkdownRenderer content={message.content} />
				{isStreaming && (
					<span className="ml-0.5 inline-block h-4 w-1.5 animate-cursor-blink bg-accent align-text-bottom" />
				)}
			</div>
		</div>
	);
}

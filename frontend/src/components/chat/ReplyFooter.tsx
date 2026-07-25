import { CircleStop, CircleX, LoaderCircle } from "lucide-react";
import type { Message } from "../../services/conversation";
import CopyButton from "./CopyButton";

export function formatTokenCount(count: number): string {
	return `${Math.trunc(count).toLocaleString("en-US")} tokens`;
}

function replyState(status: Message["status"], streaming: boolean) {
	if (status === "failed") {
		return {
			label: "Failed",
			Icon: CircleX,
			className: "bg-danger-bg text-danger",
			animate: false,
		};
	}
	if (status === "stopped") {
		return {
			label: "Stopped",
			Icon: CircleStop,
			className: "bg-warning-bg text-warning",
			animate: false,
		};
	}
	if (status === "pending") {
		return {
			label: streaming ? "Generating" : "Pending",
			Icon: LoaderCircle,
			className: "bg-control text-text-muted",
			animate: streaming,
		};
	}
	return null;
}

interface ReplyFooterProps {
	content: string;
	status: Message["status"];
	tokenCount?: number;
	streaming?: boolean;
}

export default function ReplyFooter({
	content,
	status,
	tokenCount,
	streaming = false,
}: ReplyFooterProps) {
	const state = replyState(status, streaming);
	const showTokens = Number.isFinite(tokenCount) && (tokenCount ?? 0) > 0;
	const canCopy = Boolean(content) && !streaming;

	if (!state && !showTokens && !canCopy) return null;

	const StateIcon = state?.Icon;

	return (
		<footer
			aria-label="Reply actions and status"
			className="mt-3 flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1.5"
		>
			{canCopy && (
				<div className="flex shrink-0 items-center">
					<CopyButton text={content} label="Copy reply" />
				</div>
			)}
			<div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-1">
				{showTokens && tokenCount !== undefined && (
					<span
						className="flex h-6 min-w-20 select-none items-center justify-center rounded-md bg-control px-2 text-[11px] tabular-nums text-text-muted"
						title="Total input and output tokens"
					>
						{formatTokenCount(tokenCount)}
					</span>
				)}
				{state && StateIcon && (
					<span
						className={`flex h-6 items-center gap-1 rounded-md px-2 text-[11px] font-medium ${state.className}`}
						title={`Message status: ${state.label}`}
					>
						<StateIcon
							aria-hidden="true"
							className={`h-3 w-3 ${state.animate ? "animate-spin" : ""}`}
						/>
						{state.label}
					</span>
				)}
			</div>
		</footer>
	);
}

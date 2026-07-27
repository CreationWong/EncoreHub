import { CircleStop, CircleX, LoaderCircle } from "lucide-react";
import type { Message } from "../../services/conversation";
import CopyButton from "./CopyButton";

const MAX_TOKEN_COUNT = 1_000_000_000;
const MAX_DURATION_MS = 24 * 60 * 60 * 1000;

function boundedNumber(
	value: number | null | undefined,
	maximum: number,
): number | undefined {
	return typeof value === "number" &&
		Number.isFinite(value) &&
		value >= 0 &&
		value <= maximum
		? value
		: undefined;
}

export function formatTokenCount(count: number): string {
	return `${Math.trunc(count).toLocaleString("en-US")} tokens`;
}

export function formatDuration(durationMs: number): string {
	if (durationMs < 1000) return `${Math.trunc(durationMs)} ms`;
	if (durationMs < 60_000) {
		return `${(durationMs / 1000).toLocaleString("en-US", {
			maximumFractionDigits: 1,
		})} s`;
	}
	const minutes = Math.floor(durationMs / 60_000);
	const seconds = Math.floor((durationMs % 60_000) / 1000);
	return `${minutes}m ${seconds}s`;
}

function formatTokenRate(outputTokens: number, durationMs: number): string {
	const rate = outputTokens / (durationMs / 1000);
	return `${rate.toLocaleString("en-US", {
		minimumFractionDigits: rate < 100 ? 1 : 0,
		maximumFractionDigits: 1,
	})} tokens/s`;
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

function finishState(reason: string) {
	const normalized = reason.toLowerCase();
	if (normalized === "stop" || normalized === "end_turn") {
		return { label: "Complete", className: "bg-control text-text-muted" };
	}
	if (normalized === "length" || normalized === "max_tokens") {
		return { label: "Limit", className: "bg-warning-bg text-warning" };
	}
	if (normalized === "tool_calls" || normalized === "tool_use") {
		return { label: "Tool", className: "bg-accent/10 text-accent" };
	}
	if (normalized === "cancelled") {
		return { label: "Cancelled", className: "bg-warning-bg text-warning" };
	}
	if (normalized === "error") {
		return { label: "Error", className: "bg-danger-bg text-danger" };
	}
	return { label: "Finished", className: "bg-control text-text-muted" };
}

interface ReplyFooterProps {
	content: string;
	status: Message["status"];
	tokenCount?: number | null;
	inputTokens?: number | null;
	outputTokens?: number | null;
	durationMs?: number | null;
	finishReason?: string | null;
	streaming?: boolean;
}

export default function ReplyFooter({
	content,
	status,
	tokenCount,
	inputTokens,
	outputTokens,
	durationMs,
	finishReason,
	streaming = false,
}: ReplyFooterProps) {
	const state = replyState(status, streaming);
	const input = boundedNumber(inputTokens, MAX_TOKEN_COUNT);
	const output = boundedNumber(outputTokens, MAX_TOKEN_COUNT);
	const legacyTotal = boundedNumber(tokenCount, MAX_TOKEN_COUNT);
	const total =
		input !== undefined && output !== undefined
			? input + output
			: streaming && output !== undefined
				? output
				: legacyTotal;
	const duration = boundedNumber(durationMs, MAX_DURATION_MS);
	const showTotal =
		total !== undefined && total > 0 && total <= MAX_TOKEN_COUNT;
	const showRate =
		output !== undefined &&
		output > 0 &&
		duration !== undefined &&
		duration > 0;
	const rawFinishReason = finishReason?.trim().slice(0, 128) || undefined;
	const finish = rawFinishReason ? finishState(rawFinishReason) : undefined;
	const canCopy = Boolean(content) && !streaming;

	if (
		!state &&
		!showRate &&
		!showTotal &&
		duration === undefined &&
		!finish &&
		!canCopy
	) {
		return null;
	}

	const StateIcon = state?.Icon;
	const metricClass =
		"flex h-6 max-w-32 select-none items-center justify-center truncate rounded-md bg-control px-2 text-[11px] tabular-nums text-text-muted";

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
				{showRate && output !== undefined && duration !== undefined && (
					<span
						className={metricClass}
						title={
							streaming
								? "Live estimated output rate"
								: "Provider output tokens per generation second"
						}
					>
						{formatTokenRate(output, duration)}
					</span>
				)}
				{showTotal && total !== undefined && (
					<span
						className={`${metricClass} min-w-20`}
						title={
							streaming
								? "Live output token estimate"
								: input !== undefined && output !== undefined
									? "Provider input and output tokens"
									: "Legacy total token count"
						}
					>
						{formatTokenCount(total)}
					</span>
				)}
				{duration !== undefined && (
					<span className={metricClass} title="Provider generation duration">
						{formatDuration(duration)}
					</span>
				)}
				{finish && rawFinishReason && (
					<span
						className={`flex h-6 max-w-28 items-center truncate rounded-md px-2 text-[11px] font-medium ${finish.className}`}
						title={`Finish reason: ${rawFinishReason}`}
					>
						{finish.label}
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

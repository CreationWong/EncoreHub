import {
	CheckCircle2,
	ChevronDown,
	CircleStop,
	CircleX,
	LoaderCircle,
	type LucideIcon,
} from "lucide-react";
import { useEffect, useId, useState } from "react";
import type { Message } from "../../services/conversation";

interface ReasoningSectionProps {
	reasoning: string;
	status: Message["status"];
	streaming?: boolean;
	expanded?: boolean;
	onExpandedChange?: (expanded: boolean) => void;
}

function reasoningState(
	status: Message["status"],
	streaming: boolean,
): {
	label: string;
	Icon: LucideIcon;
	className: string;
	animate?: boolean;
} {
	if (streaming) {
		return {
			label: "Thinking",
			Icon: LoaderCircle,
			className: "text-text-muted",
			animate: true,
		};
	}
	if (status === "failed") {
		return {
			label: "Processing failed",
			Icon: CircleX,
			className: "text-danger",
		};
	}
	if (status === "stopped") {
		return {
			label: "Stopped",
			Icon: CircleStop,
			className: "text-warning",
		};
	}
	return {
		label: "Processed",
		Icon: CheckCircle2,
		className: "text-text-muted",
	};
}

export default function ReasoningSection({
	reasoning,
	status,
	streaming = false,
	expanded,
	onExpandedChange,
}: ReasoningSectionProps) {
	const [internalExpanded, setInternalExpanded] = useState(streaming);
	const contentId = useId();
	const open = expanded ?? internalExpanded;
	const state = reasoningState(status, streaming);
	const StateIcon = state.Icon;

	useEffect(() => {
		if (streaming && expanded === undefined) onExpandedChange?.(true);
	}, [expanded, onExpandedChange, streaming]);

	const toggle = () => {
		const next = !open;
		setInternalExpanded(next);
		onExpandedChange?.(next);
	};

	return (
		<section className="mb-4 max-w-[82ch] border-l border-border pl-3">
			<button
				type="button"
				onClick={toggle}
				aria-expanded={open}
				aria-controls={contentId}
				className={`flex h-7 items-center gap-1.5 rounded pr-1 text-left text-[11px] font-medium transition-colors hover:text-text-primary ${state.className}`}
			>
				<StateIcon
					className={`h-3.5 w-3.5 shrink-0 ${state.animate ? "animate-spin" : ""}`}
				/>
				<span>{state.label}</span>
				<ChevronDown
					className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
				/>
			</button>
			{open && (
				<div
					id={contentId}
					className="pb-1 pt-1 text-[13px] leading-6 text-text-muted"
				>
					<p className="whitespace-pre-wrap break-words">{reasoning}</p>
				</div>
			)}
		</section>
	);
}

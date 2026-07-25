import {
	CheckCircle2,
	ChevronDown,
	CircleX,
	LoaderCircle,
	Wrench,
} from "lucide-react";
import { useId, useState } from "react";
import type { ToolCall } from "../../services/conversation";

function toolState(status: ToolCall["status"]) {
	if (status === "success") {
		return {
			label: "Completed",
			Icon: CheckCircle2,
			className: "text-success",
			animate: false,
		};
	}
	if (status === "error") {
		return {
			label: "Failed",
			Icon: CircleX,
			className: "text-danger",
			animate: false,
		};
	}
	return {
		label: "Pending",
		Icon: LoaderCircle,
		className: "text-text-muted",
		animate: true,
	};
}

function ToolExecution({ call }: { call: ToolCall }) {
	const [open, setOpen] = useState(false);
	const detailsId = useId();
	const state = toolState(call.status);
	const StateIcon = state.Icon;

	return (
		<div>
			<button
				type="button"
				onClick={() => setOpen((value) => !value)}
				aria-expanded={open}
				aria-controls={detailsId}
				className="flex h-9 w-full min-w-0 items-center gap-2 px-1 text-left text-xs transition-colors hover:bg-control"
			>
				<Wrench className="h-3.5 w-3.5 shrink-0 text-accent" />
				<span className="min-w-0 flex-1 truncate font-mono font-medium text-text-primary">
					{call.name}
				</span>
				<span
					className={`flex shrink-0 items-center gap-1 text-[10px] font-medium ${state.className}`}
				>
					<StateIcon
						className={`h-3 w-3 ${state.animate ? "animate-spin" : ""}`}
					/>
					{state.label}
				</span>
				<ChevronDown
					className={`h-3.5 w-3.5 shrink-0 text-text-muted transition-transform ${open ? "rotate-180" : ""}`}
				/>
			</button>
			{open && (
				<div
					id={detailsId}
					className="border-t border-border bg-control/40 px-3 py-2"
				>
					<p className="mb-1 text-[10px] font-medium uppercase text-text-muted">
						Arguments
					</p>
					<pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-text-primary">
						{call.arguments || "{}"}
					</pre>
					{call.result && (
						<>
							<p className="mb-1 mt-3 text-[10px] font-medium uppercase text-text-muted">
								Result
							</p>
							<pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-text-primary">
								{call.result}
							</pre>
						</>
					)}
				</div>
			)}
		</div>
	);
}

export default function ToolExecutionList({ calls }: { calls: ToolCall[] }) {
	if (calls.length === 0) return null;

	return (
		<section aria-label="Tool executions" className="my-4">
			<div className="divide-y divide-border border-y border-border">
				{calls.map((call) => (
					<ToolExecution key={call.id} call={call} />
				))}
			</div>
		</section>
	);
}

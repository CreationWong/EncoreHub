import { Command } from "lucide-react";
import { useEffect, useRef } from "react";
import type { SlashCommand } from "../../commands/slash";

interface Props {
	items: SlashCommand[];
	activeIndex: number;
	onSelect: (cmd: SlashCommand) => void;
	onHover: (index: number) => void;
}

export default function SlashCommandMenu({
	items,
	activeIndex,
	onSelect,
	onHover,
}: Props) {
	const activeRef = useRef<HTMLButtonElement>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll on selection
	useEffect(() => {
		activeRef.current?.scrollIntoView({ block: "nearest" });
	}, [activeIndex]);

	if (items.length === 0) return null;

	return (
		<div className="absolute bottom-full left-0 right-0 mb-2 max-h-64 overflow-y-auto rounded-xl border border-border bg-surface shadow-2xl">
			<ul className="p-1">
				{items.map((cmd, i) => (
					<li key={cmd.id}>
						<button
							type="button"
							ref={i === activeIndex ? activeRef : undefined}
							onMouseEnter={() => onHover(i)}
							onClick={() => onSelect(cmd)}
							className={`flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left text-sm ${
								i === activeIndex
									? "bg-accent/10 text-accent"
									: "text-text-secondary hover:bg-surface-hover"
							}`}
						>
							<Command
								className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
									i === activeIndex ? "text-accent" : "text-text-muted"
								}`}
							/>
							<span className="min-w-0 flex-1">
								<span className="block font-mono text-xs">{cmd.name}</span>
								<span className="block text-[11px] text-text-muted">
									{cmd.description}
								</span>
							</span>
						</button>
					</li>
				))}
			</ul>
		</div>
	);
}

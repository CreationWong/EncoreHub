import { Wrench } from "lucide-react";
import { useEffect } from "react";
import type { SlashTool } from "../../tools/slashTools";

interface Props {
	id: string;
	items: SlashTool[];
	activeIndex: number;
	onSelect: (tool: SlashTool) => void;
	onHover: (index: number) => void;
}

export function slashToolOptionId(toolId: string): string {
	return `slash-tool-option-${toolId}`;
}

export default function SlashToolMenu({
	id,
	items,
	activeIndex,
	onSelect,
	onHover,
}: Props) {
	useEffect(() => {
		const activeTool = items[activeIndex];
		if (!activeTool) return;
		const option = document.getElementById(slashToolOptionId(activeTool.id));
		if (typeof option?.scrollIntoView === "function") {
			option.scrollIntoView({ block: "nearest" });
		}
	}, [activeIndex, items]);

	if (items.length === 0) return null;

	return (
		<div className="absolute bottom-full left-0 right-0 z-20 mb-1 max-h-64 overflow-y-auto rounded-lg border border-border bg-surface p-1.5 shadow-2xl">
			<div
				id={id}
				// biome-ignore lint/a11y/useSemanticElements: textarea focus owns this autocomplete listbox.
				role="listbox"
				aria-label="Slash tools"
				tabIndex={-1}
			>
				<div className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase text-text-muted">
					Tools
				</div>
				{items.map((tool, index) => {
					const active = index === activeIndex;
					return (
						<button
							key={tool.id}
							id={slashToolOptionId(tool.id)}
							type="button"
							// biome-ignore lint/a11y/useSemanticElements: focus stays in the textarea while navigating options.
							role="option"
							aria-selected={active}
							tabIndex={-1}
							onMouseDown={(event) => event.preventDefault()}
							onMouseEnter={() => onHover(index)}
							onClick={() => onSelect(tool)}
							className={`group flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left text-sm ${
								active
									? "bg-surface-hover text-text-primary"
									: "text-text-secondary hover:bg-surface-hover hover:text-text-primary"
							}`}
						>
							<Wrench
								aria-hidden="true"
								className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${active ? "text-accent" : "text-text-muted group-hover:text-accent"}`}
							/>
							<span className="min-w-0 flex-1">
								<span className="block font-mono text-xs">{tool.name}</span>
								<span className="block text-[11px] text-text-muted">
									{tool.description}
								</span>
							</span>
						</button>
					);
				})}
			</div>
		</div>
	);
}

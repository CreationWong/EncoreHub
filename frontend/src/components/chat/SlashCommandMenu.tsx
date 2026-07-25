import { Command } from "lucide-react";
import { Fragment, useEffect, useRef } from "react";
import type { SlashCommand } from "../../commands/slash";

const COMMAND_GROUPS: {
	id: SlashCommand["group"];
	label: string;
}[] = [
	{ id: "conversation", label: "Conversation" },
	{ id: "workspace", label: "Workspace" },
	{ id: "developer", label: "Developer" },
];

interface Props {
	id: string;
	items: SlashCommand[];
	activeIndex: number;
	onSelect: (cmd: SlashCommand) => void;
	onHover: (index: number) => void;
}

export function slashCommandOptionId(commandId: string): string {
	return `slash-command-option-${commandId}`;
}

export default function SlashCommandMenu({
	id,
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
		<div className="absolute bottom-full left-0 right-0 z-20 mb-2 max-h-72 overflow-y-auto rounded-lg border border-border bg-surface p-1.5 shadow-2xl">
			<div
				id={id}
				// biome-ignore lint/a11y/useSemanticElements: the textarea owns this rich listbox through aria-activedescendant
				role="listbox"
				aria-label="Slash commands"
				tabIndex={-1}
			>
				{COMMAND_GROUPS.map((group) => {
					const groupItems = items
						.map((command, index) => ({ command, index }))
						.filter(({ command }) => command.group === group.id);
					if (groupItems.length === 0) return null;
					const labelId = `${id}-${group.id}-label`;
					return (
						<fieldset
							key={group.id}
							aria-labelledby={labelId}
							className="mb-1 min-w-0 border-0 p-0 last:mb-0"
						>
							<legend
								id={labelId}
								className="block w-full px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase text-text-muted"
							>
								{group.label}
							</legend>
							{groupItems.map(({ command, index }) => {
								const active = index === activeIndex;
								return (
									<Fragment key={command.id}>
										<button
											id={slashCommandOptionId(command.id)}
											type="button"
											// biome-ignore lint/a11y/useSemanticElements: rich options remain buttons while focus stays on the textarea
											role="option"
											aria-selected={active}
											tabIndex={-1}
											ref={active ? activeRef : undefined}
											onMouseDown={(event) => event.preventDefault()}
											onMouseEnter={() => onHover(index)}
											onClick={() => onSelect(command)}
											className={`flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left text-sm ${
												active
													? "bg-accent/10 text-accent"
													: "text-text-secondary hover:bg-surface-hover"
											}`}
										>
											<Command
												aria-hidden="true"
												className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
													active ? "text-accent" : "text-text-muted"
												}`}
											/>
											<span className="min-w-0 flex-1">
												<span className="block font-mono text-xs">
													{command.name}
												</span>
												<span className="block text-[11px] text-text-muted">
													{command.description}
												</span>
											</span>
										</button>
									</Fragment>
								);
							})}
						</fieldset>
					);
				})}
			</div>
		</div>
	);
}

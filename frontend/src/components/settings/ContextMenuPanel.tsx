import { ChevronDown, ChevronUp, GripVertical } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
	type GlobalContextMenuItemId,
	useSettingsStore,
} from "../../stores/settingsStore";
import { globalContextMenuItemDefinition } from "../ui/globalContextMenuItems";

function itemIdAtPoint(x: number, y: number): GlobalContextMenuItemId | null {
	// Pointer hit testing works consistently where desktop WebViews omit HTML drag events.
	const element = document.elementFromPoint(x, y);
	const row = element?.closest<HTMLElement>("[data-context-menu-item-id]");
	const id = row?.dataset.contextMenuItemId;
	return id === "new-chat" || id === "settings" ? id : null;
}

export default function ContextMenuPanel() {
	const items = useSettingsStore((state) => state.globalContextMenuItems);
	const setVisible = useSettingsStore(
		(state) => state.setGlobalContextMenuItemVisible,
	);
	const moveItem = useSettingsStore((state) => state.moveGlobalContextMenuItem);
	const [draggedId, setDraggedId] = useState<GlobalContextMenuItemId | null>(
		null,
	);
	const [targetId, setTargetId] = useState<GlobalContextMenuItemId | null>(
		null,
	);
	const lastTargetRef = useRef<GlobalContextMenuItemId | null>(null);

	useEffect(() => {
		if (!draggedId) return;
		const previousUserSelect = document.body.style.userSelect;
		document.body.style.userSelect = "none";
		const move = (event: PointerEvent) => {
			const nextTarget = itemIdAtPoint(event.clientX, event.clientY);
			if (!nextTarget || nextTarget === draggedId) {
				lastTargetRef.current = null;
				setTargetId(null);
				return;
			}
			setTargetId(nextTarget);
			if (lastTargetRef.current === nextTarget) return;
			lastTargetRef.current = nextTarget;
			moveItem(draggedId, nextTarget);
		};
		const end = () => {
			lastTargetRef.current = null;
			setDraggedId(null);
			setTargetId(null);
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", end, { once: true });
		window.addEventListener("pointercancel", end, { once: true });
		return () => {
			document.body.style.userSelect = previousUserSelect;
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", end);
			window.removeEventListener("pointercancel", end);
		};
	}, [draggedId, moveItem]);

	const moveBy = (id: GlobalContextMenuItemId, offset: -1 | 1) => {
		const index = items.findIndex((item) => item.id === id);
		const target = items[index + offset];
		if (target) moveItem(id, target.id);
	};

	return (
		<div className="mx-auto max-w-3xl">
			<ul
				aria-label="Global context menu items"
				className="list-none divide-y divide-border border-y border-border p-0"
			>
				{items.map((item, index) => {
					const definition = globalContextMenuItemDefinition(item.id);
					if (!definition) return null;
					const Icon = definition.icon;
					return (
						<li
							key={item.id}
							aria-label={definition.label}
							data-context-menu-item-id={item.id}
							className={`flex min-h-14 items-center gap-3 px-1 py-2 transition-colors ${
								targetId === item.id
									? "bg-selected"
									: draggedId === item.id
										? "opacity-60"
										: "hover:bg-surface-hover"
							}`}
						>
							<button
								type="button"
								onPointerDown={(event) => {
									event.preventDefault();
									lastTargetRef.current = null;
									setDraggedId(item.id);
								}}
								aria-label={`Drag ${definition.label}`}
								title="Drag to reorder"
								className="flex h-7 w-7 touch-none items-center justify-center rounded text-text-muted hover:bg-control hover:text-text-primary active:cursor-grabbing"
							>
								<GripVertical className="h-4 w-4 cursor-grab" />
							</button>
							<Icon className="h-4 w-4 shrink-0 text-text-secondary" />
							<span className="min-w-0 flex-1 truncate text-sm text-text-primary">
								{definition.label}
							</span>
							<label className="flex shrink-0 items-center">
								<input
									type="checkbox"
									checked={item.visible}
									onChange={(event) =>
										setVisible(item.id, event.target.checked)
									}
									aria-label={`Show ${definition.label}`}
									className="h-4 w-4 accent-accent"
								/>
							</label>
							<button
								type="button"
								disabled={index === 0}
								onClick={() => moveBy(item.id, -1)}
								aria-label={`Move ${definition.label} up`}
								title="Move up"
								className="flex h-7 w-7 items-center justify-center rounded text-text-muted hover:bg-control hover:text-text-primary disabled:opacity-30"
							>
								<ChevronUp className="h-3.5 w-3.5" />
							</button>
							<button
								type="button"
								disabled={index === items.length - 1}
								onClick={() => moveBy(item.id, 1)}
								aria-label={`Move ${definition.label} down`}
								title="Move down"
								className="flex h-7 w-7 items-center justify-center rounded text-text-muted hover:bg-control hover:text-text-primary disabled:opacity-30"
							>
								<ChevronDown className="h-3.5 w-3.5" />
							</button>
						</li>
					);
				})}
			</ul>
		</div>
	);
}

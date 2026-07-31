import {
	Check,
	ChevronDown,
	ChevronUp,
	GripVertical,
	Monitor,
	Moon,
	Sun,
} from "lucide-react";
import { useState } from "react";
import { getRuntimePlatform } from "../../services/runtimePlatform";
import {
	type GlobalContextMenuItemId,
	type Theme,
	useSettingsStore,
} from "../../stores/settingsStore";
import { globalContextMenuItemDefinition } from "../ui/globalContextMenuItems";

const THEMES: { id: Theme; label: string; icon: typeof Sun }[] = [
	{ id: "light", label: "Light", icon: Sun },
	{ id: "dark", label: "Dark", icon: Moon },
	{ id: "system", label: "System", icon: Monitor },
];

export default function AppearancePanel() {
	const theme = useSettingsStore((state) => state.theme);
	const setTheme = useSettingsStore((state) => state.setTheme);
	const trafficLights = useSettingsStore(
		(state) => state.trafficLightWindowControls,
	);
	const setTrafficLights = useSettingsStore(
		(state) => state.setTrafficLightWindowControls,
	);
	const contextMenuItems = useSettingsStore(
		(state) => state.globalContextMenuItems,
	);
	const setContextMenuItemVisible = useSettingsStore(
		(state) => state.setGlobalContextMenuItemVisible,
	);
	const moveContextMenuItem = useSettingsStore(
		(state) => state.moveGlobalContextMenuItem,
	);
	const [draggedId, setDraggedId] = useState<GlobalContextMenuItemId | null>(
		null,
	);
	const [dropTargetId, setDropTargetId] =
		useState<GlobalContextMenuItemId | null>(null);
	const platform = getRuntimePlatform();

	const moveBy = (id: GlobalContextMenuItemId, offset: -1 | 1) => {
		const index = contextMenuItems.findIndex((item) => item.id === id);
		const target = contextMenuItems[index + offset];
		if (target) moveContextMenuItem(id, target.id);
	};

	return (
		<div className="mx-auto max-w-3xl space-y-8">
			<section aria-labelledby="appearance-theme-heading">
				<div className="mb-3">
					<h3
						id="appearance-theme-heading"
						className="text-sm font-semibold text-text-primary"
					>
						Theme
					</h3>
					<p className="mt-1 text-xs text-text-muted">
						Choose how application surfaces and content are rendered.
					</p>
				</div>
				<div
					aria-label="Application theme"
					className="grid grid-cols-3 overflow-hidden rounded-md border border-border bg-surface-alt/40"
				>
					{THEMES.map((option, index) => {
						const selected = theme === option.id;
						return (
							<button
								key={option.id}
								type="button"
								aria-pressed={selected}
								onClick={() => setTheme(option.id)}
								className={`flex h-12 min-w-0 items-center justify-center gap-2 px-3 text-sm transition-colors ${
									index > 0 ? "border-l border-border" : ""
								} ${
									selected
										? "bg-selected text-text-primary"
										: "text-text-secondary hover:bg-control hover:text-text-primary"
								}`}
							>
								<option.icon className="h-4 w-4 shrink-0" />
								<span className="truncate">{option.label}</span>
								<Check
									aria-hidden="true"
									className={`h-3.5 w-3.5 shrink-0 ${
										selected ? "opacity-100" : "opacity-0"
									}`}
								/>
							</button>
						);
					})}
				</div>
			</section>

			<section aria-labelledby="context-menu-items-heading">
				<div className="mb-3">
					<h3
						id="context-menu-items-heading"
						className="text-sm font-semibold text-text-primary"
					>
						Context menu items
					</h3>
				</div>
				<ul
					aria-label="Global context menu items"
					className="list-none divide-y divide-border border-y border-border p-0"
				>
					{contextMenuItems.map((item, index) => {
						const definition = globalContextMenuItemDefinition(item.id);
						if (!definition) return null;
						const Icon = definition.icon;
						return (
							<li
								key={item.id}
								aria-label={definition.label}
								draggable
								onDragStart={() => setDraggedId(item.id)}
								onDragOver={(event) => {
									event.preventDefault();
									setDropTargetId(item.id);
								}}
								onDrop={(event) => {
									event.preventDefault();
									if (draggedId) moveContextMenuItem(draggedId, item.id);
									setDraggedId(null);
									setDropTargetId(null);
								}}
								onDragEnd={() => {
									setDraggedId(null);
									setDropTargetId(null);
								}}
								className={`flex min-h-14 items-center gap-3 px-1 py-2 transition-colors ${
									dropTargetId === item.id && draggedId !== item.id
										? "bg-selected"
										: "hover:bg-surface-hover"
								}`}
							>
								<GripVertical className="h-4 w-4 shrink-0 cursor-grab text-text-muted active:cursor-grabbing" />
								<Icon className="h-4 w-4 shrink-0 text-text-secondary" />
								<span className="min-w-0 flex-1 truncate text-sm text-text-primary">
									{definition.label}
								</span>
								<label className="flex shrink-0 items-center">
									<input
										type="checkbox"
										checked={item.visible}
										onChange={(event) =>
											setContextMenuItemVisible(item.id, event.target.checked)
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
									disabled={index === contextMenuItems.length - 1}
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
			</section>

			{platform === "windows" && (
				<section aria-labelledby="window-style-heading">
					<div className="mb-3">
						<h3
							id="window-style-heading"
							className="text-sm font-semibold text-text-primary"
						>
							Window controls
						</h3>
						<p className="mt-1 text-xs text-text-muted">
							Customize the controls in the EncoreHub titlebar.
						</p>
					</div>
					<div className="flex min-h-16 items-center gap-4 border-y border-border py-3">
						<div
							aria-hidden="true"
							className="flex h-8 w-24 shrink-0 items-center justify-center gap-2 rounded-md bg-control"
						>
							<span className="h-3 w-3 rounded-full bg-window-minimize" />
							<span className="h-3 w-3 rounded-full bg-window-maximize" />
							<span className="h-3 w-3 rounded-full bg-window-close" />
						</div>
						<div className="min-w-0 flex-1">
							<p className="text-sm font-medium text-text-primary">
								Traffic-light colors
							</p>
							<p className="mt-0.5 text-xs text-text-muted">
								Use yellow, green, and red hover colors for window actions.
							</p>
						</div>
						<button
							type="button"
							role="switch"
							aria-checked={trafficLights}
							aria-label="Use traffic-light window controls"
							onClick={() => setTrafficLights(!trafficLights)}
							className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
								trafficLights ? "bg-accent" : "bg-surface-hover"
							}`}
						>
							<span
								aria-hidden="true"
								className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
									trafficLights ? "translate-x-5" : "translate-x-1"
								}`}
							/>
						</button>
					</div>
				</section>
			)}
		</div>
	);
}

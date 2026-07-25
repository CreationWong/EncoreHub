import { useCallback, useEffect, useRef, useState } from "react";
import {
	SIDEBAR_MAX_WIDTH,
	SIDEBAR_MIN_WIDTH,
	type SidebarMode,
	useSettingsStore,
} from "../../stores/settingsStore";
import CharacterList from "./CharacterList";
import ConversationList from "./ConversationList";

const TABS: { id: SidebarMode; label: string }[] = [
	{ id: "characters", label: "Characters" },
	{ id: "conversations", label: "Conversations" },
];

function ResizeHandle({ onResize }: { onResize: (width: number) => void }) {
	const [dragging, setDragging] = useState(false);

	useEffect(() => {
		if (!dragging) return;
		const onMove = (event: PointerEvent) => onResize(event.clientX);
		const onUp = () => setDragging(false);
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
		const previousCursor = document.body.style.cursor;
		const previousSelection = document.body.style.userSelect;
		document.body.style.cursor = "col-resize";
		document.body.style.userSelect = "none";
		return () => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			document.body.style.cursor = previousCursor;
			document.body.style.userSelect = previousSelection;
		};
	}, [dragging, onResize]);

	return (
		<button
			type="button"
			aria-label="Resize sidebar"
			onPointerDown={(event) => {
				event.preventDefault();
				setDragging(true);
			}}
			className={`absolute -right-1 top-0 z-20 h-full w-2 cursor-col-resize border-0 bg-transparent p-0 transition-colors hover:bg-accent/30 ${
				dragging ? "bg-accent/40" : ""
			}`}
		/>
	);
}

export default function Sidebar() {
	const sidebarOpen = useSettingsStore((state) => state.sidebarOpen);
	const focusMode = useSettingsStore((state) => state.focusMode);
	const sidebarWidth = useSettingsStore((state) => state.sidebarWidth);
	const setSidebarWidth = useSettingsStore((state) => state.setSidebarWidth);
	const sidebarMode = useSettingsStore((state) => state.sidebarMode);
	const setSidebarMode = useSettingsStore((state) => state.setSidebarMode);
	const asideRef = useRef<HTMLElement>(null);
	const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

	const handleResize = useCallback(
		(clientX: number) => {
			const left = asideRef.current?.getBoundingClientRect().left ?? 0;
			setSidebarWidth(clientX - left);
		},
		[setSidebarWidth],
	);

	if (!sidebarOpen || focusMode) return null;

	return (
		<aside
			ref={asideRef}
			aria-label="Characters and conversations"
			style={{
				width: sidebarWidth,
				minWidth: SIDEBAR_MIN_WIDTH,
				maxWidth: SIDEBAR_MAX_WIDTH,
			}}
			className="relative flex shrink-0 flex-col overflow-hidden bg-app-canvas"
		>
			<div
				role="tablist"
				aria-label="Sidebar mode"
				className="flex h-16 shrink-0 border-b border-border"
			>
				{TABS.map((tab, index) => {
					const active = sidebarMode === tab.id;
					return (
						<button
							key={tab.id}
							ref={(element) => {
								tabRefs.current[index] = element;
							}}
							type="button"
							role="tab"
							id={`sidebar-tab-${tab.id}`}
							aria-selected={active}
							aria-controls={`sidebar-panel-${tab.id}`}
							tabIndex={active ? 0 : -1}
							onClick={() => setSidebarMode(tab.id)}
							onKeyDown={(event) => {
								if (
									event.key !== "ArrowLeft" &&
									event.key !== "ArrowRight" &&
									event.key !== "Home" &&
									event.key !== "End"
								)
									return;
								event.preventDefault();
								const nextIndex =
									event.key === "Home"
										? 0
										: event.key === "End"
											? TABS.length - 1
											: (index +
													(event.key === "ArrowRight" ? 1 : -1) +
													TABS.length) %
												TABS.length;
								setSidebarMode(TABS[nextIndex].id);
								tabRefs.current[nextIndex]?.focus();
							}}
							className={`relative flex-1 text-sm font-medium transition-colors ${
								active
									? "text-text-primary"
									: "text-text-muted hover:text-text-secondary"
							}`}
						>
							{tab.label}
							{active && (
								<span className="absolute bottom-0 left-4 right-4 h-0.5 rounded-t bg-accent" />
							)}
						</button>
					);
				})}
			</div>

			<div
				role="tabpanel"
				id={`sidebar-panel-${sidebarMode}`}
				aria-labelledby={`sidebar-tab-${sidebarMode}`}
				className="min-h-0 flex-1"
			>
				{sidebarMode === "characters" ? (
					<CharacterList />
				) : (
					<ConversationList />
				)}
			</div>
			<ResizeHandle onResize={handleResize} />
		</aside>
	);
}

import {
	type CSSProperties,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { useMediaQuery } from "../../hooks/useMediaQuery";
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

const SIDEBAR_KEYBOARD_STEP = 8;

function ResizeHandle({
	width,
	onPointerResize,
	onResize,
}: {
	width: number;
	onPointerResize: (clientX: number) => void;
	onResize: (width: number) => void;
}) {
	const [dragging, setDragging] = useState(false);

	useEffect(() => {
		if (!dragging) return;
		const onMove = (event: PointerEvent) => onPointerResize(event.clientX);
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
	}, [dragging, onPointerResize]);

	return (
		<hr
			aria-label="Resize sidebar"
			aria-orientation="vertical"
			aria-valuemin={SIDEBAR_MIN_WIDTH}
			aria-valuemax={SIDEBAR_MAX_WIDTH}
			aria-valuenow={Math.round(width)}
			aria-valuetext={`${Math.round(width)} pixels`}
			tabIndex={0}
			onPointerDown={(event) => {
				if (event.button > 0) return;
				event.preventDefault();
				setDragging(true);
			}}
			onKeyDown={(event) => {
				let nextWidth: number | null = null;
				if (event.key === "ArrowLeft") {
					nextWidth = width - SIDEBAR_KEYBOARD_STEP;
				} else if (event.key === "ArrowRight") {
					nextWidth = width + SIDEBAR_KEYBOARD_STEP;
				} else if (event.key === "Home") {
					nextWidth = SIDEBAR_MIN_WIDTH;
				} else if (event.key === "End") {
					nextWidth = SIDEBAR_MAX_WIDTH;
				}
				if (nextWidth === null) return;
				event.preventDefault();
				onResize(nextWidth);
			}}
			className={`absolute -right-1 top-0 z-20 m-0 h-full w-2 cursor-col-resize border-0 bg-transparent p-0 focus:outline-none focus-visible:shadow-none after:pointer-events-none after:absolute after:left-1/2 after:top-1/2 after:h-8 after:w-px after:-translate-x-1/2 after:-translate-y-1/2 after:bg-text-muted/60 after:transition-colors after:transition-opacity focus-visible:after:bg-accent ${
				dragging
					? "after:opacity-100"
					: "after:opacity-0 hover:after:opacity-100 focus-visible:after:opacity-100"
			}`}
		/>
	);
}

export default function Sidebar() {
	const sidebarOpen = useSettingsStore((state) => state.sidebarOpen);
	const sidebarWidth = useSettingsStore((state) => state.sidebarWidth);
	const setSidebarWidth = useSettingsStore((state) => state.setSidebarWidth);
	const sidebarMode = useSettingsStore((state) => state.sidebarMode);
	const setSidebarMode = useSettingsStore((state) => state.setSidebarMode);
	const toggleSidebar = useSettingsStore((state) => state.toggleSidebar);
	const asideRef = useRef<HTMLElement>(null);
	const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
	const returnFocusRef = useRef<HTMLElement | null>(null);
	const drawer = useMediaQuery("(max-width: 899px)");
	const constrained = useMediaQuery("(max-width: 1199px)");
	const layout = drawer ? "drawer" : constrained ? "compact" : "desktop";

	const handleResize = useCallback(
		(clientX: number) => {
			const left = asideRef.current?.getBoundingClientRect().left ?? 0;
			setSidebarWidth(clientX - left);
		},
		[setSidebarWidth],
	);

	useEffect(() => {
		if (!sidebarOpen || !drawer) return;
		returnFocusRef.current =
			document.activeElement instanceof HTMLElement
				? document.activeElement
				: null;
		const previousBodyOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		document.documentElement.classList.add("sidebar-drawer-open");
		const focusFrame = requestAnimationFrame(() => {
			const selectedTab = asideRef.current?.querySelector<HTMLElement>(
				'[role="tab"][aria-selected="true"]',
			);
			selectedTab?.focus();
		});

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				toggleSidebar();
				return;
			}
			if (event.key !== "Tab") return;
			const focusable = Array.from(
				asideRef.current?.querySelectorAll<HTMLElement>(
					'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
				) ?? [],
			);
			if (focusable.length === 0) return;
			const first = focusable[0];
			const last = focusable[focusable.length - 1];
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first.focus();
			}
		};
		window.addEventListener("keydown", handleKeyDown);

		return () => {
			cancelAnimationFrame(focusFrame);
			window.removeEventListener("keydown", handleKeyDown);
			document.body.style.overflow = previousBodyOverflow;
			document.documentElement.classList.remove("sidebar-drawer-open");
			const target = returnFocusRef.current;
			if (target?.isConnected) target.focus();
			returnFocusRef.current = null;
		};
	}, [drawer, sidebarOpen, toggleSidebar]);

	if (!sidebarOpen) return null;
	const sidebarStyle = {
		"--sidebar-width": `${sidebarWidth}px`,
		minWidth: drawer ? undefined : SIDEBAR_MIN_WIDTH,
		maxWidth: drawer ? undefined : SIDEBAR_MAX_WIDTH,
	} as CSSProperties;

	return (
		<>
			{drawer && (
				<button
					type="button"
					onClick={toggleSidebar}
					aria-label="Close sidebar drawer"
					tabIndex={-1}
					className="absolute inset-0 z-30 bg-black/45"
				/>
			)}
			<aside
				ref={asideRef}
				aria-label="Characters and conversations"
				role={drawer ? "dialog" : undefined}
				aria-modal={drawer ? true : undefined}
				data-sidebar-layout={layout}
				style={sidebarStyle}
				className={`app-sidebar flex flex-col overflow-hidden border-r border-border bg-app-canvas ${
					drawer
						? "absolute inset-y-0 left-0 z-40 shadow-2xl"
						: "relative shrink-0"
				}`}
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
								className={`relative flex-1 text-sm font-medium transition-colors focus-visible:bg-control focus-visible:outline-none focus-visible:shadow-none ${
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
				{!constrained && (
					<ResizeHandle
						width={sidebarWidth}
						onPointerResize={handleResize}
						onResize={setSidebarWidth}
					/>
				)}
			</aside>
		</>
	);
}

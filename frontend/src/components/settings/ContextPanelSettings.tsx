// Context panel display settings.
//
// Lets the user preview the occupancy meter, choose which figure is primary,
// and reorder or hide the supporting lines. Pointer dragging is used instead of
// HTML5 drag-and-drop because desktop WebViews often omit drag events.

import { ChevronDown, ChevronUp, GripVertical } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useT } from "../../i18n";
import {
	type ContextMeterMetricId,
	useSettingsStore,
} from "../../stores/settingsStore";
import ContextMeter from "../chat/ContextMeter";
import {
	CONTEXT_METER_METRIC_DEFINITIONS,
	CONTEXT_METER_PREVIEW_VALUES,
} from "../chat/contextMeterDisplay";

/** Resolve the metric row under the pointer so WebViews can reorder without HTML drag events. */
function metricIdAtPoint(x: number, y: number): ContextMeterMetricId | null {
	const element = document.elementFromPoint(x, y);
	const row = element?.closest<HTMLElement>("[data-context-meter-metric-id]");
	const id = row?.dataset.contextMeterMetricId;
	return id === "percentage" ||
		id === "remaining" ||
		id === "usedOfLimit" ||
		id === "used"
		? id
		: null;
}

/**
 * Settings page for the conversation context occupancy meter.
 */
export default function ContextPanelSettings() {
	const t = useT();
	const primary = useSettingsStore((state) => state.contextMeterPrimary);
	const metrics = useSettingsStore((state) => state.contextMeterMetrics);
	const setPrimary = useSettingsStore((state) => state.setContextMeterPrimary);
	const setVisible = useSettingsStore(
		(state) => state.setContextMeterMetricVisible,
	);
	const moveMetric = useSettingsStore((state) => state.moveContextMeterMetric);
	const reset = useSettingsStore((state) => state.resetContextMeterDisplay);
	const [draggedId, setDraggedId] = useState<ContextMeterMetricId | null>(null);
	const [targetId, setTargetId] = useState<ContextMeterMetricId | null>(null);
	const lastTargetRef = useRef<ContextMeterMetricId | null>(null);

	useEffect(() => {
		if (!draggedId) return;
		// Disable text selection for the gesture; HTML5 drag events are missing
		// in the desktop WebView, so pointer hit-testing drives the reorder.
		const previousUserSelect = document.body.style.userSelect;
		document.body.style.userSelect = "none";
		const move = (event: PointerEvent) => {
			const nextTarget = metricIdAtPoint(event.clientX, event.clientY);
			if (!nextTarget || nextTarget === draggedId) {
				lastTargetRef.current = null;
				setTargetId(null);
				return;
			}
			setTargetId(nextTarget);
			if (lastTargetRef.current === nextTarget) return;
			lastTargetRef.current = nextTarget;
			moveMetric(draggedId, nextTarget);
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
	}, [draggedId, moveMetric]);

	/** Keyboard-accessible reorder for users who are not dragging the handle. */
	const moveBy = (id: ContextMeterMetricId, offset: -1 | 1) => {
		const index = metrics.findIndex((item) => item.id === id);
		const target = metrics[index + offset];
		if (target) moveMetric(id, target.id);
	};

	// Primary stays checked in the list even while the user drags other rows,
	// because order and "which figure is large" are independent preferences.

	return (
		<div className="mx-auto max-w-3xl space-y-8">
			<section aria-labelledby="context-meter-preview-heading">
				<div className="mb-3">
					<h3
						id="context-meter-preview-heading"
						className="text-sm font-semibold text-text-primary"
					>
						{t("context.meter.preview")}
					</h3>
					<p className="mt-1 text-xs text-text-muted">
						{t("context.meter.previewHelp")}
					</p>
				</div>
				<div
					aria-label={t("context.meter.previewLabel")}
					className="rounded-md border border-border bg-surface-alt/40 p-4"
				>
					<ContextMeter
						{...CONTEXT_METER_PREVIEW_VALUES}
						primary={primary}
						metrics={metrics}
					/>
				</div>
			</section>

			<section aria-labelledby="context-meter-order-heading">
				<div className="mb-3 flex items-start justify-between gap-3">
					<div>
						<h3
							id="context-meter-order-heading"
							className="text-sm font-semibold text-text-primary"
						>
							{t("context.meter.order")}
						</h3>
						<p className="mt-1 text-xs text-text-muted">
							{t("context.meter.orderHelp")}
						</p>
					</div>
					<button
						type="button"
						onClick={reset}
						className="shrink-0 rounded-md px-2 py-1 text-xs text-text-secondary hover:bg-control hover:text-text-primary"
					>
						{t("common.reset")}
					</button>
				</div>
				<ul
					aria-label={t("context.meter.metrics")}
					className="list-none divide-y divide-border border-y border-border p-0"
				>
					{metrics.map((item, index) => {
						const definition = CONTEXT_METER_METRIC_DEFINITIONS[item.id];
						const label = t(definition.labelKey);
						const isPrimary = primary === item.id;
						return (
							<li
								key={item.id}
								aria-label={label}
								data-context-meter-metric-id={item.id}
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
									aria-label={t("context.meter.dragMetric", { name: label })}
									title={t("common.dragToReorder")}
									className="flex h-7 w-7 touch-none items-center justify-center rounded text-text-muted hover:bg-control hover:text-text-primary active:cursor-grabbing"
								>
									<GripVertical className="h-4 w-4 cursor-grab" />
								</button>
								<span className="min-w-0 flex-1">
									<span className="block truncate text-sm text-text-primary">
										{label}
									</span>
									<span className="mt-0.5 block text-xs text-text-muted">
										{t(definition.detailKey)}
									</span>
								</span>
								<label className="flex shrink-0 items-center gap-1.5 text-xs text-text-secondary">
									<input
										autoComplete="off"
										type="radio"
										name="context-meter-primary"
										checked={isPrimary}
										onChange={() => setPrimary(item.id)}
										aria-label={t("context.meter.useMain", { name: label })}
										className="h-4 w-4 accent-accent"
									/>
									{t("context.meter.main")}
								</label>
								<label className="flex shrink-0 items-center">
									<input
										autoComplete="off"
										type="checkbox"
										checked={item.visible}
										// Hiding the main figure would immediately promote another
										// row and make the preview jump while the list is still open.
										disabled={isPrimary}
										onChange={(event) =>
											setVisible(item.id, event.target.checked)
										}
										aria-label={t("context.meter.showMetric", { name: label })}
										className="h-4 w-4 accent-accent"
									/>
								</label>
								<button
									type="button"
									disabled={index === 0}
									onClick={() => moveBy(item.id, -1)}
									aria-label={`${t("common.moveUp")}: ${label}`}
									title={t("common.moveUp")}
									className="flex h-7 w-7 items-center justify-center rounded text-text-muted hover:bg-control hover:text-text-primary disabled:opacity-30"
								>
									<ChevronUp className="h-3.5 w-3.5" />
								</button>
								<button
									type="button"
									disabled={index === metrics.length - 1}
									onClick={() => moveBy(item.id, 1)}
									aria-label={`${t("common.moveDown")}: ${label}`}
									title={t("common.moveDown")}
									className="flex h-7 w-7 items-center justify-center rounded text-text-muted hover:bg-control hover:text-text-primary disabled:opacity-30"
								>
									<ChevronDown className="h-3.5 w-3.5" />
								</button>
							</li>
						);
					})}
				</ul>
			</section>
		</div>
	);
}

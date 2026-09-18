// Context occupancy meter.
//
// Always paints fill against the model window so promoting "tokens remaining"
// (or another secondary figure) does not hide how close the next request is to
// the limit. Headline and supporting lines come from the shared display
// helper so Settings can preview the same arrangement the conversation panel
// will show.

import { Gauge } from "lucide-react";
import { t } from "../../i18n";
import type {
	ContextMeterMetricId,
	ContextMeterMetricPreference,
} from "../../stores/settingsStore";
import {
	type ContextMeterValues,
	resolveContextMeterDisplay,
} from "./contextMeterDisplay";

/** Occupancy numbers plus the saved primary metric and supporting-line order. */
interface ContextMeterProps extends ContextMeterValues {
	primary: ContextMeterMetricId;
	metrics: readonly ContextMeterMetricPreference[];
}

/**
 * Render occupancy as one primary figure, ordered secondary lines, and a bar.
 */
export default function ContextMeter({
	used,
	limit,
	percentage,
	remaining,
	primary,
	metrics,
}: ContextMeterProps) {
	const values = { used, limit, percentage, remaining };
	// Settings and the conversation panel pass the same preference snapshot so
	// a preview cannot drift from the live meter.
	const display = resolveContextMeterDisplay(values, primary, metrics);
	const safePercentage = percentage ?? 0;
	// Fill color tracks window occupancy even when the headline is remaining
	// tokens, so a promoted secondary figure cannot hide a nearly-full window.
	const tone =
		safePercentage >= 90
			? "bg-danger"
			: safePercentage >= 75
				? "bg-warning"
				: "bg-accent";

	return (
		<div className="space-y-2">
			<div className="flex items-end justify-between gap-3">
				<div className="min-w-0">
					<p
						className="text-2xl font-semibold tabular-nums text-text-primary"
						title={display.primary.title}
					>
						{display.primary.text}
					</p>
					{display.secondary.map((line) => (
						<p
							key={line.id}
							className="mt-0.5 text-[11px] text-text-muted"
							title={line.title}
						>
							{line.text}
						</p>
					))}
					{/* Secondary lines keep saved order and omit the primary so it is not repeated. */}
				</div>
				<Gauge className="h-5 w-5 shrink-0 text-text-muted" />
			</div>
			<div
				role="progressbar"
				tabIndex={0}
				aria-label={t("context.usage")}
				aria-valuemin={0}
				// Assistive values stay in tokens so a 0.4% window still reports
				// the four occupied tokens instead of rounding the bar to zero.
				aria-valuemax={limit ?? undefined}
				aria-valuenow={limit ? Math.min(used, limit) : undefined}
				className="h-2 overflow-hidden rounded-full bg-control"
			>
				<div
					className={`h-full rounded-full transition-[width] ${tone}`}
					style={{
						// A live but sub-percent window still paints a sliver; an
						// unknown window stays empty rather than implying 100% full.
						width: `${percentage == null ? 0 : Math.max(1, safePercentage)}%`,
					}}
				/>
			</div>
		</div>
	);
}

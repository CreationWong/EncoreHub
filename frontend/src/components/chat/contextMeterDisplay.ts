// Context meter display helpers.
//
// The conversation panel and Settings share one occupancy model: one primary
// figure plus ordered secondary lines. Percentage of the model window is the
// default primary because that is the glanceable "how full is this chat"
// answer; remaining and absolute token counts follow typical follow-up
// questions. Window-dependent metrics return null when the limit is unknown so
// callers can fall back to a raw used-token count.

import type {
	ContextMeterMetricId,
	ContextMeterMetricPreference,
} from "../../stores/settingsStore";

/** Token occupancy the meter can render without extra store access. */
export interface ContextMeterValues {
	used: number;
	limit: number | null;
	percentage: number | null;
	remaining: number | null;
}

/** One formatted meter line, with an optional absolute-count tooltip. */
export interface ContextMeterLine {
	id: ContextMeterMetricId;
	text: string;
	title?: string;
}

/** Copy shown in Settings when choosing order and the primary metric. */
export const CONTEXT_METER_METRIC_DEFINITIONS: Record<
	ContextMeterMetricId,
	{ label: string; detail: string }
> = {
	percentage: {
		label: "Window used",
		detail: "Share of the model context window the next request occupies.",
	},
	remaining: {
		label: "Tokens remaining",
		detail: "Space left before the conversation fills the window.",
	},
	usedOfLimit: {
		label: "Used of window",
		detail: "Tokens already occupied versus the context limit.",
	},
	used: {
		label: "Tokens used",
		detail: "Absolute tokens included in the next request.",
	},
};

/** Sample occupancy for the Settings preview; round numbers keep the demo stable. */
export const CONTEXT_METER_PREVIEW_VALUES: ContextMeterValues = {
	used: 4000,
	limit: 100_000,
	percentage: 4,
	remaining: 96_000,
};

/**
 * Format a token count with grouping separators and no fraction digits.
 */
export function formatTokens(value: number): string {
	return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(
		value,
	);
}

/**
 * Format window occupancy so a tiny non-zero share cannot render as "0%".
 */
export function formatContextPercentage(value: number): string {
	if (value === 0) return "0%";
	if (value < 0.01) return "<0.01%";
	if (value < 1) {
		return `${new Intl.NumberFormat("en-US", {
			maximumFractionDigits: 2,
		}).format(value)}%`;
	}
	return `${Math.round(value)}%`;
}

/**
 * Window-relative metrics need a known limit; "used" is always available.
 */
export function contextMeterMetricAvailable(
	id: ContextMeterMetricId,
	values: ContextMeterValues,
): boolean {
	if (id === "used") return true;
	return (
		values.limit != null &&
		values.percentage != null &&
		values.remaining != null
	);
}

/**
 * Format one metric as the large primary figure or a quieter secondary line.
 *
 * Returns null when that metric cannot be computed (usually a missing window).
 */
export function formatContextMeterLine(
	id: ContextMeterMetricId,
	values: ContextMeterValues,
	variant: "primary" | "secondary",
): ContextMeterLine | null {
	if (!contextMeterMetricAvailable(id, values)) return null;

	const usedOfLimitTitle =
		values.limit != null
			? `${formatTokens(values.used)} of ${formatTokens(values.limit)} tokens used`
			: undefined;

	switch (id) {
		case "percentage":
			return {
				id,
				text:
					variant === "primary"
						? formatContextPercentage(values.percentage ?? 0)
						: `${formatContextPercentage(values.percentage ?? 0)} of window`,
				title: usedOfLimitTitle,
			};
		case "remaining":
			return {
				id,
				text:
					variant === "primary"
						? `${formatTokens(values.remaining ?? 0)} remaining`
						: `${formatTokens(values.remaining ?? 0)} tokens remaining`,
				title: usedOfLimitTitle,
			};
		case "usedOfLimit":
			return {
				id,
				text:
					variant === "primary"
						? `${formatTokens(values.used)} of ${formatTokens(values.limit ?? 0)}`
						: `${formatTokens(values.used)} of ${formatTokens(values.limit ?? 0)} tokens`,
			};
		case "used":
			// Without a window the raw count is the only honest headline; the
			// secondary phrasing makes it clear the number is an estimate.
			return {
				id,
				text:
					variant === "primary"
						? values.limit == null
							? formatTokens(values.used)
							: `${formatTokens(values.used)} used`
						: values.limit == null
							? `${formatTokens(values.used)} estimated tokens`
							: `${formatTokens(values.used)} tokens used`,
			};
	}
}

/**
 * Pick the large figure, then list remaining visible metrics in saved order.
 *
 * A preferred primary that cannot be shown (hidden, or no context window)
 * falls through to the next visible available metric, then to raw used tokens
 * so the meter never renders an empty headline.
 */
export function resolveContextMeterDisplay(
	values: ContextMeterValues,
	primaryId: ContextMeterMetricId,
	metrics: readonly ContextMeterMetricPreference[],
): { primary: ContextMeterLine; secondary: ContextMeterLine[] } {
	const resolvedPrimary = resolveContextMeterPrimary(
		values,
		primaryId,
		metrics,
	);
	const primary =
		formatContextMeterLine(resolvedPrimary, values, "primary") ??
		formatContextMeterLine("used", values, "primary");
	if (!primary) {
		return {
			primary: { id: "used", text: formatTokens(values.used) },
			secondary: [],
		};
	}

	const secondary: ContextMeterLine[] = [];
	for (const metric of metrics) {
		if (!metric.visible || metric.id === resolvedPrimary) continue;
		const line = formatContextMeterLine(metric.id, values, "secondary");
		if (line) secondary.push(line);
	}
	return { primary, secondary };
}

/**
 * Resolve which metric actually occupies the large figure.
 */
export function resolveContextMeterPrimary(
	values: ContextMeterValues,
	primaryId: ContextMeterMetricId,
	metrics: readonly ContextMeterMetricPreference[],
): ContextMeterMetricId {
	if (contextMeterMetricAvailable(primaryId, values)) {
		return primaryId;
	}
	for (const metric of metrics) {
		if (metric.visible && contextMeterMetricAvailable(metric.id, values)) {
			return metric.id;
		}
	}
	return "used";
}

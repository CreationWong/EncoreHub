// Usage analytics: Engine-aggregated tokens, latency, and estimated spend.

import {
	BadgeCheck,
	CalendarDays,
	ChartNoAxesColumn,
	ChartPie,
	CircleDollarSign,
	Clock3,
	Download,
	Filter,
	Layers3,
	ListFilter,
	RefreshCw,
	TrendingUp,
	Zap,
} from "lucide-react";
import type { ComponentType } from "react";
import { useEffect, useMemo, useState } from "react";
import {
	type MessageKey,
	intlLocale,
	useActiveLocaleId,
	useT,
} from "../../i18n";
import {
	type UsageBreakdownItem,
	type UsageRange,
	type UsageTrendBucket,
	emptyUsageReport,
	getUsageReport,
} from "../../services/usage";

type UsageTab = "requests" | "providers" | "models";
type ShareChart = "bar" | "pie";
type Translate = (
	key: MessageKey,
	vars?: Record<string, string | number>,
) => string;

/** Period picker; labels resolve at render time so locale switches update. */
const RANGE_OPTIONS: { value: UsageRange; labelKey: MessageKey }[] = [
	{ value: "15m", labelKey: "usage.range15m" },
	{ value: "30m", labelKey: "usage.range30m" },
	{ value: "1h", labelKey: "usage.range1h" },
	{ value: "3h", labelKey: "usage.range3h" },
	{ value: "day", labelKey: "usage.day" },
	{ value: "week", labelKey: "usage.week" },
	{ value: "3w", labelKey: "usage.range3w" },
	{ value: "month", labelKey: "usage.month" },
	{ value: "quarter", labelKey: "usage.quarter" },
	{ value: "year", labelKey: "usage.year" },
	{ value: "custom", labelKey: "usage.custom" },
	{ value: "all", labelKey: "usage.allTime" },
];

const PIE_COLORS = [
	"var(--color-accent)",
	"var(--color-success)",
	"var(--color-warning)",
	"var(--color-info)",
	"var(--color-danger)",
];

function formatNumber(value: number, locale: string): string {
	return new Intl.NumberFormat(locale).format(Math.round(value));
}

function formatCompactNumber(value: number, locale: string): string {
	return new Intl.NumberFormat(locale, {
		notation: "compact",
		maximumFractionDigits: 1,
	}).format(value);
}

function formatTrendDate(value: string, locale: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return new Intl.DateTimeFormat(locale, {
		month: "short",
		day: "2-digit",
		year: "numeric",
	}).format(date);
}

function getNiceScaleMaximum(value: number): number {
	if (value <= 0) return 1;
	const magnitude = 10 ** Math.floor(Math.log10(value));
	const normalized = value / magnitude;
	const step = [1, 2, 2.5, 5, 10].find((candidate) => candidate >= normalized);
	return (step ?? 10) * magnitude;
}

function formatCost(
	value: number | null,
	currency: string,
	translate: Translate,
	locale: string,
): string {
	if (value == null) return translate("usage.unpriced");
	if (currency === "MIXED") return translate("usage.mixedCurrencies");
	try {
		return new Intl.NumberFormat(locale, {
			style: "currency",
			currency,
			minimumFractionDigits: 4,
			maximumFractionDigits: 4,
		}).format(value);
	} catch {
		return `${currency} ${value.toFixed(4)}`;
	}
}

function formatDate(value: string, locale: string): string {
	return new Intl.DateTimeFormat(locale, {
		month: "short",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	}).format(new Date(value));
}

function formatShare(value: number): string {
	const digits = value > 0 && value < 10 ? 1 : 0;
	return `${value.toFixed(digits)}%`;
}

function toDatetimeLocalValue(date: Date): string {
	const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
	return local.toISOString().slice(0, 16);
}

function localValueToIso(value: string): string | undefined {
	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp)
		? new Date(timestamp).toISOString()
		: undefined;
}

/** Engine-backed usage report with filters, charts, and request log. */
export default function UsagePanel() {
	const translate = useT();
	const locale = intlLocale(useActiveLocaleId());
	const [tab, setTab] = useState<UsageTab>("requests");
	const [range, setRange] = useState<UsageRange>("day");
	const [provider, setProvider] = useState("all");
	const [model, setModel] = useState("all");
	const [currency, setCurrency] = useState("USD");
	const [shareChart, setShareChart] = useState<ShareChart>("bar");
	const [customFrom, setCustomFrom] = useState(() =>
		toDatetimeLocalValue(new Date(Date.now() - 24 * 60 * 60 * 1000)),
	);
	const [customTo, setCustomTo] = useState(() =>
		toDatetimeLocalValue(new Date()),
	);
	const [report, setReport] = useState(emptyUsageReport);
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState(false);
	const [refreshKey, setRefreshKey] = useState(0);

	useEffect(() => {
		void refreshKey;
		const controller = new AbortController();
		const load = async () => {
			setLoading(true);
			setLoadError(false);
			try {
				const next = await getUsageReport(
					{
						range,
						provider,
						model,
						currency,
						from: range === "custom" ? localValueToIso(customFrom) : undefined,
						to: range === "custom" ? localValueToIso(customTo) : undefined,
					},
					controller.signal,
				);
				if (!controller.signal.aborted) setReport(next);
			} catch (error) {
				if (
					!controller.signal.aborted &&
					!(error instanceof DOMException && error.name === "AbortError")
				) {
					setLoadError(true);
					setReport(emptyUsageReport());
				}
			} finally {
				if (!controller.signal.aborted) setLoading(false);
			}
		};
		void load();
		return () => controller.abort();
	}, [currency, customFrom, customTo, model, provider, range, refreshKey]);

	const providerOptions = useMemo(
		() =>
			provider === "all" || report.providers.includes(provider)
				? report.providers
				: [...report.providers, provider].sort(),
		[provider, report.providers],
	);
	const modelOptions = useMemo(
		() =>
			model === "all" || report.models.includes(model)
				? report.models
				: [...report.models, model].sort(),
		[model, report.models],
	);
	const breakdown =
		tab === "models" ? report.modelBreakdown : report.providerBreakdown;
	const totalTokens = report.totals.input + report.totals.output;

	const exportUsage = () => {
		const blob = new Blob([JSON.stringify(report.records, null, 2)], {
			type: "application/json",
		});
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = "encorehub-usage.json";
		anchor.click();
		URL.revokeObjectURL(url);
	};

	return (
		<div className="h-full min-h-0 overflow-y-auto bg-workspace">
			<div className="border-b border-border bg-workspace px-6 py-5">
				<div className="flex flex-wrap items-start justify-between gap-4">
					<div className="flex items-center gap-2">
						<div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/10 text-accent">
							<ChartNoAxesColumn className="h-5 w-5" />
						</div>
						<div>
							<h3 className="text-lg font-semibold text-text-primary">
								{translate("usage.details")}
							</h3>
							<p className="text-xs text-text-muted">
								{translate("usage.detailsHelp")}
							</p>
						</div>
					</div>
					<div className="flex items-center gap-2">
						<button
							type="button"
							title={translate("usage.refresh")}
							aria-label={translate("usage.refresh")}
							onClick={() => setRefreshKey((value) => value + 1)}
							className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-text-muted hover:bg-surface-hover hover:text-text-primary"
						>
							<RefreshCw
								className={loading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"}
							/>
						</button>
						<button
							type="button"
							title={translate("usage.export")}
							aria-label={translate("usage.export")}
							onClick={exportUsage}
							disabled={report.records.length === 0}
							className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-text-muted enabled:hover:bg-surface-hover enabled:hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
						>
							<Download className="h-3.5 w-3.5" />
						</button>
					</div>
				</div>
				<div
					className="mt-5 grid gap-3"
					style={{
						gridTemplateColumns:
							"repeat(auto-fit, minmax(min(100%, 180px), 1fr))",
					}}
				>
					<Metric
						icon={Zap}
						label={translate("usage.totalTokens")}
						value={formatNumber(totalTokens, locale)}
						detail={translate("usage.inOut", {
							input: formatNumber(report.totals.input, locale),
							output: formatNumber(report.totals.output, locale),
						})}
					/>
					<Metric
						icon={CircleDollarSign}
						label={translate("usage.estimatedCost")}
						value={
							report.totals.priced
								? formatCost(
										report.totals.cost,
										report.totals.currency,
										translate,
										locale,
									)
								: translate("usage.unpriced")
						}
						detail={translate("usage.pricedRequests", {
							count: report.totals.priced,
							currency: report.totals.currency,
						})}
						tone="green"
					/>
					<Metric
						icon={ListFilter}
						label={translate("usage.requests")}
						value={formatNumber(report.totals.requests, locale)}
						detail={translate("usage.recordedCalls")}
					/>
					<Metric
						icon={Clock3}
						label={translate("usage.providerTime")}
						value={translate("usage.durationSeconds", {
							value: (report.totals.durationMs / 1000).toFixed(1),
						})}
						detail={translate("usage.streamDuration")}
					/>
					<Metric
						icon={BadgeCheck}
						label={translate("usage.cacheHits")}
						value={formatNumber(report.totals.cacheRead, locale)}
						detail={translate("usage.ofInput", {
							value: formatShare(
								report.totals.input > 0
									? (report.totals.cacheRead / report.totals.input) * 100
									: 0,
							),
						})}
						tone="info"
					/>
					<Metric
						icon={Layers3}
						label={translate("usage.cacheCreated")}
						value={formatNumber(report.totals.cacheCreation, locale)}
						detail={translate("usage.promptWritten")}
						tone="warning"
					/>
				</div>
			</div>

			<div className="px-6 py-5">
				<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
					<div className="flex items-center gap-1 rounded-lg border border-border bg-surface-alt p-1">
						{(
							[
								["requests", "usage.requestLogTab", ListFilter],
								["providers", "usage.providerStats", TrendingUp],
								["models", "usage.modelStats", ChartNoAxesColumn],
							] as const
						).map(([value, labelKey, Icon]) => (
							<button
								key={value}
								type="button"
								onClick={() => setTab(value)}
								aria-pressed={tab === value}
								className={
									tab === value
										? "flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors"
										: "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
								}
							>
								<Icon className="h-3.5 w-3.5" />
								{translate(labelKey)}
							</button>
						))}
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<Filter className="h-3.5 w-3.5 text-text-muted" />
						<select
							value={range}
							onChange={(event) => setRange(event.target.value as UsageRange)}
							aria-label={translate("usage.period")}
							className="h-8 rounded-md border border-border bg-surface px-2 text-xs text-text-primary"
						>
							{RANGE_OPTIONS.map((option) => (
								<option key={option.value} value={option.value}>
									{translate(option.labelKey)}
								</option>
							))}
						</select>
						{range === "custom" && (
							<>
								<input
									autoComplete="off"
									type="datetime-local"
									value={customFrom}
									max={customTo}
									onChange={(event) => setCustomFrom(event.target.value)}
									aria-label={translate("usage.customStart")}
									className="h-8 rounded-md border border-border bg-surface px-2 text-xs text-text-primary"
								/>
								<input
									autoComplete="off"
									type="datetime-local"
									value={customTo}
									min={customFrom}
									onChange={(event) => setCustomTo(event.target.value)}
									aria-label={translate("usage.customEnd")}
									className="h-8 rounded-md border border-border bg-surface px-2 text-xs text-text-primary"
								/>
							</>
						)}
						<select
							value={provider}
							onChange={(event) => setProvider(event.target.value)}
							aria-label={translate("usage.provider")}
							className="h-8 max-w-40 rounded-md border border-border bg-surface px-2 text-xs text-text-primary"
						>
							<option value="all">{translate("usage.allProviders")}</option>
							{providerOptions.map((item) => (
								<option key={item} value={item}>
									{item}
								</option>
							))}
						</select>
						<select
							value={model}
							onChange={(event) => setModel(event.target.value)}
							aria-label={translate("usage.model")}
							className="h-8 max-w-48 rounded-md border border-border bg-surface px-2 text-xs text-text-primary"
						>
							<option value="all">{translate("usage.allModels")}</option>
							{modelOptions.map((item) => (
								<option key={item} value={item}>
									{item}
								</option>
							))}
						</select>
						<select
							value={currency}
							onChange={(event) => setCurrency(event.target.value)}
							aria-label={translate("usage.currency")}
							className="h-8 w-28 rounded-md border border-border bg-surface px-2 text-xs text-text-primary"
							title={translate("usage.displayCurrency")}
						>
							{report.currencies.map((item) => (
								<option key={item} value={item}>
									{item}
								</option>
							))}
						</select>
						<span className="hidden items-center gap-1 text-[11px] text-text-muted md:flex">
							<CalendarDays className="h-3.5 w-3.5" />
							{translate("usage.recordsCount", {
								count: report.totals.requests,
							})}
						</span>
					</div>
				</div>

				<section
					aria-label={translate("usage.barChart")}
					className="mb-5 rounded-lg border border-border bg-surface p-5"
				>
					<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
						<div>
							<h4 className="text-sm font-semibold text-text-primary">
								{translate("usage.overTime")}
							</h4>
							<p className="mt-0.5 text-xs text-text-muted">
								{translate("usage.overTimeHelp")}
							</p>
						</div>
						<div className="flex items-center gap-4 text-[11px] text-text-muted">
							<span className="flex items-center gap-1.5">
								<span className="h-2.5 w-2.5 bg-accent" />
								{translate("usage.input")}
							</span>
							<span className="flex items-center gap-1.5">
								<span className="h-2.5 w-2.5 bg-success" />
								{translate("usage.output")}
							</span>
							<span className="tabular-nums">
								{translate("usage.tokensCount", {
									count: formatNumber(totalTokens, locale),
								})}
							</span>
						</div>
					</div>
					{loadError ? (
						<UsagePlaceholder message={translate("usage.unavailable")} />
					) : loading && report.totals.requests === 0 ? (
						<UsagePlaceholder message={translate("usage.loading")} />
					) : report.totals.requests === 0 ? (
						<EmptyUsage />
					) : (
						<UsageBarChart buckets={report.trend} />
					)}
				</section>

				{tab === "requests" ? (
					<RequestTable records={report.records} loading={loading} />
				) : (
					<BreakdownSection
						kind={tab === "providers" ? "providers" : "models"}
						items={breakdown}
						chart={shareChart}
						onChartChange={setShareChart}
					/>
				)}
			</div>
		</div>
	);
}

function UsageBarChart({ buckets }: { buckets: UsageTrendBucket[] }) {
	const translate = useT();
	const locale = intlLocale(useActiveLocaleId());
	const [selectedBucket, setSelectedBucket] = useState<string | null>(null);
	const maxTokens = Math.max(0, ...buckets.map((bucket) => bucket.tokens));
	const scaleMaximum = getNiceScaleMaximum(maxTokens);
	const ticks = Array.from(
		{ length: 5 },
		(_, index) => scaleMaximum - (scaleMaximum / 4) * index,
	);

	return (
		<div className="overflow-x-auto pb-1">
			<div className="min-w-[620px]">
				<div className="grid grid-cols-[42px_minmax(0,1fr)] gap-3">
					<div
						aria-hidden="true"
						className="flex h-48 flex-col justify-between pb-px text-right text-[10px] tabular-nums text-text-muted"
					>
						{ticks.map((tick) => (
							<span key={tick}>{formatCompactNumber(tick, locale)}</span>
						))}
					</div>

					<div className="relative h-48 border-b border-border">
						<div
							aria-hidden="true"
							className="pointer-events-none absolute inset-0 flex flex-col justify-between"
						>
							{ticks.map((tick) => (
								<span key={tick} className="border-t border-border/70" />
							))}
						</div>

						<div
							className="absolute inset-0 grid items-end gap-2 px-2"
							style={{
								gridTemplateColumns: `repeat(${buckets.length}, minmax(84px, 1fr))`,
							}}
						>
							{buckets.map((bucket, index) => {
								const height =
									bucket.tokens > 0
										? Math.max(3, (bucket.tokens / scaleMaximum) * 100)
										: 0;
								const inputShare =
									bucket.tokens > 0 ? (bucket.input / bucket.tokens) * 100 : 0;
								const detail = translate("usage.bucketDetail", {
									tokens: formatNumber(bucket.tokens, locale),
									input: formatNumber(bucket.input, locale),
									output: formatNumber(bucket.output, locale),
								});
								const dateLabel = formatTrendDate(bucket.startAt, locale);
								const isSelected = selectedBucket === bucket.startAt;
								const tooltipPlacement =
									index < buckets.length / 2 ? "right" : "left";
								const tooltipTop = Math.min(82, Math.max(18, 100 - height));

								return (
									<button
										key={bucket.startAt}
										type="button"
										aria-pressed={isSelected}
										aria-label={translate("usage.bucketAria", {
											date: dateLabel,
											label: bucket.label,
											detail,
										})}
										title={detail}
										onClick={() =>
											setSelectedBucket(isSelected ? null : bucket.startAt)
										}
										className="group relative flex h-full min-w-0 items-end justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
									>
										{bucket.tokens > 0 && buckets.length <= 12 && (
											<span
												aria-hidden="true"
												className="pointer-events-none absolute -translate-y-1.5 text-[9px] tabular-nums text-text-muted"
												style={{ bottom: `${height}%` }}
											>
												{formatCompactNumber(bucket.tokens, locale)}
											</span>
										)}
										<span
											data-placement={tooltipPlacement}
											className={`${isSelected ? "block" : "hidden"} ${tooltipPlacement === "right" ? "left-[calc(50%+1.5rem)]" : "right-[calc(50%+1.5rem)]"} pointer-events-none absolute z-20 -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-surface px-2.5 py-2 text-left text-[10px] leading-4 text-text-secondary shadow-lg group-hover:block group-focus-visible:block`}
											style={{ top: `${tooltipTop}%` }}
										>
											<strong className="block font-medium text-text-primary">
												{bucket.label}
											</strong>
											<span className="block text-text-muted">{dateLabel}</span>
											{translate("usage.inputOutputShort", {
												input: formatNumber(bucket.input, locale),
												output: formatNumber(bucket.output, locale),
											})}
										</span>

										{bucket.tokens > 0 && (
											<span
												aria-hidden="true"
												className="flex w-3/5 min-w-3 max-w-12 flex-col-reverse overflow-hidden rounded-t-[3px] shadow-[0_0_0_1px_rgb(0_0_0/0.04)] transition-[filter,opacity] duration-150 group-hover:brightness-110 group-focus-visible:brightness-110"
												style={{ height: `${height}%` }}
											>
												<span
													className="bg-accent"
													style={{ height: `${inputShare}%` }}
												/>
												<span
													className="bg-success"
													style={{ height: `${100 - inputShare}%` }}
												/>
											</span>
										)}
									</button>
								);
							})}
						</div>
					</div>
				</div>

				<div
					className="ml-[54px] grid gap-2 px-2 pt-2"
					style={{
						gridTemplateColumns: `repeat(${buckets.length}, minmax(84px, 1fr))`,
					}}
				>
					{buckets.map((bucket) => {
						const dateLabel = formatTrendDate(bucket.startAt, locale);
						return (
							<span
								key={bucket.startAt}
								className="min-w-0 text-center tabular-nums"
								title={translate("usage.bucketTitle", {
									date: dateLabel,
									label: bucket.label,
								})}
							>
								<span className="block text-[10px] text-text-secondary">
									{bucket.label}
								</span>
								<span className="mt-0.5 block whitespace-nowrap text-[9px] text-text-muted">
									{dateLabel}
								</span>
							</span>
						);
					})}
				</div>
			</div>
		</div>
	);
}

function RequestTable({
	records,
	loading,
}: {
	records: Awaited<ReturnType<typeof getUsageReport>>["records"];
	loading: boolean;
}) {
	const translate = useT();
	const locale = intlLocale(useActiveLocaleId());
	return (
		<section
			aria-label={translate("usage.requestLog")}
			className="overflow-hidden rounded-lg border border-border bg-surface"
		>
			<div className="overflow-x-auto">
				<table className="w-full min-w-[760px] text-left text-xs">
					<thead className="bg-surface-alt text-text-muted">
						<tr>
							<th className="px-4 py-3 font-medium">
								{translate("usage.time")}
							</th>
							<th className="px-4 py-3 font-medium">
								{translate("common.provider")}
							</th>
							<th className="px-4 py-3 font-medium">
								{translate("common.model")}
							</th>
							<th className="px-4 py-3 text-right font-medium">
								{translate("usage.input")}
							</th>
							<th className="px-4 py-3 text-right font-medium">
								{translate("usage.output")}
							</th>
							<th className="px-4 py-3 text-right font-medium">
								{translate("usage.cost")}
							</th>
							<th className="px-4 py-3 text-right font-medium">
								{translate("common.status")}
							</th>
						</tr>
					</thead>
					<tbody>
						{records.map((record) => (
							<tr
								key={record.id}
								className="border-t border-border hover:bg-surface-hover"
							>
								<td className="whitespace-nowrap px-4 py-3 text-text-muted">
									{formatDate(record.createdAt, locale)}
								</td>
								<td className="px-4 py-3 font-medium text-text-primary">
									{record.provider}
								</td>
								<td
									className="max-w-56 truncate px-4 py-3 text-text-secondary"
									title={record.model}
								>
									{record.model}
								</td>
								<td className="px-4 py-3 text-right tabular-nums text-text-primary">
									{formatNumber(record.inputTokens, locale)}
								</td>
								<td className="px-4 py-3 text-right tabular-nums text-text-primary">
									{formatNumber(record.outputTokens, locale)}
								</td>
								<td className="px-4 py-3 text-right tabular-nums font-medium text-text-primary">
									{formatCost(record.cost, record.currency, translate, locale)}
								</td>
								<td className="px-4 py-3 text-right">
									<span
										className={
											record.status === "completed"
												? "inline-flex rounded-full bg-success-bg px-2 py-0.5 text-[10px] text-success"
												: "inline-flex rounded-full bg-warning-bg px-2 py-0.5 text-[10px] text-warning"
										}
									>
										{record.status === "completed"
											? translate("common.completed")
											: translate("common.failed")}
									</span>
								</td>
							</tr>
						))}
					</tbody>
				</table>
				{records.length === 0 &&
					(loading ? (
						<UsagePlaceholder message={translate("usage.loading")} />
					) : (
						<EmptyUsage />
					))}
			</div>
		</section>
	);
}

function BreakdownSection({
	kind,
	items,
	chart,
	onChartChange,
}: {
	kind: "providers" | "models";
	items: UsageBreakdownItem[];
	chart: ShareChart;
	onChartChange: (chart: ShareChart) => void;
}) {
	const translate = useT();
	const kindLabel = translate(
		kind === "providers" ? "usage.kindProvider" : "usage.kindModel",
	);
	return (
		<section
			aria-label={translate("usage.shareChart")}
			className="rounded-lg border border-border bg-surface"
		>
			<div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
				<div>
					<h4 className="text-sm font-semibold text-text-primary">
						{translate("usage.kindShare", { kind: kindLabel })}
					</h4>
					<p className="mt-0.5 text-xs text-text-muted">
						{translate("usage.shareHelp")}
					</p>
				</div>
				<div className="flex items-center gap-1 rounded-md border border-border bg-surface-alt p-1">
					<button
						type="button"
						aria-label={translate("usage.barShare")}
						aria-pressed={chart === "bar"}
						onClick={() => onChartChange("bar")}
						className={
							chart === "bar"
								? "flex h-7 items-center gap-1.5 rounded-sm bg-surface px-2 text-[11px] font-medium text-text-primary shadow-sm"
								: "flex h-7 items-center gap-1.5 rounded-sm px-2 text-[11px] text-text-muted hover:text-text-primary"
						}
					>
						<ChartNoAxesColumn className="h-3.5 w-3.5" />
						{translate("usage.bars")}
					</button>
					<button
						type="button"
						aria-label={translate("usage.pieShare")}
						aria-pressed={chart === "pie"}
						onClick={() => onChartChange("pie")}
						className={
							chart === "pie"
								? "flex h-7 items-center gap-1.5 rounded-sm bg-surface px-2 text-[11px] font-medium text-text-primary shadow-sm"
								: "flex h-7 items-center gap-1.5 rounded-sm px-2 text-[11px] text-text-muted hover:text-text-primary"
						}
					>
						<ChartPie className="h-3.5 w-3.5" />
						{translate("usage.pieLabel")}
					</button>
				</div>
			</div>
			{items.length === 0 ? (
				<EmptyUsage />
			) : chart === "bar" ? (
				<ShareBarChart items={items} />
			) : (
				<SharePieChart items={items} />
			)}
			{items.length > 0 && (
				<BreakdownRows kindLabel={kindLabel} items={items} />
			)}
		</section>
	);
}

function ShareBarChart({ items }: { items: UsageBreakdownItem[] }) {
	return (
		<div className="space-y-3 p-5">
			{items.map((item, index) => (
				<div
					key={item.name}
					className="grid grid-cols-[minmax(120px,220px)_1fr_58px] items-center gap-3"
				>
					<span
						className="truncate text-xs font-medium text-text-primary"
						title={item.name}
					>
						{item.name}
					</span>
					<div className="h-3 overflow-hidden bg-surface-alt">
						<div
							className="h-full transition-[width]"
							style={{
								backgroundColor: PIE_COLORS[index % PIE_COLORS.length],
								width: `${Math.max(0, Math.min(100, item.share))}%`,
							}}
							title={`${item.name} ${formatShare(item.share)}`}
						/>
					</div>
					<span className="text-right text-xs tabular-nums text-text-secondary">
						{formatShare(item.share)}
					</span>
				</div>
			))}
		</div>
	);
}

function SharePieChart({ items }: { items: UsageBreakdownItem[] }) {
	const translate = useT();
	let start = 0;
	const segments = items.map((item, index) => {
		const end = Math.min(100, start + Math.max(0, item.share));
		const segment = `${PIE_COLORS[index % PIE_COLORS.length]} ${start}% ${end}%`;
		start = end;
		return segment;
	});
	return (
		<div
			aria-label={translate("usage.pie")}
			className="grid items-center gap-6 p-5 md:grid-cols-[180px_minmax(0,1fr)]"
		>
			<div
				className="mx-auto aspect-square w-40 rounded-full border border-border"
				style={{ background: `conic-gradient(${segments.join(", ")})` }}
			>
				<div className="m-10 aspect-square rounded-full bg-surface" />
			</div>
			<div className="grid gap-2 sm:grid-cols-2">
				{items.map((item, index) => (
					<div
						key={item.name}
						className="flex min-w-0 items-center gap-2 text-xs"
					>
						<span
							className="h-2.5 w-2.5 shrink-0"
							style={{ backgroundColor: PIE_COLORS[index % PIE_COLORS.length] }}
						/>
						<span
							className="min-w-0 flex-1 truncate text-text-secondary"
							title={item.name}
						>
							{item.name}
						</span>
						<span className="tabular-nums text-text-primary">
							{formatShare(item.share)}
						</span>
					</div>
				))}
			</div>
		</div>
	);
}

function BreakdownRows({
	kindLabel,
	items,
}: {
	kindLabel: string;
	items: UsageBreakdownItem[];
}) {
	const translate = useT();
	const locale = intlLocale(useActiveLocaleId());
	return (
		<div className="border-t border-border">
			<div className="grid grid-cols-[minmax(0,1.5fr)_90px_120px_120px] gap-4 bg-surface-alt px-4 py-3 text-xs font-medium text-text-muted">
				<span>{kindLabel}</span>
				<span className="text-right">{translate("usage.requests")}</span>
				<span className="text-right">{translate("usage.tokens")}</span>
				<span className="text-right">{translate("usage.cost")}</span>
			</div>
			{items.map((item) => (
				<div
					key={item.name}
					className="grid grid-cols-[minmax(0,1.5fr)_90px_120px_120px] items-center gap-4 border-t border-border px-4 py-3 text-xs"
				>
					<span
						className="truncate font-medium text-text-primary"
						title={item.name}
					>
						{item.name}
					</span>
					<span className="text-right tabular-nums text-text-secondary">
						{item.requests}
					</span>
					<span className="text-right tabular-nums text-text-secondary">
						{formatNumber(item.tokens, locale)}{" "}
						<span className="text-[10px] text-text-muted">
							({formatShare(item.share)})
						</span>
					</span>
					<span className="text-right tabular-nums font-medium text-text-primary">
						{formatCost(item.cost, item.currency, translate, locale)}
					</span>
				</div>
			))}
		</div>
	);
}

function Metric({
	icon: Icon,
	label,
	value,
	detail,
	tone = "blue",
}: {
	icon: ComponentType<{ className?: string }>;
	label: string;
	value: string;
	detail: string;
	tone?: "blue" | "green" | "info" | "warning";
}) {
	const tones = {
		blue: "bg-accent/10 text-accent",
		green: "bg-success-bg text-success",
		info: "bg-info-bg text-info",
		warning: "bg-warning-bg text-warning",
	};
	return (
		<div className="rounded-lg border border-border bg-surface p-3">
			<div className="flex items-center gap-2">
				<span
					className={`flex h-7 w-7 items-center justify-center rounded-md ${tones[tone]}`}
				>
					<Icon className="h-3.5 w-3.5" />
				</span>
				<span className="text-[11px] text-text-muted">{label}</span>
			</div>
			<div className="mt-2 truncate text-base font-semibold tabular-nums text-text-primary">
				{value}
			</div>
			<div className="mt-0.5 truncate text-[10px] text-text-muted">
				{detail}
			</div>
		</div>
	);
}

function UsagePlaceholder({ message }: { message: string }) {
	return (
		<div className="flex min-h-28 items-center justify-center px-4 text-xs text-text-muted">
			{message}
		</div>
	);
}

function EmptyUsage() {
	const translate = useT();
	return <UsagePlaceholder message={translate("usage.empty")} />;
}

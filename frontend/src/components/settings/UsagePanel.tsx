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
	type UsageBreakdownItem,
	type UsageRange,
	type UsageTrendBucket,
	emptyUsageReport,
	getUsageReport,
} from "../../services/usage";

type UsageTab = "requests" | "providers" | "models";
type ShareChart = "bar" | "pie";

const RANGE_OPTIONS: { value: UsageRange; label: string }[] = [
	{ value: "15m", label: "15 minutes" },
	{ value: "30m", label: "30 minutes" },
	{ value: "1h", label: "1 hour" },
	{ value: "3h", label: "3 hours" },
	{ value: "day", label: "Day" },
	{ value: "week", label: "Week" },
	{ value: "3w", label: "3 weeks" },
	{ value: "month", label: "Month" },
	{ value: "quarter", label: "Quarter" },
	{ value: "year", label: "Year" },
	{ value: "custom", label: "Custom" },
	{ value: "all", label: "All time" },
];

const PIE_COLORS = [
	"var(--color-accent)",
	"var(--color-success)",
	"var(--color-warning)",
	"var(--color-info)",
	"var(--color-danger)",
];

function formatNumber(value: number): string {
	return new Intl.NumberFormat("en-US").format(Math.round(value));
}

function formatCost(value: number | null, currency = "USD"): string {
	if (value == null) return "Unpriced";
	if (currency === "MIXED") return "Mixed currencies";
	try {
		return new Intl.NumberFormat("en-US", {
			style: "currency",
			currency,
			minimumFractionDigits: 4,
			maximumFractionDigits: 4,
		}).format(value);
	} catch {
		return `${currency} ${value.toFixed(4)}`;
	}
}

function formatDate(value: string): string {
	return new Intl.DateTimeFormat("en-US", {
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

export default function UsagePanel() {
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
								Usage details
							</h3>
							<p className="text-xs text-text-muted">
								Engine-aggregated tokens, latency, and estimated spend.
							</p>
						</div>
					</div>
					<div className="flex items-center gap-2">
						<button
							type="button"
							title="Refresh usage"
							aria-label="Refresh usage"
							onClick={() => setRefreshKey((value) => value + 1)}
							className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-text-muted hover:bg-surface-hover hover:text-text-primary"
						>
							<RefreshCw
								className={loading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"}
							/>
						</button>
						<button
							type="button"
							title="Export usage"
							aria-label="Export usage"
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
						label="Total tokens"
						value={formatNumber(totalTokens)}
						detail={`${formatNumber(report.totals.input)} in / ${formatNumber(report.totals.output)} out`}
					/>
					<Metric
						icon={CircleDollarSign}
						label="Estimated cost"
						value={
							report.totals.priced
								? formatCost(report.totals.cost, report.totals.currency)
								: "Unpriced"
						}
						detail={`${report.totals.priced} priced requests · ${report.totals.currency}`}
						tone="green"
					/>
					<Metric
						icon={ListFilter}
						label="Requests"
						value={formatNumber(report.totals.requests)}
						detail="Recorded model calls"
					/>
					<Metric
						icon={Clock3}
						label="Provider time"
						value={`${(report.totals.durationMs / 1000).toFixed(1)}s`}
						detail="Stream duration"
					/>
					<Metric
						icon={BadgeCheck}
						label="Cache hits"
						value={formatNumber(report.totals.cacheRead)}
						detail={`${formatShare(
							report.totals.input > 0
								? (report.totals.cacheRead / report.totals.input) * 100
								: 0,
						)} of input tokens`}
						tone="info"
					/>
					<Metric
						icon={Layers3}
						label="Cache created"
						value={formatNumber(report.totals.cacheCreation)}
						detail="Prompt tokens written"
						tone="warning"
					/>
				</div>
			</div>

			<div className="px-6 py-5">
				<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
					<div className="flex items-center gap-1 rounded-lg border border-border bg-surface-alt p-1">
						{(
							[
								["requests", "Request log", ListFilter],
								["providers", "Provider stats", TrendingUp],
								["models", "Model stats", ChartNoAxesColumn],
							] as const
						).map(([value, label, Icon]) => (
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
								{label}
							</button>
						))}
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<Filter className="h-3.5 w-3.5 text-text-muted" />
						<select
							value={range}
							onChange={(event) => setRange(event.target.value as UsageRange)}
							aria-label="Usage period"
							className="h-8 rounded-md border border-border bg-surface px-2 text-xs text-text-primary"
						>
							{RANGE_OPTIONS.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
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
									aria-label="Custom usage start"
									className="h-8 rounded-md border border-border bg-surface px-2 text-xs text-text-primary"
								/>
								<input
									autoComplete="off"
									type="datetime-local"
									value={customTo}
									min={customFrom}
									onChange={(event) => setCustomTo(event.target.value)}
									aria-label="Custom usage end"
									className="h-8 rounded-md border border-border bg-surface px-2 text-xs text-text-primary"
								/>
							</>
						)}
						<select
							value={provider}
							onChange={(event) => setProvider(event.target.value)}
							aria-label="Usage provider"
							className="h-8 max-w-40 rounded-md border border-border bg-surface px-2 text-xs text-text-primary"
						>
							<option value="all">All providers</option>
							{providerOptions.map((item) => (
								<option key={item} value={item}>
									{item}
								</option>
							))}
						</select>
						<select
							value={model}
							onChange={(event) => setModel(event.target.value)}
							aria-label="Usage model"
							className="h-8 max-w-48 rounded-md border border-border bg-surface px-2 text-xs text-text-primary"
						>
							<option value="all">All models</option>
							{modelOptions.map((item) => (
								<option key={item} value={item}>
									{item}
								</option>
							))}
						</select>
						<select
							value={currency}
							onChange={(event) => setCurrency(event.target.value)}
							aria-label="Usage currency"
							className="h-8 w-28 rounded-md border border-border bg-surface px-2 text-xs text-text-primary"
							title="Display currency"
						>
							{report.currencies.map((item) => (
								<option key={item} value={item}>
									{item}
								</option>
							))}
						</select>
						<span className="hidden items-center gap-1 text-[11px] text-text-muted md:flex">
							<CalendarDays className="h-3.5 w-3.5" />
							{report.totals.requests} records
						</span>
					</div>
				</div>

				<section
					aria-label="Usage bar chart"
					className="mb-5 rounded-lg border border-border bg-surface p-5"
				>
					<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
						<div>
							<h4 className="text-sm font-semibold text-text-primary">
								Usage over time
							</h4>
							<p className="mt-0.5 text-xs text-text-muted">
								Input and output tokens in Engine-defined time buckets.
							</p>
						</div>
						<div className="flex items-center gap-4 text-[11px] text-text-muted">
							<span className="flex items-center gap-1.5">
								<span className="h-2.5 w-2.5 bg-accent" />
								Input
							</span>
							<span className="flex items-center gap-1.5">
								<span className="h-2.5 w-2.5 bg-success" />
								Output
							</span>
							<span className="tabular-nums">
								{formatNumber(totalTokens)} tokens
							</span>
						</div>
					</div>
					{loadError ? (
						<UsagePlaceholder message="Usage report is unavailable." />
					) : loading && report.totals.requests === 0 ? (
						<UsagePlaceholder message="Loading usage report..." />
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
						kind={tab === "providers" ? "Provider" : "Model"}
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
	const maxTokens = Math.max(1, ...buckets.map((bucket) => bucket.tokens));
	return (
		<div className="overflow-x-auto pb-1">
			<div
				className="grid min-w-full items-end gap-2"
				style={{
					gridTemplateColumns: `repeat(${buckets.length}, minmax(44px, 1fr))`,
				}}
			>
				{buckets.map((bucket) => {
					const height =
						bucket.tokens > 0
							? Math.max(5, (bucket.tokens / maxTokens) * 100)
							: 0;
					const inputShare =
						bucket.tokens > 0 ? (bucket.input / bucket.tokens) * 100 : 0;
					return (
						<div
							key={bucket.startAt}
							className="flex min-w-0 flex-col items-center gap-2"
						>
							<div className="flex h-36 w-full items-end justify-center border-b border-border">
								<div
									className="flex w-full max-w-10 flex-col-reverse overflow-hidden rounded-t-sm"
									style={{ height: `${height}%` }}
									title={`${formatNumber(bucket.tokens)} tokens (${formatNumber(bucket.input)} in / ${formatNumber(bucket.output)} out)`}
								>
									<div
										className="bg-accent"
										style={{ height: `${inputShare}%` }}
									/>
									<div
										className="bg-success"
										style={{ height: `${100 - inputShare}%` }}
									/>
								</div>
							</div>
							<span
								className="w-full truncate text-center text-[10px] text-text-muted"
								title={bucket.label}
							>
								{bucket.label}
							</span>
						</div>
					);
				})}
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
	return (
		<section
			aria-label="Request log"
			className="overflow-hidden rounded-lg border border-border bg-surface"
		>
			<div className="overflow-x-auto">
				<table className="w-full min-w-[760px] text-left text-xs">
					<thead className="bg-surface-alt text-text-muted">
						<tr>
							<th className="px-4 py-3 font-medium">Time</th>
							<th className="px-4 py-3 font-medium">Provider</th>
							<th className="px-4 py-3 font-medium">Model</th>
							<th className="px-4 py-3 text-right font-medium">Input</th>
							<th className="px-4 py-3 text-right font-medium">Output</th>
							<th className="px-4 py-3 text-right font-medium">Cost</th>
							<th className="px-4 py-3 text-right font-medium">Status</th>
						</tr>
					</thead>
					<tbody>
						{records.map((record) => (
							<tr
								key={record.id}
								className="border-t border-border hover:bg-surface-hover"
							>
								<td className="whitespace-nowrap px-4 py-3 text-text-muted">
									{formatDate(record.createdAt)}
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
									{formatNumber(record.inputTokens)}
								</td>
								<td className="px-4 py-3 text-right tabular-nums text-text-primary">
									{formatNumber(record.outputTokens)}
								</td>
								<td className="px-4 py-3 text-right tabular-nums font-medium text-text-primary">
									{formatCost(record.cost, record.currency)}
								</td>
								<td className="px-4 py-3 text-right">
									<span
										className={
											record.status === "completed"
												? "inline-flex rounded-full bg-success-bg px-2 py-0.5 text-[10px] text-success"
												: "inline-flex rounded-full bg-warning-bg px-2 py-0.5 text-[10px] text-warning"
										}
									>
										{record.status}
									</span>
								</td>
							</tr>
						))}
					</tbody>
				</table>
				{records.length === 0 &&
					(loading ? (
						<UsagePlaceholder message="Loading usage report..." />
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
	kind: "Provider" | "Model";
	items: UsageBreakdownItem[];
	chart: ShareChart;
	onChartChange: (chart: ShareChart) => void;
}) {
	return (
		<section
			aria-label="Usage share chart"
			className="rounded-lg border border-border bg-surface"
		>
			<div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
				<div>
					<h4 className="text-sm font-semibold text-text-primary">
						{kind} share
					</h4>
					<p className="mt-0.5 text-xs text-text-muted">
						Token share calculated by Engine.
					</p>
				</div>
				<div className="flex items-center gap-1 rounded-md border border-border bg-surface-alt p-1">
					<button
						type="button"
						aria-label="Bar share chart"
						aria-pressed={chart === "bar"}
						onClick={() => onChartChange("bar")}
						className={
							chart === "bar"
								? "flex h-7 items-center gap-1.5 rounded-sm bg-surface px-2 text-[11px] font-medium text-text-primary shadow-sm"
								: "flex h-7 items-center gap-1.5 rounded-sm px-2 text-[11px] text-text-muted hover:text-text-primary"
						}
					>
						<ChartNoAxesColumn className="h-3.5 w-3.5" />
						Bars
					</button>
					<button
						type="button"
						aria-label="Pie share chart"
						aria-pressed={chart === "pie"}
						onClick={() => onChartChange("pie")}
						className={
							chart === "pie"
								? "flex h-7 items-center gap-1.5 rounded-sm bg-surface px-2 text-[11px] font-medium text-text-primary shadow-sm"
								: "flex h-7 items-center gap-1.5 rounded-sm px-2 text-[11px] text-text-muted hover:text-text-primary"
						}
					>
						<ChartPie className="h-3.5 w-3.5" />
						Pie
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
			{items.length > 0 && <BreakdownRows kind={kind} items={items} />}
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
	let start = 0;
	const segments = items.map((item, index) => {
		const end = Math.min(100, start + Math.max(0, item.share));
		const segment = `${PIE_COLORS[index % PIE_COLORS.length]} ${start}% ${end}%`;
		start = end;
		return segment;
	});
	return (
		<div
			aria-label="Usage share pie chart"
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
	kind,
	items,
}: {
	kind: "Provider" | "Model";
	items: UsageBreakdownItem[];
}) {
	return (
		<div className="border-t border-border">
			<div className="grid grid-cols-[minmax(0,1.5fr)_90px_120px_120px] gap-4 bg-surface-alt px-4 py-3 text-xs font-medium text-text-muted">
				<span>{kind}</span>
				<span className="text-right">Requests</span>
				<span className="text-right">Tokens</span>
				<span className="text-right">Cost</span>
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
						{formatNumber(item.tokens)}{" "}
						<span className="text-[10px] text-text-muted">
							({formatShare(item.share)})
						</span>
					</span>
					<span className="text-right tabular-nums font-medium text-text-primary">
						{formatCost(item.cost, item.currency)}
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
	return (
		<UsagePlaceholder message="Usage records will appear after the next model response." />
	);
}

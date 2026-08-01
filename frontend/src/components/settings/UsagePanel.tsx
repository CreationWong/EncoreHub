import {
    CalendarDays,
    ChartNoAxesColumn,
    CircleDollarSign,
    Clock3,
    Database,
    Download,
    Filter,
    ListFilter,
    Trash2,
    TrendingUp,
    Zap,
} from "lucide-react";
import {useMemo, useState} from "react";
import {useContextManagementStore} from "../../stores/contextManagementStore";

type UsageTab = "requests" | "providers" | "models";

function formatNumber(value: number): string {
    return new Intl.NumberFormat("en-US").format(Math.round(value));
}

function formatCost(value: number | null, currency = "USD"): string {
    if (value == null) return "Unpriced";
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        minimumFractionDigits: 4,
        maximumFractionDigits: 4,
    }).format(value);
}

function formatDate(value: string): string {
    return new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    }).format(new Date(value));
}

function percent(value: number, total: number): string {
    return total > 0 ? `${Math.round((value / total) * 100)}%` : "0%";
}

export default function UsagePanel() {
    const records = useContextManagementStore((state) => state.records);
    const clearUsage = useContextManagementStore((state) => state.clearUsage);
    const [tab, setTab] = useState<UsageTab>("requests");
    const [period, setPeriod] = useState("all");
    const [provider, setProvider] = useState("all");
    const [model, setModel] = useState("all");

    const providers = useMemo(
        () => [...new Set(records.map((record) => record.provider))].sort(),
        [records],
    );
    const models = useMemo(
        () => [...new Set(records.map((record) => record.model))].sort(),
        [records],
    );
    const filtered = useMemo(() => {
        const now = Date.now();
        const cutoff =
            period === "today"
                ? now - 24 * 60 * 60 * 1000
                : period === "7d"
                    ? now - 7 * 24 * 60 * 60 * 1000
                    : 0;
        return records.filter((record) => {
            const matchesPeriod = !cutoff || new Date(record.createdAt).getTime() >= cutoff;
            return (
                matchesPeriod &&
                (provider === "all" || record.provider === provider) &&
                (model === "all" || record.model === model)
            );
        });
    }, [model, period, provider, records]);

    const totals = useMemo(
        () => ({
            input: filtered.reduce((sum, record) => sum + record.inputTokens, 0),
            output: filtered.reduce((sum, record) => sum + record.outputTokens, 0),
            cost: filtered.reduce((sum, record) => sum + (record.cost ?? 0), 0),
            priced: filtered.filter((record) => record.cost != null).length,
            duration: filtered.reduce((sum, record) => sum + record.durationMs, 0),
        }),
        [filtered],
    );

    const trend = useMemo(() => {
        const buckets = new Map<string, { tokens: number; cost: number }>();
        for (const record of filtered) {
            const date = new Date(record.createdAt);
            const key = `${date.getMonth() + 1}/${date.getDate()}`;
            const bucket = buckets.get(key) ?? {tokens: 0, cost: 0};
            bucket.tokens += record.inputTokens + record.outputTokens;
            bucket.cost += record.cost ?? 0;
            buckets.set(key, bucket);
        }
        return [...buckets.entries()].slice(-10);
    }, [filtered]);
    const maxTokens = Math.max(1, ...trend.map(([, value]) => value.tokens));

    const breakdown = useMemo(() => {
        const map = new Map<string, { requests: number; tokens: number; cost: number }>();
        for (const record of filtered) {
            const key = tab === "providers" ? record.provider : record.model;
            const current = map.get(key) ?? {requests: 0, tokens: 0, cost: 0};
            current.requests += 1;
            current.tokens += record.inputTokens + record.outputTokens;
            current.cost += record.cost ?? 0;
            map.set(key, current);
        }
        return [...map.entries()].sort((a, b) => b[1].tokens - a[1].tokens);
    }, [filtered, tab]);

    return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden bg-workspace">
            <div className="shrink-0 border-b border-border bg-workspace px-6 py-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <div className="flex items-center gap-2">
                            <div
                                className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/10 text-accent">
                                <ChartNoAxesColumn className="h-5 w-5"/>
                            </div>
                            <div>
                                <h3 className="text-lg font-semibold text-text-primary">Usage details</h3>
                                <p className="text-xs text-text-muted">Track tokens, latency, and estimated spend per
                                    model call.</p>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            title="Export usage"
                            aria-label="Export usage"
                            onClick={() => {
                                const blob = new Blob([JSON.stringify(filtered, null, 2)], {
                                    type: "application/json",
                                });
                                const url = URL.createObjectURL(blob);
                                const anchor = document.createElement("a");
                                anchor.href = url;
                                anchor.download = "encorehub-usage.json";
                                anchor.click();
                                URL.revokeObjectURL(url);
                            }}
                            className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-text-muted hover:bg-surface-hover hover:text-text-primary"
                        >
                            <Download className="h-3.5 w-3.5"/>
                        </button>
                        <button
                            type="button"
                            title="Clear usage history"
                            aria-label="Clear usage history"
                            onClick={clearUsage}
                            className="flex h-8 w-8 items-center justify-center rounded-md border border-danger-border text-danger hover:bg-danger-bg"
                        >
                            <Trash2 className="h-3.5 w-3.5"/>
                        </button>
                    </div>
                </div>
                <div className="mt-5 grid grid-cols-2 gap-3 xl:grid-cols-5">
                    <Metric icon={Zap} label="Total tokens" value={formatNumber(totals.input + totals.output)}
                            detail={`${formatNumber(totals.input)} in / ${formatNumber(totals.output)} out`}/>
                    <Metric icon={CircleDollarSign} label="Estimated cost"
                            value={totals.priced ? formatCost(totals.cost) : "Unpriced"}
                            detail={`${totals.priced} priced requests`} tone="green"/>
                    <Metric icon={ListFilter} label="Requests" value={formatNumber(filtered.length)}
                            detail="Recorded model calls"/>
                    <Metric icon={Clock3} label="Provider time" value={`${(totals.duration / 1000).toFixed(1)}s`}
                            detail="Stream duration"/>
                    <Metric icon={Database} label="Cache signal" value="Usage-ready" detail="Provider telemetry"
                            tone="purple"/>
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-1 rounded-lg border border-border bg-surface-alt p-1">
                        {([
                            ["requests", "Request log", ListFilter],
                            ["providers", "Provider stats", TrendingUp],
                            ["models", "Model stats", ChartNoAxesColumn],
                        ] as const).map(([value, label, Icon]) => (
                            <button
                                key={value}
                                type="button"
                                onClick={() => setTab(value)}
                                aria-pressed={tab === value}
                                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${tab === value ? "bg-accent text-white" : "text-text-muted hover:bg-surface-hover hover:text-text-primary"}`}
                            >
                                <Icon className="h-3.5 w-3.5"/>
                                {label}
                            </button>
                        ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <Filter className="h-3.5 w-3.5 text-text-muted"/>
                        <select value={period} onChange={(event) => setPeriod(event.target.value)}
                                aria-label="Usage period"
                                className="h-8 rounded-md border border-border bg-surface px-2 text-xs text-text-primary">
                            <option value="all">All time</option>
                            <option value="today">Last 24 hours</option>
                            <option value="7d">Last 7 days</option>
                        </select>
                        <select value={provider} onChange={(event) => setProvider(event.target.value)}
                                aria-label="Usage provider"
                                className="h-8 max-w-40 rounded-md border border-border bg-surface px-2 text-xs text-text-primary">
                            <option value="all">All providers</option>
                            {providers.map((item) => <option key={item} value={item}>{item}</option>)}
                        </select>
                        <select value={model} onChange={(event) => setModel(event.target.value)}
                                aria-label="Usage model"
                                className="h-8 max-w-48 rounded-md border border-border bg-surface px-2 text-xs text-text-primary">
                            <option value="all">All models</option>
                            {models.map((item) => <option key={item} value={item}>{item}</option>)}
                        </select>
                        <span className="hidden items-center gap-1 text-[11px] text-text-muted md:flex"><CalendarDays
                            className="h-3.5 w-3.5"/> {filtered.length} records</span>
                    </div>
                </div>

                <section aria-label="Usage trend" className="mb-5 rounded-xl border border-border bg-surface p-5">
                    <div className="mb-4 flex items-center justify-between">
                        <div><h4 className="text-sm font-semibold text-text-primary">Usage trend</h4><p
                            className="mt-0.5 text-xs text-text-muted">Input and output tokens grouped by day.</p></div>
                        <span
                            className="text-xs tabular-nums text-text-muted">{formatNumber(totals.input + totals.output)} tokens</span>
                    </div>
                    {trend.length === 0 ? <EmptyUsage/> : <div
                        className="flex h-36 items-end gap-2 border-b border-border px-2 pt-4">{trend.map(([label, value]) =>
                        <div key={label} className="flex min-w-0 flex-1 flex-col items-center gap-2">
                            <div className="flex h-28 w-full max-w-12 items-end">
                                <div className="w-full rounded-t-md bg-accent/80 transition-all"
                                     style={{height: `${Math.max(5, (value.tokens / maxTokens) * 100)}%`}}
                                     title={`${formatNumber(value.tokens)} tokens`}/>
                            </div>
                            <span className="truncate text-[10px] text-text-muted">{label}</span></div>)}</div>}
                </section>

                {tab === "requests" ? (
                    <section aria-label="Request log"
                             className="overflow-hidden rounded-xl border border-border bg-surface">
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
                                <tbody>{filtered.map((record) => <tr key={record.id}
                                                                     className="border-t border-border hover:bg-surface-hover">
                                    <td className="whitespace-nowrap px-4 py-3 text-text-muted">{formatDate(record.createdAt)}</td>
                                    <td className="px-4 py-3 font-medium text-text-primary">{record.provider}</td>
                                    <td className="max-w-56 truncate px-4 py-3 text-text-secondary"
                                        title={record.model}>{record.model}</td>
                                    <td className="px-4 py-3 text-right tabular-nums text-text-primary">{formatNumber(record.inputTokens)}</td>
                                    <td className="px-4 py-3 text-right tabular-nums text-text-primary">{formatNumber(record.outputTokens)}</td>
                                    <td className="px-4 py-3 text-right tabular-nums font-medium text-text-primary">{formatCost(record.cost, record.currency)}</td>
                                    <td className="px-4 py-3 text-right"><span
                                        className={`inline-flex rounded-full px-2 py-0.5 text-[10px] ${record.status === "completed" ? "bg-success-bg text-success" : "bg-warning-bg text-warning"}`}>{record.status}</span>
                                    </td>
                                </tr>)}</tbody>
                            </table>
                            {filtered.length === 0 && <EmptyUsage/>}</div>
                    </section>
                ) : (
                    <section aria-label="Usage breakdown" className="rounded-xl border border-border bg-surface">
                        <div
                            className="grid grid-cols-[minmax(0,1.5fr)_100px_120px_120px] gap-4 bg-surface-alt px-4 py-3 text-xs font-medium text-text-muted">
                            <span>{tab === "providers" ? "Provider" : "Model"}</span><span
                            className="text-right">Requests</span><span className="text-right">Tokens</span><span
                            className="text-right">Cost</span></div>
                        {breakdown.map(([name, value]) => <div key={name}
                                                               className="grid grid-cols-[minmax(0,1.5fr)_100px_120px_120px] items-center gap-4 border-t border-border px-4 py-3 text-xs">
                            <span className="truncate font-medium text-text-primary" title={name}>{name}</span><span
                            className="text-right tabular-nums text-text-secondary">{value.requests}</span><span
                            className="text-right tabular-nums text-text-secondary">{formatNumber(value.tokens)} <span
                            className="text-[10px] text-text-muted">({percent(value.tokens, totals.input + totals.output)})</span></span><span
                            className="text-right tabular-nums font-medium text-text-primary">{formatCost(value.cost)}</span>
                        </div>)}{breakdown.length === 0 && <EmptyUsage/>}</section>
                )}
            </div>
        </div>
    );
}

function Metric({icon: Icon, label, value, detail, tone = "blue"}: {
    icon: typeof Zap;
    label: string;
    value: string;
    detail: string;
    tone?: "blue" | "green" | "purple"
}) {
    const tones = {
        blue: "bg-accent/10 text-accent",
        green: "bg-success-bg text-success",
        purple: "bg-purple-500/10 text-purple-400"
    };
    return <div className="rounded-lg border border-border bg-surface p-3">
        <div className="flex items-center gap-2"><span
            className={`flex h-7 w-7 items-center justify-center rounded-md ${tones[tone]}`}><Icon
            className="h-3.5 w-3.5"/></span><span className="text-[11px] text-text-muted">{label}</span></div>
        <div className="mt-2 truncate text-base font-semibold tabular-nums text-text-primary">{value}</div>
        <div className="mt-0.5 truncate text-[10px] text-text-muted">{detail}</div>
    </div>;
}

function EmptyUsage() {
    return <div className="flex min-h-28 items-center justify-center px-4 text-xs text-text-muted">Usage records will
        appear after the next model response.</div>;
}

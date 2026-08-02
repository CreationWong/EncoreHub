import {
	AlertTriangle,
	Check,
	GitCompareArrows,
	Minus,
	Plus,
	Search,
	Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ProviderModelConfig } from "../../services/providers";
import {
	type ProviderModelDiscoveryDiff,
	modelsForSelectedAdditions,
} from "./providerDiscovery";

interface Props {
	diff: ProviderModelDiscoveryDiff;
	onApply: (models: ProviderModelConfig[]) => void;
	onCancel: () => void;
}

const TONES = {
	add: { icon: Plus, label: "Add", className: "text-success" },
	keep: { icon: Minus, label: "Keep", className: "text-text-secondary" },
	remove: { icon: Trash2, label: "Remove", className: "text-danger" },
} as const;

function DiffGroup({
	tone,
	models,
}: {
	tone: keyof typeof TONES;
	models: ProviderModelConfig[];
}) {
	const config = TONES[tone];
	const Icon = config.icon;
	return (
		<div className="min-w-0 border-t border-border px-3 py-3 first:border-t-0 sm:border-l sm:border-t-0 sm:first:border-l-0">
			<div
				className={`mb-2 flex items-center gap-1.5 text-xs font-semibold ${config.className}`}
			>
				<Icon className="h-3.5 w-3.5" />
				<span>{config.label}</span>
				<span className="text-text-muted">{models.length}</span>
			</div>
			{models.length === 0 ? (
				<span className="text-xs text-text-muted">None</span>
			) : (
				<ul className="space-y-1">
					{models.slice(0, 5).map((model) => (
						<li
							key={model.id}
							className="truncate font-mono text-[11px] text-text-secondary"
							title={model.id}
						>
							{model.id}
						</li>
					))}
					{models.length > 5 && (
						<li className="text-[11px] text-text-muted">
							+{models.length - 5} more
						</li>
					)}
				</ul>
			)}
		</div>
	);
}

export default function ProviderDiscoveryReview({
	diff,
	onApply,
	onCancel,
}: Props) {
	const selectable = diff.selectionRequired && diff.additions.length > 0;
	const [selectedIds, setSelectedIds] = useState(
		() => new Set(diff.additions.map((model) => model.id)),
	);
	const [query, setQuery] = useState("");

	useEffect(() => {
		setSelectedIds(new Set(diff.additions.map((model) => model.id)));
		setQuery("");
	}, [diff]);

	const visibleAdditions = useMemo(() => {
		const normalized = query.trim().toLowerCase();
		if (!normalized) return diff.additions;
		return diff.additions.filter((model) =>
			[model.id, model.name, model.owned_by, model.description].some((value) =>
				value?.toLowerCase().includes(normalized),
			),
		);
	}, [diff.additions, query]);

	const toggle = (id: string) => {
		setSelectedIds((current) => {
			const next = new Set(current);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	return (
		<section
			aria-label="Model discovery changes"
			aria-live="polite"
			className="mb-3 overflow-hidden rounded-md border border-border bg-surface"
		>
			<header className="flex items-start gap-2 border-b border-border bg-surface-alt px-3 py-2.5">
				<GitCompareArrows className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
				<div className="min-w-0">
					<h5 className="text-xs font-semibold text-text-primary">
						{selectable
							? "Choose models to add"
							: "Review remote model changes"}
					</h5>
					<p className="text-[11px] text-text-muted">
						{selectable
							? `${diff.additions.length} new models from ${Math.max(diff.owners.length, 1)} owner groups. Source metadata is applied automatically.`
							: "Source metadata has been mapped into the provider model records."}
					</p>
				</div>
			</header>

			{selectable ? (
				<div>
					<div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
						<div className="relative min-w-52 flex-1">
							<Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
							<input
								autoComplete="off"
								value={query}
								onChange={(event) => setQuery(event.target.value)}
								placeholder="Filter discovered models"
								aria-label="Filter discovered models"
								className="h-8 w-full rounded-md border border-border bg-surface-alt pl-8 pr-2 text-xs text-text-primary placeholder:text-text-muted"
							/>
						</div>
						<div className="flex items-center gap-2 text-[11px]">
							<span className="text-text-muted">
								{selectedIds.size} selected
							</span>
							<button
								type="button"
								onClick={() =>
									setSelectedIds(
										new Set(diff.additions.map((model) => model.id)),
									)
								}
								className="text-accent hover:underline"
							>
								Select all
							</button>
							<button
								type="button"
								onClick={() => setSelectedIds(new Set())}
								className="text-text-secondary hover:underline"
							>
								Clear
							</button>
						</div>
					</div>
					<div className="max-h-72 overflow-y-auto">
						{visibleAdditions.map((model) => (
							<label
								key={model.id}
								className="flex min-h-11 cursor-pointer items-center gap-3 border-b border-border px-3 py-2 last:border-b-0 hover:bg-surface-hover"
							>
								<input
									autoComplete="off"
									type="checkbox"
									checked={selectedIds.has(model.id)}
									onChange={() => toggle(model.id)}
									className="h-4 w-4 accent-accent"
								/>
								<span className="min-w-0 flex-1">
									<span className="block truncate text-xs font-medium text-text-primary">
										{model.name || model.id}
									</span>
									<span className="block truncate font-mono text-[11px] text-text-muted">
										{model.id}
									</span>
								</span>
								{model.owned_by && (
									<span className="rounded bg-surface-alt px-1.5 py-0.5 text-[10px] text-text-muted">
										{model.owned_by}
									</span>
								)}
							</label>
						))}
					</div>
				</div>
			) : (
				<div className="grid sm:grid-cols-3">
					<DiffGroup tone="add" models={diff.additions} />
					<DiffGroup tone="keep" models={diff.retained} />
					<DiffGroup tone="remove" models={diff.removals} />
				</div>
			)}

			{diff.removalsWithheld && (
				<p className="flex items-start gap-1.5 border-t border-warning-border bg-warning-bg px-3 py-2 text-[11px] text-warning">
					<AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
					Local-only models will be kept because at least one endpoint failed.
				</p>
			)}
			<footer className="flex items-center justify-end gap-2 border-t border-border px-3 py-2.5">
				<button
					type="button"
					onClick={onCancel}
					className="rounded-md border border-border px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-hover hover:text-text-primary"
				>
					Keep local list
				</button>
				<button
					type="button"
					disabled={selectable && selectedIds.size === 0}
					onClick={() =>
						onApply(
							selectable
								? modelsForSelectedAdditions(diff, selectedIds)
								: diff.nextModels,
						)
					}
					className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
				>
					<Check className="h-3.5 w-3.5" />
					{selectable ? "Save selected models" : "Apply & save"}
				</button>
			</footer>
		</section>
	);
}

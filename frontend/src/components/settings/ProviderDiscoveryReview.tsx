import {
	AlertTriangle,
	Check,
	GitCompareArrows,
	Minus,
	Plus,
	Trash2,
} from "lucide-react";
import type { ProviderModelConfig } from "../../services/providers";
import type { ProviderModelDiscoveryDiff } from "./providerDiscovery";

interface Props {
	diff: ProviderModelDiscoveryDiff;
	onApply: () => void;
	onCancel: () => void;
}

const TONES = {
	add: {
		icon: Plus,
		label: "Add",
		className: "text-success",
	},
	keep: {
		icon: Minus,
		label: "Keep",
		className: "text-text-secondary",
	},
	remove: {
		icon: Trash2,
		label: "Remove",
		className: "text-danger",
	},
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
						Review remote model changes
					</h5>
					<p className="text-[11px] text-text-muted">
						The saved provider is unchanged until the draft is applied and
						saved.
					</p>
				</div>
			</header>
			<div className="grid sm:grid-cols-3">
				<DiffGroup tone="add" models={diff.additions} />
				<DiffGroup tone="keep" models={diff.retained} />
				<DiffGroup tone="remove" models={diff.removals} />
			</div>
			{diff.removalsWithheld && (
				<p className="flex items-start gap-1.5 border-t border-warning bg-warning-bg px-3 py-2 text-[11px] text-warning">
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
					onClick={onApply}
					className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover"
				>
					<Check className="h-3.5 w-3.5" />
					Apply to draft
				</button>
			</footer>
		</section>
	);
}

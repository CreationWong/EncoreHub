// Token estimation models developer panel.
//
// Inspects the per-provider/model least-squares token models persisted by the
// context management system: fitted coefficients, sample counts, and whether
// each model has enough samples to be trusted. Models can be cleared here to
// fall back to the heuristic estimators.

import { Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { clearModelStore, listModels } from "../../services/tokenModel";
import { toast } from "../../stores/toastStore";

function formatCoefficient(value: number): string {
	return new Intl.NumberFormat("en-US", {
		maximumFractionDigits: 4,
	}).format(value);
}

function coefficientRow(label: string, value: number): ReactNode {
	return (
		<div className="flex items-center justify-between gap-2">
			<span className="text-text-muted">{label}</span>
			<span className="tabular-nums text-text-secondary">
				{formatCoefficient(value)}
			</span>
		</div>
	);
}

export default function TokenModelsPanel() {
	const [modelRevision, setModelRevision] = useState(0);
	const models = listModels();

	const resetModels = () => {
		clearModelStore();
		setModelRevision((revision) => revision + 1);
		toast.info("Token estimation models cleared");
	};

	return (
		<div className="mx-auto max-w-4xl space-y-4" key={modelRevision}>
			<div className="flex items-start justify-between gap-3 border-y border-border py-4">
				<div className="min-w-0 flex-1">
					<p className="text-sm font-medium text-text-primary">
						Per-provider/model token models
					</p>
					<p className="mt-1 text-xs leading-5 text-text-muted">
						Least-squares linear models fitted on provider-reported usage. Input
						features: intercept, ASCII bytes, non-ASCII code points, message
						count. Output features: generated text bytes and code points.
					</p>
				</div>
				{Object.keys(models).length > 0 && (
					<button
						type="button"
						onClick={resetModels}
						className="flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs text-text-muted hover:bg-control hover:text-text-primary"
					>
						<Trash2 className="h-3.5 w-3.5" />
						Clear all
					</button>
				)}
			</div>

			{Object.keys(models).length === 0 ? (
				<p className="border-y border-border px-1 py-3 text-xs text-text-muted">
					No calibrated models yet. Finish a few chat turns and the models will
					appear here.
				</p>
			) : (
				<div className="divide-y divide-border border-y border-border">
					{Object.entries(models).map(([key, model]) => (
						<div key={key} className="space-y-2 px-1 py-3">
							<div className="flex items-center justify-between gap-2">
								<span className="min-w-0 truncate font-mono text-xs text-text-primary">
									{key}
								</span>
								<span className="shrink-0 text-[10px] text-text-muted">
									{model.trusted ? "fitted" : "heuristic"}
								</span>
							</div>
							<div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[11px]">
								<div className="space-y-1">
									<p className="text-text-muted">
										Input · {model.sampleCount} samples
									</p>
									{coefficientRow("intercept", model.coeffs.intercept)}
									{coefficientRow("ascii / byte", model.coeffs.asciiPerByte)}
									{coefficientRow(
										"non-ascii / char",
										model.coeffs.nonAsciiPerChar,
									)}
									{coefficientRow("per message", model.coeffs.perMessage)}
								</div>
								<div className="space-y-1">
									<p className="text-text-muted">
										Output · {model.outputSampleCount} samples
									</p>
									{coefficientRow(
										"ascii / byte",
										model.outputCoeffs.asciiPerByte,
									)}
									{coefficientRow(
										"non-ascii / char",
										model.outputCoeffs.nonAsciiPerChar,
									)}
								</div>
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

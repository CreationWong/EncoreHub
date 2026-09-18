// Token estimation models developer panel.
//
// Inspects the per-provider/model least-squares token models persisted by the
// context management system: fitted coefficients, sample counts, and whether
// each model has enough samples to be trusted. Models can be cleared here to
// fall back to the heuristic estimators.

import { Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { intlLocale, t, useActiveLocaleId, useT } from "../../i18n";
import { clearModelStore, listModels } from "../../services/tokenModel";
import { toast } from "../../stores/toastStore";

/** Format a fitted coefficient with the active locale. */
function formatCoefficient(value: number, locale: string): string {
	return new Intl.NumberFormat(locale, {
		maximumFractionDigits: 4,
	}).format(value);
}

/** One labeled coefficient row in the input or output model card. */
function coefficientRow(
	label: string,
	value: number,
	locale: string,
): ReactNode {
	return (
		<div className="flex items-center justify-between gap-2">
			<span className="text-text-muted">{label}</span>
			<span className="tabular-nums text-text-secondary">
				{formatCoefficient(value, locale)}
			</span>
		</div>
	);
}

/** Developer inspector for persisted per-model token estimators. */
export default function TokenModelsPanel() {
	const translate = useT();
	const locale = intlLocale(useActiveLocaleId());
	const [modelRevision, setModelRevision] = useState(0);
	const models = listModels();

	const resetModels = () => {
		clearModelStore();
		setModelRevision((revision) => revision + 1);
		toast.info(t("toast.tokenModelsCleared"));
	};

	return (
		<div className="mx-auto max-w-4xl space-y-4" key={modelRevision}>
			<div className="flex items-start justify-between gap-3 border-y border-border py-4">
				<div className="min-w-0 flex-1">
					<p className="text-sm font-medium text-text-primary">
						{translate("developer.tokenModels.title")}
					</p>
					<p className="mt-1 text-xs leading-5 text-text-muted">
						{translate("developer.tokenModels.help")}
					</p>
				</div>
				{Object.keys(models).length > 0 && (
					<button
						type="button"
						onClick={resetModels}
						className="flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs text-text-muted hover:bg-control hover:text-text-primary"
					>
						<Trash2 className="h-3.5 w-3.5" />
						{translate("developer.tokenModels.clearAll")}
					</button>
				)}
			</div>

			{Object.keys(models).length === 0 ? (
				<p className="border-y border-border px-1 py-3 text-xs text-text-muted">
					{translate("developer.tokenModels.empty")}
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
									{model.trusted
										? translate("developer.tokenModels.fitted")
										: translate("developer.tokenModels.heuristic")}
								</span>
							</div>
							<div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[11px]">
								<div className="space-y-1">
									<p className="text-text-muted">
										{translate("developer.tokenModels.inputSamples", {
											count: model.sampleCount,
										})}
									</p>
									{coefficientRow(
										translate("developer.tokenModels.intercept"),
										model.coeffs.intercept,
										locale,
									)}
									{coefficientRow(
										translate("developer.tokenModels.asciiPerByte"),
										model.coeffs.asciiPerByte,
										locale,
									)}
									{coefficientRow(
										translate("developer.tokenModels.nonAsciiPerChar"),
										model.coeffs.nonAsciiPerChar,
										locale,
									)}
									{coefficientRow(
										translate("developer.tokenModels.perMessage"),
										model.coeffs.perMessage,
										locale,
									)}
								</div>
								<div className="space-y-1">
									<p className="text-text-muted">
										{translate("developer.tokenModels.outputSamples", {
											count: model.outputSampleCount,
										})}
									</p>
									{coefficientRow(
										translate("developer.tokenModels.asciiPerByte"),
										model.outputCoeffs.asciiPerByte,
										locale,
									)}
									{coefficientRow(
										translate("developer.tokenModels.nonAsciiPerChar"),
										model.outputCoeffs.nonAsciiPerChar,
										locale,
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

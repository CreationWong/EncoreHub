// Editable API-key pool for one provider: order, enablement, and reveal.

import {
	ArrowDown,
	ArrowUp,
	Eye,
	EyeOff,
	Info,
	Plus,
	Trash2,
} from "lucide-react";
import { useState } from "react";
import { keyHintFor } from "../../constants/providers";
import { t, useT } from "../../i18n";
import type {
	ProviderKeyValidationResult,
	ProviderProtocol,
} from "../../services/providers";
import {
	MAX_PROVIDER_API_KEYS,
	type ProviderAPIKey,
	createProviderAPIKey,
} from "./providerKeys";
import {
	providerRuntimeStatusPresentation,
	validationResultRuntimeStatus,
} from "./providerRuntimeStatus";

interface Props {
	keys: ProviderAPIKey[];
	protocol: ProviderProtocol;
	results?: Record<string, ProviderKeyValidationResult>;
	validating?: boolean;
	waiting?: boolean;
	onChange: (keys: ProviderAPIKey[], connectionChanged: boolean) => void;
}

/** Human status for a key-validation row; translated at call time. */
function resultLabel(result?: ProviderKeyValidationResult): string {
	if (!result) return t("providers.notTested");
	if (result.status === "valid") return t("providers.keyValid");
	if (result.status === "invalid") return t("providers.keyRejected");
	if (result.status === "skipped") return t("providers.keyDisabled");
	return result.error_category
		? t("providers.validationFailedReason", {
				reason: result.error_category.replaceAll("_", " "),
			})
		: t("providers.validationFailed");
}

/** Ordered API-key rows for one provider, including validation chrome. */
export default function ProviderKeyPoolEditor({
	keys,
	protocol,
	results = {},
	validating = false,
	waiting = false,
	onChange,
}: Props) {
	const t = useT();
	const [revealed, setRevealed] = useState<Set<string>>(() => new Set());

	const update = (
		index: number,
		patch: Partial<ProviderAPIKey>,
		connectionChanged: boolean,
	) => {
		onChange(
			keys.map((key, keyIndex) =>
				keyIndex === index ? { ...key, ...patch } : key,
			),
			connectionChanged,
		);
	};

	const move = (from: number, to: number) => {
		if (to < 0 || to >= keys.length) return;
		const next = [...keys];
		const [moved] = next.splice(from, 1);
		next.splice(to, 0, moved);
		onChange(next, true);
	};

	const toggleReveal = (id: string) => {
		setRevealed((current) => {
			const next = new Set(current);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	return (
		<>
			<div className="overflow-hidden rounded-md border border-border">
				{keys.length === 0 ? (
					<div className="px-4 py-6 text-center text-xs text-text-muted">
						{t("providers.noKeys")}
					</div>
				) : (
					keys.map((key, index) => {
						const isRevealed = revealed.has(key.id);
						const result = results[key.id];
						const runtimeStatus = validationResultRuntimeStatus(
							key.enabled,
							validating || (waiting && !result),
							result?.status,
							result?.error_category,
						);
						const statusPresentation =
							providerRuntimeStatusPresentation(runtimeStatus);
						const label =
							validating && key.enabled
								? t("providers.testingKey")
								: result
									? resultLabel(result)
									: statusPresentation.label;
						return (
							<div
								key={key.id}
								className="grid gap-2 border-b border-border p-3 last:border-b-0 sm:grid-cols-[minmax(6rem,9rem)_minmax(10rem,1fr)_auto] sm:items-center"
							>
								<div className="flex min-w-0 items-center gap-2">
									<span
										className={`h-2 w-2 shrink-0 rounded-full ${
											statusPresentation.className
										} ${statusPresentation.pulse ? "animate-pulse" : ""}`}
										aria-label={`${key.name || t("providers.apiKeyNamed", { index: index + 1 })}: ${label}`}
										title={label}
									/>
									<input
										autoComplete="off"
										value={key.name}
										onChange={(event) =>
											update(index, { name: event.target.value }, false)
										}
										aria-label={t("providers.apiKeyName", { index: index + 1 })}
										placeholder={
											index === 0
												? t("providers.primary")
												: t("providers.backup", { index })
										}
										className="min-w-0 flex-1 rounded-md border border-border bg-surface-alt px-3 py-2 text-xs font-medium text-text-secondary placeholder:text-text-muted"
									/>
								</div>
								<div className="joined-input-control flex min-w-0 overflow-hidden rounded-md border border-border bg-surface-alt">
									<input
										autoComplete="off"
										type={isRevealed ? "text" : "password"}
										value={key.value}
										onChange={(event) =>
											update(index, { value: event.target.value }, true)
										}
										placeholder={keyHintFor(protocol)}
										aria-label={t("providers.apiKeyValue", {
											index: index + 1,
										})}
										className="min-w-0 flex-1 bg-transparent px-3 py-2 font-mono text-xs text-text-primary outline-none placeholder:text-text-muted"
									/>
									<button
										type="button"
										onClick={() => toggleReveal(key.id)}
										aria-label={
											isRevealed
												? t("providers.hideKeyNamed", { index: index + 1 })
												: t("providers.showKeyNamed", { index: index + 1 })
										}
										title={
											isRevealed
												? t("providers.hideKey")
												: t("providers.showKey")
										}
										className="flex w-9 items-center justify-center border-l border-border bg-transparent text-text-muted hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none"
									>
										{isRevealed ? (
											<EyeOff className="h-3.5 w-3.5" />
										) : (
											<Eye className="h-3.5 w-3.5" />
										)}
									</button>
								</div>
								<div className="flex items-center justify-end gap-1">
									<button
										type="button"
										role="switch"
										aria-checked={key.enabled}
										aria-label={
											key.enabled
												? t("providers.disableKeyNamed", { index: index + 1 })
												: t("providers.enableKeyNamed", { index: index + 1 })
										}
										title={
											key.enabled
												? t("providers.disableKey")
												: t("providers.enableKey")
										}
										onClick={() =>
											update(index, { enabled: !key.enabled }, true)
										}
										className={`flex h-5 w-9 shrink-0 items-center rounded-full px-0.5 ${
											key.enabled ? "justify-end bg-accent" : "bg-border"
										}`}
									>
										<span className="h-4 w-4 rounded-full bg-white" />
									</button>
									<button
										type="button"
										onClick={() => move(index, index - 1)}
										disabled={index === 0}
										aria-label={t("providers.moveKeyUp", { index: index + 1 })}
										title={t("common.moveUp")}
										className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-surface-hover disabled:opacity-25"
									>
										<ArrowUp className="h-3.5 w-3.5" />
									</button>
									<button
										type="button"
										onClick={() => move(index, index + 1)}
										disabled={index === keys.length - 1}
										aria-label={t("providers.moveKeyDown", {
											index: index + 1,
										})}
										title={t("common.moveDown")}
										className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-surface-hover disabled:opacity-25"
									>
										<ArrowDown className="h-3.5 w-3.5" />
									</button>
									<button
										type="button"
										onClick={() =>
											onChange(
												keys.filter((_, keyIndex) => keyIndex !== index),
												true,
											)
										}
										aria-label={t("providers.removeKeyNamed", {
											index: index + 1,
										})}
										title={t("providers.removeKey")}
										className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-danger-bg hover:text-danger"
									>
										<Trash2 className="h-3.5 w-3.5" />
									</button>
								</div>
							</div>
						);
					})
				)}
			</div>
			<div className="mt-3 flex items-center justify-between gap-3">
				<p className="flex items-center gap-1.5 text-xs text-text-muted">
					<Info className="h-3.5 w-3.5" />
					{t("providers.keysEncryptedHelp")}
				</p>
				<button
					type="button"
					onClick={() =>
						onChange([...keys, createProviderAPIKey(keys.length + 1)], true)
					}
					disabled={keys.length >= MAX_PROVIDER_API_KEYS}
					className="flex shrink-0 items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs text-text-secondary hover:bg-surface-hover hover:text-text-primary disabled:opacity-40"
				>
					<Plus className="h-3.5 w-3.5" />
					{t("providers.addKey")}
				</button>
			</div>
		</>
	);
}

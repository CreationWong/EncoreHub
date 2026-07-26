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
import type {
	ProviderKeyValidationResult,
	ProviderProtocol,
} from "../../services/providers";
import {
	MAX_PROVIDER_API_KEYS,
	type ProviderAPIKey,
	createProviderAPIKey,
} from "./providerKeys";

interface Props {
	keys: ProviderAPIKey[];
	protocol: ProviderProtocol;
	results?: Record<string, ProviderKeyValidationResult>;
	validating?: boolean;
	onChange: (keys: ProviderAPIKey[], connectionChanged: boolean) => void;
}

function resultLabel(result?: ProviderKeyValidationResult): string {
	if (!result) return "Not tested";
	if (result.status === "valid") return "Key is valid";
	if (result.status === "invalid") return "Key was rejected";
	if (result.status === "skipped") return "Key is disabled";
	return result.error_category
		? `Validation failed: ${result.error_category.replaceAll("_", " ")}`
		: "Validation failed";
}

export default function ProviderKeyPoolEditor({
	keys,
	protocol,
	results = {},
	validating = false,
	onChange,
}: Props) {
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
						No API keys configured
					</div>
				) : (
					keys.map((key, index) => {
						const isRevealed = revealed.has(key.id);
						const result = results[key.id];
						const label =
							validating && key.enabled ? "Testing key" : resultLabel(result);
						return (
							<div
								key={key.id}
								className="grid gap-2 border-b border-border p-3 last:border-b-0 sm:grid-cols-[minmax(6rem,9rem)_minmax(10rem,1fr)_auto] sm:items-center"
							>
								<div className="flex min-w-0 items-center gap-2">
									<span
										className={`h-2 w-2 shrink-0 rounded-full ${
											validating && key.enabled
												? "animate-pulse bg-accent"
												: result?.status === "valid"
													? "bg-success"
													: result?.status === "invalid"
														? "bg-danger"
														: result?.status === "error"
															? "bg-warning"
															: "bg-border"
										}`}
										aria-label={`${key.name || `API key ${index + 1}`}: ${label}`}
										title={label}
									/>
									<input
										value={key.name}
										onChange={(event) =>
											update(index, { name: event.target.value }, false)
										}
										aria-label={`API key ${index + 1} name`}
										placeholder={index === 0 ? "Primary" : `Backup ${index}`}
										className="min-w-0 flex-1 rounded-md border border-border bg-surface-alt px-3 py-2 text-xs font-medium text-text-secondary placeholder:text-text-muted"
									/>
								</div>
								<div className="flex min-w-0">
									<input
										type={isRevealed ? "text" : "password"}
										value={key.value}
										onChange={(event) =>
											update(index, { value: event.target.value }, true)
										}
										placeholder={keyHintFor(protocol)}
										aria-label={`API key ${index + 1} value`}
										className="min-w-0 flex-1 rounded-l-md border border-border bg-surface-alt px-3 py-2 font-mono text-xs text-text-primary placeholder:text-text-muted"
									/>
									<button
										type="button"
										onClick={() => toggleReveal(key.id)}
										aria-label={`${isRevealed ? "Hide" : "Show"} API key ${index + 1}`}
										title={isRevealed ? "Hide key" : "Show key"}
										className="flex w-9 items-center justify-center rounded-r-md border border-l-0 border-border bg-surface-alt text-text-muted hover:bg-surface-hover hover:text-text-primary"
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
										aria-label={`${key.enabled ? "Disable" : "Enable"} API key ${index + 1}`}
										title={key.enabled ? "Disable key" : "Enable key"}
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
										aria-label={`Move API key ${index + 1} up`}
										title="Move up"
										className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-surface-hover disabled:opacity-25"
									>
										<ArrowUp className="h-3.5 w-3.5" />
									</button>
									<button
										type="button"
										onClick={() => move(index, index + 1)}
										disabled={index === keys.length - 1}
										aria-label={`Move API key ${index + 1} down`}
										title="Move down"
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
										aria-label={`Remove API key ${index + 1}`}
										title="Remove API key"
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
					Key values are encrypted together and never stored in the provider
					profile.
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
					Add API key
				</button>
			</div>
		</>
	);
}

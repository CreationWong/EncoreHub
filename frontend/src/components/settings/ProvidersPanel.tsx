import { Eye, EyeOff, Trash2 } from "lucide-react";
import { useState } from "react";
import { PROVIDERS } from "../../constants/providers";
import { useSettingsStore } from "../../stores/settingsStore";

export default function ProvidersPanel() {
	const provider = useSettingsStore((s) => s.provider);
	const model = useSettingsStore((s) => s.model);
	const apiKeys = useSettingsStore((s) => s.apiKeys);
	const setProvider = useSettingsStore((s) => s.setProvider);
	const setModel = useSettingsStore((s) => s.setModel);
	const setApiKey = useSettingsStore((s) => s.setApiKey);
	const clearApiKey = useSettingsStore((s) => s.clearApiKey);

	const [reveal, setReveal] = useState<Record<string, boolean>>({});

	return (
		<div className="space-y-6">
			<section>
				<h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
					Active provider
				</h3>
				<div className="flex flex-wrap gap-2">
					{PROVIDERS.map((p) => (
						<button
							key={p.id}
							type="button"
							disabled={p.disabled}
							onClick={() => setProvider(p.id, p.models[0])}
							title={p.disabledReason ?? undefined}
							className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
								provider === p.id
									? "border-accent bg-accent/10 text-accent"
									: "border-border text-text-secondary hover:bg-surface-hover"
							} ${p.disabled ? "cursor-not-allowed opacity-40 hover:bg-transparent" : ""}`}
						>
							{p.name}
							{p.disabled && (
								<span className="ml-1 text-[10px] uppercase">soon</span>
							)}
						</button>
					))}
				</div>
				{provider && (
					<div className="mt-3">
						<label
							className="block text-xs text-text-muted"
							htmlFor="model-select"
						>
							Model
						</label>
						<select
							id="model-select"
							value={model}
							onChange={(e) => setModel(e.target.value)}
							className="mt-1 w-full rounded-lg border border-border bg-surface-alt px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
						>
							{PROVIDERS.find((p) => p.id === provider)?.models.map((m) => (
								<option key={m} value={m}>
									{m}
								</option>
							))}
						</select>
					</div>
				)}
			</section>

			<section>
				<h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
					API keys
				</h3>
				<p className="mb-3 text-xs text-text-muted">
					Stored in memory by default. Set{" "}
					<code className="rounded bg-surface-alt px-1">
						localStorage.encorehub-persist-keys = "1"
					</code>{" "}
					in DevTools to persist (desktop dev only).
				</p>
				<div className="space-y-3">
					{PROVIDERS.filter((p) => p.id !== "ollama" && !p.disabled).map(
						(p) => {
							const value = apiKeys[p.id] ?? "";
							const isShown = reveal[p.id];
							return (
								<div key={p.id} className="space-y-1">
									<label
										htmlFor={`key-${p.id}`}
										className="text-xs font-medium text-text-secondary"
									>
										{p.name}
									</label>
									<div className="flex gap-2">
										<input
											id={`key-${p.id}`}
											type={isShown ? "text" : "password"}
											value={value}
											onChange={(e) => setApiKey(p.id, e.target.value)}
											placeholder={p.keyHint ?? `${p.id} API key`}
											className="flex-1 rounded-lg border border-border bg-surface-alt px-3 py-2 font-mono text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50"
										/>
										<button
											type="button"
											onClick={() =>
												setReveal((s) => ({ ...s, [p.id]: !s[p.id] }))
											}
											className="rounded-lg border border-border px-2 text-text-muted hover:bg-surface-hover hover:text-text-primary"
											title={isShown ? "Hide" : "Show"}
										>
											{isShown ? (
												<EyeOff className="h-3.5 w-3.5" />
											) : (
												<Eye className="h-3.5 w-3.5" />
											)}
										</button>
										{value && (
											<button
												type="button"
												onClick={() => clearApiKey(p.id)}
												className="rounded-lg border border-border px-2 text-text-muted hover:bg-red-500/10 hover:text-red-400"
												title="Clear"
											>
												<Trash2 className="h-3.5 w-3.5" />
											</button>
										)}
									</div>
								</div>
							);
						},
					)}
				</div>
			</section>
		</div>
	);
}

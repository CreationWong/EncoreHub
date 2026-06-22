import { ChevronDown, Cpu } from "lucide-react";
import { useState } from "react";
import { useProviderStore } from "../../stores/providerStore";
import { useSettingsStore } from "../../stores/settingsStore";

export default function ProviderSwitcher() {
	const provider = useSettingsStore((s) => s.provider);
	const model = useSettingsStore((s) => s.model);
	const setProvider = useSettingsStore((s) => s.setProvider);
	const profiles = useProviderStore((s) => s.profiles);

	const [expanded, setExpanded] = useState(false);

	// Only enabled providers are selectable.
	const enabled = profiles.filter((p) => p.enabled);
	const selectedProvider = profiles.find((p) => p.id === provider);
	const displayName = selectedProvider?.name || "Select Provider";

	return (
		<div className="border-t border-border p-3">
			<div className="relative">
				<button
					type="button"
					onClick={() => setExpanded(!expanded)}
					className="flex items-center justify-between w-full rounded-lg px-3 py-2 text-xs font-medium text-text-secondary hover:bg-surface-hover transition-colors"
				>
					<div className="flex items-center gap-2">
						<Cpu className="h-3.5 w-3.5" />
						<span>{displayName}</span>
						{model && <span className="text-text-muted">/ {model}</span>}
					</div>
					<ChevronDown
						className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
					/>
				</button>

				{expanded && (
					<div className="absolute bottom-full left-0 right-0 mb-1 rounded-lg border border-border bg-surface shadow-lg p-1 z-50">
						{enabled.length === 0 && (
							<p className="px-3 py-2 text-xs text-text-muted">
								No providers configured
							</p>
						)}
						{enabled.map((p) => (
							<div key={p.id}>
								<button
									type="button"
									className={`w-full text-left px-3 py-1.5 rounded text-xs font-medium ${
										provider === p.id
											? "bg-accent/10 text-accent"
											: "text-text-secondary hover:bg-surface-hover"
									}`}
									onClick={() => {
										setProvider(p.id, p.models[0]);
										setExpanded(false);
									}}
								>
									{p.name}
								</button>
								{provider === p.id && (
									<div className="ml-4 mb-1 space-y-0.5">
										{p.models.map((m) => (
											<button
												key={m}
												type="button"
												className={`block w-full text-left px-3 py-1 rounded text-xs ${
													model === m
														? "text-accent font-medium"
														: "text-text-muted hover:text-text-secondary"
												}`}
												onClick={() => setProvider(p.id, m)}
											>
												{m}
											</button>
										))}
									</div>
								)}
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	);
}

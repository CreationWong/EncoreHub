import { ChevronDown, Cpu } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useProviderStore } from "../../stores/providerStore";
import { useSettingsStore } from "../../stores/settingsStore";

export default function ProviderSwitcher() {
	const provider = useSettingsStore((state) => state.provider);
	const model = useSettingsStore((state) => state.model);
	const setProvider = useSettingsStore((state) => state.setProvider);
	const profiles = useProviderStore((state) => state.profiles);
	const enabled = profiles.filter((profile) => profile.enabled);
	const selectedProvider = profiles.find((profile) => profile.id === provider);
	const [expanded, setExpanded] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const providerName = selectedProvider?.name ?? "Select provider";
	const selection = model ? `${providerName} · ${model}` : providerName;

	useEffect(() => {
		if (!expanded) return;
		const closeOutside = (event: PointerEvent) => {
			if (!rootRef.current?.contains(event.target as Node)) setExpanded(false);
		};
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			setExpanded(false);
			triggerRef.current?.focus();
		};
		document.addEventListener("pointerdown", closeOutside);
		window.addEventListener("keydown", closeOnEscape);
		return () => {
			document.removeEventListener("pointerdown", closeOutside);
			window.removeEventListener("keydown", closeOnEscape);
		};
	}, [expanded]);

	return (
		<div ref={rootRef} className="relative min-w-0">
			<button
				ref={triggerRef}
				type="button"
				onClick={() => setExpanded((value) => !value)}
				aria-label="Select provider and model"
				aria-haspopup="menu"
				aria-expanded={expanded}
				title={selection}
				className="flex h-8 max-w-full items-center gap-2 rounded-md border border-border bg-control px-2.5 text-xs text-text-secondary hover:text-text-primary"
			>
				<Cpu className="h-3.5 w-3.5 shrink-0" />
				<span className="truncate">{selection}</span>
				<ChevronDown
					className={`h-3.5 w-3.5 shrink-0 transition-transform ${
						expanded ? "rotate-180" : ""
					}`}
				/>
			</button>

			{expanded && (
				<div
					role="menu"
					aria-label="Provider and model"
					className="absolute right-0 top-full z-50 mt-2 max-h-80 w-72 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-md border border-border bg-workspace p-1 shadow-lg"
				>
					{enabled.length === 0 && (
						<p className="px-3 py-3 text-xs text-text-muted">
							No providers configured
						</p>
					)}
					{enabled.map((profile) => (
						<div key={profile.id} className="py-0.5">
							<button
								type="button"
								role="menuitem"
								onClick={() => {
									setProvider(profile.id, profile.models[0]);
									if (profile.models.length <= 1) setExpanded(false);
								}}
								className={`flex h-8 w-full items-center rounded px-2 text-left text-sm font-medium ${
									provider === profile.id
										? "bg-control text-text-primary"
										: "text-text-secondary hover:bg-control hover:text-text-primary"
								}`}
							>
								<span className="truncate">{profile.name}</span>
							</button>
							{provider === profile.id && profile.models.length > 0 && (
								<div className="ml-5 border-l border-border pl-1">
									{profile.models.map((profileModel) => (
										<button
											key={profileModel}
											type="button"
											role="menuitemradio"
											aria-checked={model === profileModel}
											onClick={() => {
												setProvider(profile.id, profileModel);
												setExpanded(false);
											}}
											className={`block h-7 w-full truncate rounded px-2 text-left text-xs ${
												model === profileModel
													? "text-accent"
													: "text-text-muted hover:bg-control hover:text-text-secondary"
											}`}
											title={profileModel}
										>
											{profileModel}
										</button>
									))}
								</div>
							)}
						</div>
					))}
				</div>
			)}
		</div>
	);
}

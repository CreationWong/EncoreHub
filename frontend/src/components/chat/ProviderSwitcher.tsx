import {
	AlertTriangle,
	Check,
	ChevronDown,
	Cpu,
	Loader2,
	Settings2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { providerChatModels } from "../../services/providers";
import { useConversationStore } from "../../stores/conversationStore";
import { useProviderStore } from "../../stores/providerStore";
import { useSettingsStore } from "../../stores/settingsStore";

function getMenuItems(menu: HTMLDivElement | null): HTMLElement[] {
	if (!menu) return [];
	return Array.from(
		menu.querySelectorAll<HTMLElement>(
			'[role="menuitemradio"], [role="menuitem"]',
		),
	);
}

export default function ProviderSwitcher() {
	const defaultProvider = useSettingsStore((state) => state.provider);
	const defaultModel = useSettingsStore((state) => state.model);
	const setProvider = useSettingsStore((state) => state.setProvider);
	const openSettings = useSettingsStore((state) => state.openSettings);
	const profiles = useProviderStore((state) => state.profiles);
	const providerLoading = useProviderStore((state) => state.loading);
	const activeId = useConversationStore((state) => state.activeId);
	const conversations = useConversationStore((state) => state.conversations);
	const updateConversationModel = useConversationStore(
		(state) => state.updateConversationModel,
	);
	const [expanded, setExpanded] = useState(false);
	const [updating, setUpdating] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);

	const activeConversation = activeId
		? conversations.find((item) => item.id === activeId)
		: undefined;
	const provider = activeId
		? (activeConversation?.provider ?? "")
		: defaultProvider;
	const model = activeId ? (activeConversation?.model ?? "") : defaultModel;
	const selectedProfile = profiles.find((profile) => profile.id === provider);
	const enabledProfiles = profiles.filter(
		(profile) => profile.enabled && providerChatModels(profile).length > 0,
	);
	const providerName =
		selectedProfile?.name ||
		provider ||
		(activeId ? "Conversation provider unavailable" : "Select provider");
	const modelName = model || "Select model";
	const selection = [providerName, modelName].join(" · ");
	const currentModelAvailable = Boolean(
		selectedProfile?.enabled &&
			model &&
			providerChatModels(selectedProfile).includes(model),
	);
	const unavailable = Boolean(
		(activeId && !activeConversation) ||
			(provider && model && !currentModelAvailable),
	);
	const contextLabel = activeId
		? "Current conversation"
		: "New conversation default";
	const triggerLabel = [
		activeId
			? "Select current conversation provider and model"
			: "Select default provider and model",
		`${contextLabel}: ${selection}`,
		unavailable ? "Current model unavailable" : "",
	]
		.filter(Boolean)
		.join(". ");

	const focusMenuItem = (position: "first" | "last") => {
		const items = getMenuItems(menuRef.current);
		const target = position === "first" ? items[0] : items.at(-1);
		target?.focus();
	};

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

	const chooseModel = async (nextProvider: string, nextModel: string) => {
		setExpanded(false);
		if (provider === nextProvider && model === nextModel) {
			triggerRef.current?.focus();
			return;
		}

		if (!activeId) {
			setProvider(nextProvider, nextModel);
			triggerRef.current?.focus();
			return;
		}

		setUpdating(true);
		try {
			await updateConversationModel(activeId, nextProvider, nextModel);
		} finally {
			setUpdating(false);
			triggerRef.current?.focus();
		}
	};

	return (
		<div ref={rootRef} className="relative w-fit max-w-full min-w-0">
			<button
				ref={triggerRef}
				type="button"
				onClick={() => setExpanded((value) => !value)}
				onKeyDown={(event) => {
					if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
					event.preventDefault();
					setExpanded(true);
					requestAnimationFrame(() =>
						focusMenuItem(event.key === "ArrowDown" ? "first" : "last"),
					);
				}}
				aria-label={triggerLabel}
				aria-haspopup="menu"
				aria-expanded={expanded}
				aria-busy={updating}
				title={triggerLabel}
				disabled={updating}
				className="flex h-9 w-fit max-w-full min-w-0 items-center gap-1.5 rounded-md px-2 text-xs text-text-secondary transition-colors hover:bg-control hover:text-text-primary disabled:cursor-wait disabled:opacity-70"
			>
				{updating ? (
					<Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
				) : (
					<Cpu className="h-3.5 w-3.5 shrink-0" />
				)}
				<span className="hidden min-w-0 max-w-32 truncate min-[1200px]:block">
					{providerName}
				</span>
				<span
					aria-hidden="true"
					className="hidden shrink-0 text-text-muted min-[1200px]:block"
				>
					·
				</span>
				<span className="min-w-0 max-w-80 truncate font-medium text-text-primary">
					{modelName}
				</span>
				{unavailable && (
					<AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" />
				)}
				<ChevronDown
					className={`h-3.5 w-3.5 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
				/>
			</button>

			{expanded && (
				<div
					ref={menuRef}
					role="menu"
					aria-label="Provider and model"
					onKeyDown={(event) => {
						if (
							event.key !== "ArrowDown" &&
							event.key !== "ArrowUp" &&
							event.key !== "Home" &&
							event.key !== "End"
						)
							return;
						event.preventDefault();
						const items = getMenuItems(menuRef.current);
						if (items.length === 0) return;
						const current = items.indexOf(
							document.activeElement as HTMLElement,
						);
						const next =
							event.key === "Home"
								? 0
								: event.key === "End"
									? items.length - 1
									: (current +
											(event.key === "ArrowDown" ? 1 : -1) +
											items.length) %
										items.length;
						items[next]?.focus();
					}}
					className="absolute right-0 top-full z-50 mt-2 max-h-80 w-80 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-md border border-border bg-workspace p-1 shadow-lg"
				>
					<p className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium text-text-muted">
						{activeId
							? "Current conversation model"
							: "New conversation default"}
					</p>
					{unavailable && (
						<p className="mx-1 mb-1 rounded bg-warning-bg px-2 py-1.5 text-[11px] text-warning">
							Current model unavailable
						</p>
					)}
					{providerLoading && profiles.length === 0 && (
						<p className="px-2.5 py-3 text-xs text-text-muted">
							Loading providers...
						</p>
					)}
					{!providerLoading && enabledProfiles.length === 0 && (
						<p className="px-2.5 py-3 text-xs text-text-muted">
							No providers available
						</p>
					)}
					{enabledProfiles.map((profile) => {
						const chatModels = providerChatModels(profile);
						return (
							<fieldset
								key={profile.id}
								aria-label={profile.name}
								className="m-0 border-0 p-0 py-0.5"
							>
								<legend className="flex h-7 w-full items-center px-2 text-xs font-medium text-text-secondary">
									<span className="truncate">{profile.name}</span>
								</legend>
								{chatModels.length === 0 ? (
									<p className="px-4 py-1.5 text-[11px] text-text-muted">
										No models configured
									</p>
								) : (
									chatModels.map((profileModel) => {
										const selected =
											provider === profile.id && model === profileModel;
										return (
											<button
												key={profileModel}
												type="button"
												role="menuitemradio"
												aria-checked={selected}
												onClick={() =>
													void chooseModel(profile.id, profileModel)
												}
												className="flex h-8 w-full min-w-0 items-center gap-2 rounded px-2 text-left text-xs text-text-secondary hover:bg-control hover:text-text-primary"
												title={profileModel}
											>
												<Check
													className={`h-3.5 w-3.5 shrink-0 text-accent ${selected ? "opacity-100" : "opacity-0"}`}
												/>
												<span className="truncate">{profileModel}</span>
											</button>
										);
									})
								)}
							</fieldset>
						);
					})}
					<div className="my-1 border-t border-border" />
					<button
						type="button"
						role="menuitem"
						onClick={() => {
							setExpanded(false);
							openSettings("providers");
						}}
						className="flex h-8 w-full items-center gap-2 rounded px-2 text-xs text-text-secondary hover:bg-control hover:text-text-primary"
					>
						<Settings2 className="h-3.5 w-3.5" />
						Provider settings
					</button>
				</div>
			)}
		</div>
	);
}

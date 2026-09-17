// Conversation context side panel.
//
// Shows how the next provider request is assembled (system sections, tools,
// transcript), lets the user compact history, tune sampling parameters, and
// choose the math rendering engine. Tabs are data-driven so new sections can
// be added without restructuring the tab list.

import {
	BrainCircuit,
	Check,
	ChevronDown,
	ChevronUp,
	CircleDollarSign,
	Gauge,
	Layers3,
	MessageSquareText,
	Scissors,
	Sigma,
	SlidersHorizontal,
	Sparkles,
	Wrench,
	X,
	Zap,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { modelKeyFor } from "../../services/tokenModel";
import {
	type ContextPanelTab,
	MANUAL_COMPACT_BUFFER_TOKENS,
	autoCompactReserve,
	autoCompactThreshold,
	estimateContextUsage,
	useContextManagementStore,
} from "../../stores/contextManagementStore";
import { useConversationStore } from "../../stores/conversationStore";
import {
	modelMetadataForId,
	useModelMetadataStore,
} from "../../stores/modelMetadataStore";
import { useProviderStore } from "../../stores/providerStore";
import {
	type MathRenderer,
	useSettingsStore,
} from "../../stores/settingsStore";
import ContextMeter from "./ContextMeter";
import CurrentMemoryPanel from "./CurrentMemoryPanel";
import { formatTokens } from "./contextMeterDisplay";

/** Tab order and labels for the panel header. */
const TABS: { id: ContextPanelTab; label: string; icon: typeof Gauge }[] = [
	{ id: "context", label: "Context", icon: Gauge },
	{ id: "memory", label: "Memory", icon: BrainCircuit },
	{ id: "parameters", label: "Parameters", icon: SlidersHorizontal },
	{ id: "rendering", label: "Rendering", icon: Sigma },
];

/** Math engines offered on the rendering tab, matching Settings → Appearance. */
const MATH_RENDERERS: { id: MathRenderer; label: string; detail: string }[] = [
	{
		id: "katex",
		label: "KaTeX",
		detail: "Fast server-style typesetting with bundled fonts.",
	},
	{
		id: "mathjax",
		label: "MathJax",
		detail: "Self-contained SVG output with broader TeX coverage.",
	},
	{
		id: "off",
		label: "Off",
		detail: "Leave LaTeX delimiters as plain text.",
	},
];

/** Format a usage cost using the provider-reported currency. */
function formatCost(value: number, currency: string): string {
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency,
		minimumFractionDigits: 4,
		maximumFractionDigits: 6,
	}).format(value);
}

/** Labeled checkbox rendered as the panel's compact switch control. */
function Toggle({
	checked,
	label,
	description,
	onChange,
}: {
	checked: boolean;
	label: string;
	description?: string;
	onChange: (checked: boolean) => void;
}) {
	return (
		<label className="flex cursor-pointer items-center justify-between gap-4 py-2">
			<span className="min-w-0">
				<span className="block text-xs font-medium text-text-primary">
					{label}
				</span>
				{description && (
					<span className="mt-0.5 block text-[11px] leading-4 text-text-muted">
						{description}
					</span>
				)}
			</span>
			<input
				autoComplete="off"
				type="checkbox"
				checked={checked}
				onChange={(event) => onChange(event.target.checked)}
				className="peer sr-only"
			/>
			<span className="relative h-5 w-9 shrink-0 rounded-full bg-control transition-colors peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent/40">
				<span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4" />
			</span>
		</label>
	);
}

/** Numeric field plus range slider that stay clamped to the declared bounds. */
function NumberSlider({
	id,
	label,
	value,
	min,
	max,
	step,
	onChange,
}: {
	id: string;
	label: string;
	value: number;
	min: number;
	max: number;
	step: number;
	onChange: (value: number) => void;
}) {
	const update = (candidate: number) => {
		if (!Number.isFinite(candidate)) return;
		onChange(Math.min(max, Math.max(min, candidate)));
	};

	return (
		<div className="space-y-2 py-2.5">
			<div className="flex items-center justify-between gap-3">
				<label htmlFor={id} className="text-xs font-medium text-text-primary">
					{label}
				</label>
				<input
					autoComplete="off"
					type="number"
					value={value}
					min={min}
					max={max}
					step={step}
					onChange={(event) => update(Number(event.target.value))}
					className="h-7 w-20 rounded-md border border-border bg-surface px-2 text-right text-xs tabular-nums text-text-primary outline-none focus:border-accent"
				/>
			</div>
			<input
				autoComplete="off"
				id={id}
				type="range"
				value={value}
				min={min}
				max={max}
				step={step}
				onChange={(event) => update(Number(event.target.value))}
				className="h-1.5 w-full cursor-pointer accent-accent"
			/>
		</div>
	);
}

/** Presents provider-input context separately from the transcript kept by Engine. */
export default function ContextManagementPanel() {
	const activeId = useConversationStore((state) => state.activeId);
	const conversations = useConversationStore((state) => state.conversations);
	const messages = useConversationStore((state) => state.messages);
	const defaultProvider = useSettingsStore((state) => state.provider);
	const defaultModel = useSettingsStore((state) => state.model);
	const profiles = useProviderStore((state) => state.profiles);
	const open = useContextManagementStore((state) => state.contextPanelOpen);
	const tab = useContextManagementStore((state) => state.contextPanelTab);
	const setTab = useContextManagementStore((state) => state.setContextPanelTab);
	const autoCompact = useContextManagementStore((state) => state.autoCompact);
	const setAutoCompact = useContextManagementStore(
		(state) => state.setAutoCompact,
	);
	const advanced = useContextManagementStore((state) => state.advanced);
	const setAdvanced = useContextManagementStore((state) => state.setAdvanced);
	const compactions = useContextManagementStore((state) => state.compactions);
	const compactConversation = useContextManagementStore(
		(state) => state.compactConversation,
	);
	const clearCompaction = useContextManagementStore(
		(state) => state.clearCompaction,
	);
	const records = useContextManagementStore((state) => state.records);
	const setContextPanelOpen = useContextManagementStore(
		(state) => state.setContextPanelOpen,
	);
	const mathRenderer = useSettingsStore((state) => state.mathRenderer);
	const setMathRenderer = useSettingsStore((state) => state.setMathRenderer);
	const contextMeterPrimary = useSettingsStore(
		(state) => state.contextMeterPrimary,
	);
	const contextMeterMetrics = useSettingsStore(
		(state) => state.contextMeterMetrics,
	);
	const openSettings = useSettingsStore((state) => state.openSettings);
	const [summaryExpanded, setSummaryExpanded] = useState(false);
	const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

	const conversation = conversations.find((item) => item.id === activeId);
	const providerId = conversation?.provider || defaultProvider;
	const modelId = conversation?.model || defaultModel;
	const profile = profiles.find((item) => item.id === providerId);
	const modelConfig = profile?.model_configs?.find(
		(item) => item.id === modelId,
	);
	const compaction = activeId ? compactions[activeId] : undefined;
	const metadataProviders = useModelMetadataStore((state) => state.providers);
	const metadataRecords = useModelMetadataStore(
		(state) => state.recordsByProvider,
	);
	const metadataWindow = useMemo(
		() =>
			modelMetadataForId(
				{ providers: metadataProviders, recordsByProvider: metadataRecords },
				modelId,
			)?.contextWindow,
		[metadataProviders, metadataRecords, modelId],
	);
	// A provider model may omit its window, but the catalog usually knows it.
	// Auto compaction resolves the same fallback, so the displayed percentage
	// always matches the point where the conversation actually compresses.
	const contextWindow = modelConfig?.context_window ?? metadataWindow;
	const reservedTokens = autoCompact
		? autoCompactReserve(advanced.maxCompletionTokens)
		: MANUAL_COMPACT_BUFFER_TOKENS;
	const context = useMemo(
		() =>
			estimateContextUsage(
				messages,
				contextWindow,
				compaction,
				reservedTokens,
				{
					character: conversation?.character_snapshot,
					modelKey: modelKeyFor(providerId, modelId),
				},
			),
		[
			messages,
			contextWindow,
			compaction,
			reservedTokens,
			conversation?.character_snapshot,
			providerId,
			modelId,
		],
	);
	const lastPricedCall = activeId
		? records.find(
				(record) => record.conversationId === activeId && record.cost != null,
			)
		: undefined;
	const maxCompletionTokens = Math.max(
		advanced.maxCompletionTokens,
		modelConfig?.max_output_tokens ?? 32768,
	);
	const compactThresholdTokens =
		autoCompact && context.limit
			? autoCompactThreshold(context.limit, advanced.maxCompletionTokens)
			: null;
	const compactThresholdShare =
		compactThresholdTokens != null && context.limit
			? Math.round((compactThresholdTokens / context.limit) * 100)
			: null;
	// Provider requests carry either the transcript or the recent tail kept by
	// the active compaction, so the count mirrors what the next call includes.
	const retainedMessageCount = compaction?.summary
		? Math.min(compaction.keepRecent, messages.length)
		: messages.length;
	const autoCompactDescription =
		autoCompact && context.limit != null
			? compactThresholdTokens != null && compactThresholdTokens > 0
				? `Compresses automatically at about ${compactThresholdShare}% (${formatTokens(compactThresholdTokens)} tokens).`
				: "Compresses as soon as this model window allows; the reply reserve exceeds the window."
			: "Compact before the model runs out of safe working space.";

	if (!open) return null;

	const breakdown = [
		{
			label: "System prompt",
			value: context.categories.system,
			icon: Zap,
			tone: "bg-accent",
			detail:
				"Character instructions, current date/time, and compaction summary.",
		},
		{
			label: "Tools",
			value: context.categories.tools,
			icon: Wrench,
			tone: "bg-success",
			detail:
				"Tool definitions and tool call payloads included in the request.",
		},
		{
			label: "Skills",
			value: context.categories.skills,
			icon: Sparkles,
			tone: "bg-info",
			detail: "Skill instruction text injected by the gateway.",
		},
		{
			label: "Messages",
			value: context.categories.messages,
			icon: MessageSquareText,
			tone: "bg-warning",
			detail: "Visible conversation history sent to the model.",
		},
		{
			label: "Other request data",
			value: context.categories.other,
			icon: Layers3,
			// Protocol overhead must remain distinct from the neutral progress track.
			tone: "bg-text-muted",
			detail:
				"Protocol and formatting overhead the estimator cannot attribute.",
		},
	] as const;

	return (
		<aside
			aria-label="Context management"
			className="absolute inset-y-0 right-0 z-30 flex w-[min(22rem,calc(100%-1rem))] shrink-0 flex-col border-l border-border bg-workspace shadow-2xl min-[900px]:relative min-[900px]:z-auto min-[900px]:w-[22rem] min-[900px]:shadow-none"
		>
			<header className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-2">
				<div
					role="tablist"
					aria-label="Context panel sections"
					className="context-tab-strip flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
				>
					{TABS.map((item, index) => {
						const active = tab === item.id;
						const Icon = item.icon;
						return (
							<button
								key={item.id}
								ref={(element) => {
									tabRefs.current[index] = element;
								}}
								type="button"
								role="tab"
								id={`context-tab-${item.id}`}
								aria-selected={active}
								aria-controls={`context-panel-${item.id}`}
								tabIndex={active ? 0 : -1}
								title={item.label}
								onClick={() => {
									setTab(item.id);
									tabRefs.current[index]?.scrollIntoView?.({
										block: "nearest",
										inline: "nearest",
									});
								}}
								onKeyDown={(event) => {
									if (
										event.key !== "ArrowLeft" &&
										event.key !== "ArrowRight" &&
										event.key !== "Home" &&
										event.key !== "End"
									)
										return;
									event.preventDefault();
									const nextIndex =
										event.key === "Home"
											? 0
											: event.key === "End"
												? TABS.length - 1
												: (index +
														(event.key === "ArrowRight" ? 1 : -1) +
														TABS.length) %
													TABS.length;
									setTab(TABS[nextIndex].id);
									tabRefs.current[nextIndex]?.focus();
									tabRefs.current[nextIndex]?.scrollIntoView?.({
										block: "nearest",
										inline: "nearest",
									});
								}}
								className={`flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors ${
									active
										? "bg-selected text-text-primary"
										: "text-text-muted hover:bg-control hover:text-text-primary"
								}`}
							>
								<Icon className="h-3.5 w-3.5 shrink-0" />
								<span>{item.label}</span>
							</button>
						);
					})}
				</div>
				<button
					type="button"
					onClick={() => setContextPanelOpen(false)}
					aria-label="Close context panel"
					title="Close context panel"
					className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-control hover:text-text-primary"
				>
					<X className="h-4 w-4" />
				</button>
			</header>

			{tab === "memory" ? (
				<div
					role="tabpanel"
					id="context-panel-memory"
					aria-labelledby="context-tab-memory"
					className="flex min-h-0 flex-1 flex-col"
				>
					<CurrentMemoryPanel />
				</div>
			) : tab === "context" ? (
				<div
					role="tabpanel"
					id="context-panel-context"
					aria-labelledby="context-tab-context"
					className="min-h-0 flex-1 overflow-y-auto"
				>
					<section className="border-b border-border px-4 py-4">
						<p className="truncate text-[11px] font-medium text-text-muted">
							{profile?.name || providerId || "No provider"}
						</p>
						<h2 className="mt-0.5 truncate text-sm font-semibold text-text-primary">
							{modelConfig?.name || modelId || "No model selected"}
						</h2>
						<div className="mt-4">
							<ContextMeter
								used={context.contextTokens}
								limit={context.limit}
								percentage={context.percentage}
								remaining={
									context.limit == null
										? null
										: Math.max(0, context.limit - context.contextTokens)
								}
								primary={contextMeterPrimary}
								metrics={contextMeterMetrics}
							/>
							<button
								type="button"
								onClick={() => openSettings("context-panel")}
								className="mt-2 text-[10px] text-text-muted hover:text-text-primary"
							>
								Customize display
							</button>
						</div>
						{context.percentage != null && context.percentage >= 90 ? (
							<p className="mt-2 text-[11px] font-medium text-danger">
								Almost out of room — compress before sending the next message.
							</p>
						) : context.percentage != null && context.percentage >= 75 ? (
							<p className="mt-2 text-[11px] font-medium text-warning">
								Filling up — compress soon to keep replies accurate.
							</p>
						) : null}
						{!activeId ? (
							<p className="mt-2 text-[11px] leading-4 text-text-muted">
								Select or start a conversation to inspect its context.
							</p>
						) : messages.length === 0 ? (
							<p className="mt-2 text-[11px] leading-4 text-text-muted">
								No messages yet — this meter fills as the conversation
								continues.
							</p>
						) : context.limit == null ? (
							<p className="mt-2 text-[11px] leading-4 text-text-muted">
								Context window unknown — add it to this model or its metadata
								source to see a percentage.
							</p>
						) : null}
						<p
							className="mt-2 text-[10px] tabular-nums text-text-muted"
							title={
								context.source === "provider" &&
								context.snapshotInputTokens != null &&
								context.snapshotOutputTokens != null
									? `${formatTokens(context.snapshotInputTokens)} input · ${formatTokens(context.snapshotOutputTokens)} output retained`
									: context.modelTrusted
										? `Input model fitted from ${context.modelSamples} samples · output model from ${context.outputModelSamples} samples`
										: undefined
							}
						>
							{context.source === "provider" &&
							context.snapshotInputTokens != null &&
							context.snapshotOutputTokens != null
								? "Measured from the latest provider response"
								: context.modelTrusted
									? `Estimated from this conversation · calibrated from ${context.modelSamples} samples`
									: "Estimated from active request content"}
						</p>
					</section>

					<section className="border-b border-border px-4 py-3">
						<h3 className="text-[11px] font-semibold text-text-primary">
							Request contents
						</h3>
						<p className="mt-0.5 text-[10px] text-text-muted">
							{retainedMessageCount} message
							{retainedMessageCount === 1 ? "" : "s"} included in the next
							request
						</p>
						<div className="mt-2 space-y-1">
							{breakdown.map(({ label, value, icon: Icon, tone, detail }) => {
								const share =
									context.contextTokens > 0
										? Math.round((value / context.contextTokens) * 100)
										: 0;
								return (
									<div
										key={label}
										className="grid grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2 py-1.5"
									>
										<Icon className="h-3.5 w-3.5 text-text-muted" />
										<div className="min-w-0">
											<div className="mb-1 flex items-center justify-between gap-2 text-[11px]">
												<span
													className="truncate text-text-secondary"
													title={detail}
												>
													{label}
												</span>
												<span className="shrink-0 tabular-nums text-text-muted">
													{share}%
												</span>
											</div>
											<div className="h-1 overflow-hidden rounded-full bg-control">
												<div
													className={`h-full ${tone}`}
													style={{ width: `${share}%` }}
												/>
											</div>
										</div>
										<span className="w-16 text-right text-[11px] tabular-nums text-text-secondary">
											{formatTokens(value)}
										</span>
									</div>
								);
							})}
						</div>
						{context.freeTokens != null && (
							<div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-[11px]">
								<span
									className="text-text-muted"
									title="Space left in the model window after the compact reserve."
								>
									Free after reserve
								</span>
								<span className="tabular-nums text-text-primary">
									{formatTokens(context.freeTokens)} tokens
								</span>
							</div>
						)}
						{context.reservedTokens > 0 && (
							<div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-[11px]">
								<span
									className="text-text-muted"
									title={
										autoCompact
											? "Tokens held back so auto compact can fit a summary."
											: "Tokens held back so a manual compression still fits."
									}
								>
									{autoCompact
										? "Auto compact reserve"
										: "Manual compact reserve"}
								</span>
								<span className="tabular-nums text-text-primary">
									{formatTokens(context.reservedTokens)} tokens
								</span>
							</div>
						)}
						{lastPricedCall?.cost != null && (
							<div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-[11px]">
								<span className="flex items-center gap-1.5 text-text-muted">
									<CircleDollarSign className="h-3.5 w-3.5" />
									Last call
								</span>
								<span className="tabular-nums font-medium text-text-primary">
									{formatCost(lastPricedCall.cost, lastPricedCall.currency)}
								</span>
							</div>
						)}
					</section>

					<section className="border-b border-border px-4 py-3">
						<Toggle
							checked={autoCompact}
							onChange={setAutoCompact}
							label="Auto compact"
							description={autoCompactDescription}
						/>
						<button
							type="button"
							onClick={() => {
								if (activeId) compactConversation(activeId, messages);
							}}
							disabled={!activeId || messages.length < 4}
							title={
								!activeId
									? "No active conversation"
									: messages.length < 4
										? "Needs at least 4 messages"
										: "Summarizes older messages and keeps the most recent ones"
							}
							className="mt-2 flex h-9 w-full items-center justify-center gap-2 rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
						>
							<Scissors className="h-3.5 w-3.5" />
							{compaction ? "Re-compress context" : "Compress context"}
						</button>
						{compaction && (
							<p className="mt-1.5 text-[10px] leading-4 text-text-muted">
								Compressing again replaces the saved summary.
							</p>
						)}
					</section>

					<section className="px-4 py-4">
						<div className="flex items-center justify-between gap-3">
							<div>
								<h3 className="text-xs font-semibold text-text-primary">
									Compaction summary
								</h3>
								<p className="mt-0.5 text-[11px] text-text-muted">
									Full history remains stored in the conversation.
								</p>
							</div>
							{activeId && compaction && (
								<button
									type="button"
									onClick={() => clearCompaction(activeId)}
									className="h-7 rounded-md px-2 text-[11px] text-text-muted hover:bg-control hover:text-text-primary"
								>
									Clear
								</button>
							)}
						</div>
						{compaction ? (
							<div
								className="mt-3 border-l-2 border-accent pl-3"
								key={compaction.createdAt}
							>
								<p
									className={`whitespace-pre-wrap text-[11px] leading-5 text-text-secondary ${
										summaryExpanded
											? "max-h-96 overflow-y-auto"
											: "max-h-32 overflow-hidden"
									}`}
								>
									{compaction.summary}
								</p>
								{compaction.summary.length > 240 && (
									<button
										type="button"
										onClick={() => setSummaryExpanded((value) => !value)}
										className="mt-1.5 flex items-center gap-1 text-[10px] font-medium text-text-muted hover:text-text-primary"
									>
										{summaryExpanded ? (
											<ChevronUp className="h-3 w-3" />
										) : (
											<ChevronDown className="h-3 w-3" />
										)}
										{summaryExpanded ? "Show less" : "Show more"}
									</button>
								)}
								<p className="mt-2 text-[10px] tabular-nums text-text-muted">
									{formatTokens(compaction.sourceTokens)} source tokens ·
									keeping {compaction.keepRecent} recent messages
								</p>
							</div>
						) : (
							<p className="mt-3 text-[11px] leading-5 text-text-muted">
								No compacted context for this conversation.
							</p>
						)}
					</section>
				</div>
			) : tab === "rendering" ? (
				<div
					role="tabpanel"
					id="context-panel-rendering"
					aria-labelledby="context-tab-rendering"
					className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
				>
					<div className="mb-3">
						<h2 className="text-sm font-semibold text-text-primary">
							Math rendering
						</h2>
						<p className="mt-1 text-xs leading-5 text-text-muted">
							Choose the engine that typesets LaTeX math in chat responses.
						</p>
					</div>
					<div
						aria-label="Math rendering engine"
						className="divide-y divide-border overflow-hidden rounded-md border border-border bg-surface-alt/40"
					>
						{MATH_RENDERERS.map((option) => {
							const selected = mathRenderer === option.id;
							return (
								<button
									key={option.id}
									type="button"
									aria-pressed={selected}
									onClick={() => setMathRenderer(option.id)}
									className={`flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left transition-colors ${
										selected ? "bg-selected" : "hover:bg-control"
									}`}
								>
									<span className="min-w-0 flex-1">
										<span
											className={`block text-sm ${
												selected
													? "font-medium text-text-primary"
													: "text-text-secondary"
											}`}
										>
											{option.label}
										</span>
										<span className="mt-0.5 block text-xs text-text-muted">
											{option.detail}
										</span>
									</span>
									<Check
										aria-hidden="true"
										className={`h-3.5 w-3.5 shrink-0 ${
											selected ? "opacity-100" : "opacity-0"
										}`}
									/>
								</button>
							);
						})}
					</div>
				</div>
			) : (
				<div
					role="tabpanel"
					id="context-panel-parameters"
					aria-labelledby="context-tab-parameters"
					className="min-h-0 flex-1 overflow-y-auto px-4 py-3"
				>
					<p className="pb-1 text-[11px] leading-5 text-text-muted">
						Sampling parameters apply to requests in every conversation.
					</p>
					<NumberSlider
						id="context-temperature"
						label="Temperature"
						value={advanced.temperature}
						min={0}
						max={2}
						step={0.1}
						onChange={(temperature) => setAdvanced({ temperature })}
					/>
					<NumberSlider
						id="context-top-p"
						label="Top P"
						value={advanced.topP}
						min={0}
						max={1}
						step={0.05}
						onChange={(topP) => setAdvanced({ topP })}
					/>
					<NumberSlider
						id="context-max-completion"
						label="Max completion tokens"
						value={advanced.maxCompletionTokens}
						min={1}
						max={maxCompletionTokens}
						step={1}
						onChange={(maxCompletionTokens) =>
							setAdvanced({ maxCompletionTokens })
						}
					/>
					<div className="border-t border-border py-3">
						<label
							htmlFor="context-seed"
							className="mb-1.5 block text-xs font-medium text-text-primary"
						>
							Seed
						</label>
						<input
							autoComplete="off"
							id="context-seed"
							type="number"
							value={advanced.seed}
							onChange={(event) => setAdvanced({ seed: event.target.value })}
							placeholder="Random"
							className="h-8 w-full rounded-md border border-border bg-surface px-2 text-xs text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
						/>
					</div>
					<div className="border-t border-border py-3">
						<label
							htmlFor="context-stop-sequences"
							className="mb-1.5 block text-xs font-medium text-text-primary"
						>
							Stop sequences
						</label>
						<input
							autoComplete="off"
							id="context-stop-sequences"
							type="text"
							value={advanced.stopSequences}
							onChange={(event) =>
								setAdvanced({ stopSequences: event.target.value })
							}
							placeholder="Comma-separated"
							className="h-8 w-full rounded-md border border-border bg-surface px-2 text-xs text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
						/>
					</div>
					<div className="border-t border-border">
						<NumberSlider
							id="context-frequency-penalty"
							label="Frequency penalty"
							value={advanced.frequencyPenalty}
							min={-2}
							max={2}
							step={0.1}
							onChange={(frequencyPenalty) => setAdvanced({ frequencyPenalty })}
						/>
						<NumberSlider
							id="context-presence-penalty"
							label="Presence penalty"
							value={advanced.presencePenalty}
							min={-2}
							max={2}
							step={0.1}
							onChange={(presencePenalty) => setAdvanced({ presencePenalty })}
						/>
					</div>
					<div className="border-t border-border py-2">
						<Toggle
							checked={advanced.logprobs}
							onChange={(logprobs) => setAdvanced({ logprobs })}
							label="Log probabilities"
							description="OpenAI-compatible providers only."
						/>
						{advanced.logprobs && (
							<NumberSlider
								id="context-top-logprobs"
								label="Top log probabilities"
								value={advanced.topLogprobs}
								min={0}
								max={20}
								step={1}
								onChange={(topLogprobs) => setAdvanced({ topLogprobs })}
							/>
						)}
					</div>
				</div>
			)}
		</aside>
	);
}

import {
    Braces,
    CircleDollarSign,
    Gauge,
    MessageSquareText,
    PanelRightClose,
    Scissors,
    SlidersHorizontal,
    Sparkles,
    Wrench,
    Zap,
} from "lucide-react";
import {useMemo} from "react";
import {useConversationStore} from "../../stores/conversationStore";
import {
    estimateContextUsage,
    useContextManagementStore,
} from "../../stores/contextManagementStore";
import {useProviderStore} from "../../stores/providerStore";
import {useSettingsStore} from "../../stores/settingsStore";

function formatTokens(value: number): string {
    return new Intl.NumberFormat("en-US", {maximumFractionDigits: 0}).format(value);
}

function formatCost(value: number, currency: string): string {
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        minimumFractionDigits: 4,
        maximumFractionDigits: 6,
    }).format(value);
}

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
				<span className="block text-xs font-medium text-text-primary">{label}</span>
                {description && (
                    <span className="mt-0.5 block text-[11px] leading-4 text-text-muted">
						{description}
					</span>
                )}
			</span>
            <input
                type="checkbox"
                checked={checked}
                onChange={(event) => onChange(event.target.checked)}
                className="peer sr-only"
            />
            <span
                className="relative h-5 w-9 shrink-0 rounded-full bg-control transition-colors peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent/40">
				<span
                    className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4"/>
			</span>
        </label>
    );
}

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

function ContextMeter({
                          used,
                          limit,
                          percentage,
                      }: {
    used: number;
    limit: number | null;
    percentage: number | null;
}) {
    const safePercentage = percentage ?? 0;
    const tone =
        safePercentage >= 90
            ? "bg-danger"
            : safePercentage >= 75
                ? "bg-warning"
                : "bg-accent";

    return (
        <div className="space-y-2">
            <div className="flex items-end justify-between gap-3">
                <div>
                    <p className="text-2xl font-semibold tabular-nums text-text-primary">
                        {percentage == null ? formatTokens(used) : `${Math.round(percentage)}%`}
                    </p>
                    <p className="text-[11px] text-text-muted">
                        {formatTokens(used)}
                        {limit ? ` of ${formatTokens(limit)} tokens` : " estimated tokens"}
                    </p>
                </div>
                <Gauge className="h-5 w-5 text-text-muted"/>
            </div>
            <div
                role="progressbar"
                aria-label="Context usage"
                aria-valuemin={0}
                aria-valuemax={limit ?? undefined}
                aria-valuenow={limit ? Math.min(used, limit) : undefined}
                className="h-2 overflow-hidden rounded-full bg-control"
            >
                <div
                    className={`h-full rounded-full transition-[width] ${tone}`}
                    style={{width: `${percentage == null ? 0 : Math.max(1, safePercentage)}%`}}
                />
            </div>
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
    const setOpen = useContextManagementStore((state) => state.setContextPanelOpen);
    const setTab = useContextManagementStore((state) => state.setContextPanelTab);
    const autoCompact = useContextManagementStore((state) => state.autoCompact);
    const setAutoCompact = useContextManagementStore((state) => state.setAutoCompact);
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

    const conversation = conversations.find((item) => item.id === activeId);
    const providerId = conversation?.provider || defaultProvider;
    const modelId = conversation?.model || defaultModel;
    const profile = profiles.find((item) => item.id === providerId);
    const modelConfig = profile?.model_configs?.find((item) => item.id === modelId);
    const compaction = activeId ? compactions[activeId] : undefined;
    const context = useMemo(
        () => estimateContextUsage(messages, modelConfig?.context_window, compaction),
        [messages, modelConfig?.context_window, compaction],
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

    if (!open) return null;

    const breakdown = [
        {
            label: "System prompt",
            value: context.categories.system,
            icon: Zap,
            tone: "bg-accent",
        },
        {
            label: "Tools",
            value: context.categories.tools,
            icon: Wrench,
            tone: "bg-success",
        },
        {
            label: "Skills",
            value: context.categories.skills,
            icon: Sparkles,
            tone: "bg-purple-400",
        },
        {
            label: "Messages",
            value: context.categories.messages,
            icon: MessageSquareText,
            tone: "bg-warning",
        },
    ] as const;

    return (
        <aside
            aria-label="Context management"
            className="absolute inset-y-0 right-0 z-30 flex w-[min(22rem,calc(100%-1rem))] shrink-0 flex-col border-l border-border bg-workspace shadow-2xl min-[900px]:relative min-[900px]:z-auto min-[900px]:w-[22rem] min-[900px]:shadow-none"
        >
            <header className="flex h-12 shrink-0 items-center border-b border-border px-2">
                <div
                    role="tablist"
                    aria-label="Context panel sections"
                    className="flex min-w-0 flex-1 items-center gap-1"
                >
                    <button
                        type="button"
                        role="tab"
                        aria-selected={tab === "context"}
                        onClick={() => setTab("context")}
                        className={`flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium ${tab === "context" ? "bg-selected text-text-primary" : "text-text-muted hover:bg-control hover:text-text-primary"}`}
                    >
                        <Gauge className="h-3.5 w-3.5"/>
                        Context
                    </button>
                    <button
                        type="button"
                        role="tab"
                        aria-selected={tab === "parameters"}
                        onClick={() => setTab("parameters")}
                        className={`flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium ${tab === "parameters" ? "bg-selected text-text-primary" : "text-text-muted hover:bg-control hover:text-text-primary"}`}
                    >
                        <SlidersHorizontal className="h-3.5 w-3.5"/>
                        Parameters
                    </button>
                </div>
                <button
                    type="button"
                    onClick={() => setOpen(false)}
                    aria-label="Close context panel"
                    title="Close context panel"
                    className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-control hover:text-text-primary"
                >
                    <PanelRightClose className="h-4 w-4"/>
                </button>
            </header>

            {tab === "context" ? (
                <div
                    role="tabpanel"
                    aria-label="Context"
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
                                used={context.usedTokens}
                                limit={context.limit}
                                percentage={context.percentage}
                            />
                        </div>
                    </section>

                    <section className="border-b border-border px-4 py-3">
                        <div className="space-y-1">
                            {breakdown.map(({label, value, icon: Icon, tone}) => {
                                const share =
                                    context.usedTokens > 0
                                        ? Math.round((value / context.usedTokens) * 100)
                                        : 0;
                                return (
                                    <div
                                        key={label}
                                        className="grid grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2 py-1.5"
                                    >
                                        <Icon className="h-3.5 w-3.5 text-text-muted"/>
                                        <div className="min-w-0">
                                            <div className="mb-1 flex items-center justify-between gap-2 text-[11px]">
                                                <span className="truncate text-text-secondary">{label}</span>
                                                <span className="shrink-0 tabular-nums text-text-muted">
													{share}%
												</span>
                                            </div>
                                            <div className="h-1 overflow-hidden rounded-full bg-control">
                                                <div
                                                    className={`h-full ${tone}`}
                                                    style={{width: `${share}%`}}
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
                            <div
                                className="mt-2 flex items-center justify-between border-t border-border pt-2 text-[11px]">
                                <span className="text-text-muted">Free space</span>
                                <span className="tabular-nums text-text-primary">
									{formatTokens(context.freeTokens)} tokens
								</span>
                            </div>
                        )}
                        {lastPricedCall?.cost != null && (
                            <div
                                className="mt-2 flex items-center justify-between border-t border-border pt-2 text-[11px]">
								<span className="flex items-center gap-1.5 text-text-muted">
									<CircleDollarSign className="h-3.5 w-3.5"/>
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
                            description="Refresh the summary when context reaches 85%."
                        />
                        <button
                            type="button"
                            onClick={() => {
                                if (activeId) compactConversation(activeId, messages);
                            }}
                            disabled={!activeId || messages.length < 4}
                            className="mt-2 flex h-9 w-full items-center justify-center gap-2 rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            <Scissors className="h-3.5 w-3.5"/>
                            Compress context
                        </button>
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
                            <div className="mt-3 border-l-2 border-accent pl-3">
                                <p className="max-h-32 overflow-hidden whitespace-pre-wrap text-[11px] leading-5 text-text-secondary">
                                    {compaction.summary}
                                </p>
                                <p className="mt-2 text-[10px] tabular-nums text-text-muted">
                                    {formatTokens(compaction.sourceTokens)} source tokens · keeping{" "}
                                    {compaction.keepRecent} recent messages
                                </p>
                            </div>
                        ) : (
                            <p className="mt-3 text-[11px] leading-5 text-text-muted">
                                No compacted context for this conversation.
                            </p>
                        )}
                    </section>
                </div>
            ) : (
                <div
                    role="tabpanel"
                    aria-label="Parameters"
                    className="min-h-0 flex-1 overflow-y-auto px-4 py-3"
                >
                    <NumberSlider
                        id="context-temperature"
                        label="Temperature"
                        value={advanced.temperature}
                        min={0}
                        max={2}
                        step={0.1}
                        onChange={(temperature) => setAdvanced({temperature})}
                    />
                    <NumberSlider
                        id="context-top-p"
                        label="Top P"
                        value={advanced.topP}
                        min={0}
                        max={1}
                        step={0.05}
                        onChange={(topP) => setAdvanced({topP})}
                    />
                    <NumberSlider
                        id="context-max-completion"
                        label="Max completion tokens"
                        value={advanced.maxCompletionTokens}
                        min={1}
                        max={maxCompletionTokens}
                        step={1}
                        onChange={(maxCompletionTokens) =>
                            setAdvanced({maxCompletionTokens})
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
                            id="context-seed"
                            type="number"
                            value={advanced.seed}
                            onChange={(event) => setAdvanced({seed: event.target.value})}
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
                            id="context-stop-sequences"
                            type="text"
                            value={advanced.stopSequences}
                            onChange={(event) =>
                                setAdvanced({stopSequences: event.target.value})
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
                            onChange={(frequencyPenalty) =>
                                setAdvanced({frequencyPenalty})
                            }
                        />
                        <NumberSlider
                            id="context-presence-penalty"
                            label="Presence penalty"
                            value={advanced.presencePenalty}
                            min={-2}
                            max={2}
                            step={0.1}
                            onChange={(presencePenalty) => setAdvanced({presencePenalty})}
                        />
                    </div>
                    <div className="border-t border-border py-2">
                        <Toggle
                            checked={advanced.logprobs}
                            onChange={(logprobs) => setAdvanced({logprobs})}
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
                                onChange={(topLogprobs) => setAdvanced({topLogprobs})}
                            />
                        )}
                    </div>
                    <div className="border-t border-border py-3">
                        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-text-primary">
                            <Braces className="h-3.5 w-3.5 text-text-muted"/>
                            Response format
                        </div>
                        <div
                            role="group"
                            aria-label="Response format"
                            className="grid grid-cols-2 gap-1 rounded-md bg-control p-1"
                        >
                            {([
                                ["text", "Text"],
                                ["json_object", "JSON"],
                            ] as const).map(([value, label]) => (
                                <button
                                    key={value}
                                    type="button"
                                    aria-pressed={advanced.responseFormat === value}
                                    onClick={() => setAdvanced({responseFormat: value})}
                                    className={`h-7 rounded text-xs font-medium ${advanced.responseFormat === value ? "bg-workspace text-text-primary shadow-sm" : "text-text-muted hover:text-text-primary"}`}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </aside>
    );
}

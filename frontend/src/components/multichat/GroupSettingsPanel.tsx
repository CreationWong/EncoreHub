// Per-group autonomy and identity settings.
//
// The panel edits the conversation's complete group_settings object: the
// human persona members address with @name plus the auto-chat policy. Global
// defaults live in Settings → Group chat; this form overrides them per group.

import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { useT } from "../../i18n";
import type { GroupChatSettings } from "../../services/conversation";
import { useMultiChatStore } from "../../stores/multiChatStore";
import { toast } from "../../stores/toastStore";

export interface GroupSettingsPanelProps {
	open: boolean;
	onClose: () => void;
}

const EMPTY_SETTINGS: GroupChatSettings = {
	auto_chat_enabled: true,
	max_auto_turns: 6,
	allow_bot_mentions: true,
	paused: false,
	user_persona: { name: "", avatar: "", description: "" },
};

/** Parse the auto-turn input: "" is unlimited, otherwise a non-negative int. */
function parseMaxAutoTurns(value: string): number | null {
	if (value.trim() === "") return null;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export default function GroupSettingsPanel({
	open,
	onClose,
}: GroupSettingsPanelProps) {
	const t = useT();
	const settings = useMultiChatStore((state) => state.groupSettings);
	const saveGroupSettings = useMultiChatStore(
		(state) => state.saveGroupSettings,
	);
	const [draft, setDraft] = useState<GroupChatSettings>(EMPTY_SETTINGS);
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		if (open) setDraft(settings ?? EMPTY_SETTINGS);
	}, [open, settings]);

	if (!open) return null;

	const submit = async () => {
		setSaving(true);
		try {
			await saveGroupSettings(draft);
			toast.success(t("multiChat.settingsSaved"));
			onClose();
		} catch {
			// The store already surfaced the failure and rolled back; the panel
			// must stay open instead of claiming a saved state.
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className="absolute inset-0 z-40 flex items-center justify-center bg-black/30 p-4">
			<div className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-workspace shadow-2xl">
				<header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
					<h2 className="text-sm font-semibold text-text-primary">
						{t("multiChat.settingsTitle")}
					</h2>
					<button
						type="button"
						onClick={onClose}
						aria-label={t("common.cancel")}
						className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-control hover:text-text-primary"
					>
						<X className="h-4 w-4" />
					</button>
				</header>

				<div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
					<section>
						<h3 className="mb-2 text-xs font-semibold text-text-primary">
							{t("multiChat.personaSection")}
						</h3>
						<div className="space-y-2">
							<input
								autoComplete="off"
								value={draft.user_persona.name}
								onChange={(event) =>
									setDraft((current) => ({
										...current,
										user_persona: {
											...current.user_persona,
											name: event.target.value,
										},
									}))
								}
								placeholder={t("multiChat.personaNamePlaceholder")}
								aria-label={t("multiChat.personaName")}
								className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
							/>
							<input
								autoComplete="off"
								value={draft.user_persona.avatar}
								onChange={(event) =>
									setDraft((current) => ({
										...current,
										user_persona: {
											...current.user_persona,
											avatar: event.target.value,
										},
									}))
								}
								placeholder={t("multiChat.personaAvatar")}
								aria-label={t("multiChat.personaAvatar")}
								className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
							/>
							<textarea
								autoComplete="off"
								rows={2}
								value={draft.user_persona.description}
								onChange={(event) =>
									setDraft((current) => ({
										...current,
										user_persona: {
											...current.user_persona,
											description: event.target.value,
										},
									}))
								}
								placeholder={t("multiChat.personaDescription")}
								aria-label={t("multiChat.personaDescription")}
								className="w-full resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
							/>
						</div>
					</section>

					<section>
						<h3 className="mb-2 text-xs font-semibold text-text-primary">
							{t("multiChat.autonomySection")}
						</h3>
						<label className="flex items-start justify-between gap-4 py-2">
							<span>
								<span className="block text-xs font-medium text-text-primary">
									{t("multiChat.autoChat")}
								</span>
								<span className="mt-0.5 block text-[11px] leading-4 text-text-muted">
									{t("multiChat.autoChatHelp")}
								</span>
							</span>
							<input
								autoComplete="off"
								type="checkbox"
								checked={draft.auto_chat_enabled}
								onChange={(event) =>
									setDraft((current) => ({
										...current,
										auto_chat_enabled: event.target.checked,
									}))
								}
								className="mt-0.5 h-4 w-4 accent-accent"
							/>
						</label>
						<label className="flex items-center justify-between gap-4 py-2">
							<span>
								<span className="block text-xs font-medium text-text-primary">
									{t("multiChat.maxAutoTurns")}
								</span>
								<span className="mt-0.5 block text-[11px] leading-4 text-text-muted">
									{t("multiChat.maxAutoTurnsHelp")}
								</span>
							</span>
							<input
								autoComplete="off"
								type="number"
								min={0}
								value={draft.max_auto_turns ?? ""}
								onChange={(event) =>
									setDraft((current) => ({
										...current,
										max_auto_turns: parseMaxAutoTurns(event.target.value),
									}))
								}
								className="h-8 w-20 rounded-md border border-border bg-surface px-2 text-right text-xs tabular-nums text-text-primary outline-none focus:border-accent"
							/>
						</label>
						<label className="flex items-start justify-between gap-4 py-2">
							<span>
								<span className="block text-xs font-medium text-text-primary">
									{t("multiChat.allowBotMentions")}
								</span>
								<span className="mt-0.5 block text-[11px] leading-4 text-text-muted">
									{t("multiChat.allowBotMentionsHelp")}
								</span>
							</span>
							<input
								autoComplete="off"
								type="checkbox"
								checked={draft.allow_bot_mentions}
								onChange={(event) =>
									setDraft((current) => ({
										...current,
										allow_bot_mentions: event.target.checked,
									}))
								}
								className="mt-0.5 h-4 w-4 accent-accent"
							/>
						</label>
						<label className="flex items-start justify-between gap-4 py-2">
							<span>
								<span className="block text-xs font-medium text-text-primary">
									{t("multiChat.paused")}
								</span>
								<span className="mt-0.5 block text-[11px] leading-4 text-text-muted">
									{t("multiChat.pausedHelp")}
								</span>
							</span>
							<input
								autoComplete="off"
								type="checkbox"
								checked={draft.paused}
								onChange={(event) =>
									setDraft((current) => ({
										...current,
										paused: event.target.checked,
									}))
								}
								className="mt-0.5 h-4 w-4 accent-accent"
							/>
						</label>
					</section>
				</div>

				<footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-4 py-3">
					<button
						type="button"
						onClick={onClose}
						className="h-8 rounded-md px-3 text-xs text-text-secondary hover:bg-control hover:text-text-primary"
					>
						{t("multiChat.cancel")}
					</button>
					<button
						type="button"
						onClick={() => void submit()}
						disabled={saving}
						className="h-8 rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-40"
					>
						{saving
							? t("multiChat.savingSettings")
							: t("multiChat.saveSettings")}
					</button>
				</footer>
			</div>
		</div>
	);
}

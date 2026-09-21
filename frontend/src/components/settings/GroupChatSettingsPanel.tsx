// Global defaults for multi-AI group conversations.
//
// The values live under the `group_chat_settings` Engine config key and are
// copied into every newly created group; existing groups keep their own
// overrides, which individual users edit in the group's settings panel. The
// pause flag is runtime state, so it is intentionally excluded here.

import { useEffect, useState } from "react";
import { useT } from "../../i18n";
import type { GroupChatSettings } from "../../services/conversation";
import {
	groupChatSettingsApi,
	normalizeGlobalGroupChatSettings,
} from "../../services/groupChat";
import { toast } from "../../stores/toastStore";

/** Parse the auto-turn input: "" is unlimited, otherwise a non-negative int. */
function parseMaxAutoTurns(value: string): number | null {
	if (value.trim() === "") return null;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export default function GroupChatSettingsPanel() {
	const t = useT();
	const [draft, setDraft] = useState<GroupChatSettings>(
		normalizeGlobalGroupChatSettings(null),
	);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		let active = true;
		void groupChatSettingsApi
			.load()
			.then((settings) => {
				if (active) setDraft(settings);
			})
			.catch((error) => {
				toast.error(
					error instanceof Error ? error.message : t("multiChat.loadFailed"),
				);
			})
			.finally(() => {
				if (active) setLoading(false);
			});
		return () => {
			active = false;
		};
	}, [t]);

	const submit = async () => {
		setSaving(true);
		try {
			await groupChatSettingsApi.save(draft);
			toast.success(t("multiChat.settingsSaved"));
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : t("multiChat.loadFailed"),
			);
		} finally {
			setSaving(false);
		}
	};

	if (loading) {
		return (
			<p className="text-xs text-text-muted">{t("multiChat.savingSettings")}</p>
		);
	}

	return (
		<div className="mx-auto max-w-3xl space-y-8">
			<section>
				<div className="mb-3">
					<h2 className="text-sm font-semibold text-text-primary">
						{t("multiChat.settingsTitle")}
					</h2>
					<p className="mt-1 text-xs leading-5 text-text-muted">
						{t("multiChat.globalDefaultsHelp")}
					</p>
				</div>

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
			</section>

			<div className="flex justify-end">
				<button
					type="button"
					onClick={() => void submit()}
					disabled={saving}
					className="h-8 rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-40"
				>
					{saving ? t("multiChat.savingSettings") : t("multiChat.saveSettings")}
				</button>
			</div>
		</div>
	);
}

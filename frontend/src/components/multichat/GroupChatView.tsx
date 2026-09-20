// Active group conversation surface: member header, transcript, composer.
//
// Committed messages and live segments render through the same bubble so a
// streaming reply visually becomes its persisted message. The transcript marks
// the sender of every assistant row; user rows stay right-aligned bubbles.

import { Settings2, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../../i18n";
import type {
	ConversationParticipant,
	ReplyMode,
} from "../../services/conversation";
import { confirm } from "../../stores/confirmStore";
import { useMultiChatStore } from "../../stores/multiChatStore";
import CharacterAvatar from "../character/CharacterAvatar";
import GroupComposer from "./GroupComposer";
import GroupMessageBubble from "./GroupMessageBubble";
import GroupSettingsPanel from "./GroupSettingsPanel";
import { participantAccent } from "./participantAccent";

export default function GroupChatView() {
	const t = useT();
	const activeId = useMultiChatStore((state) => state.activeId);
	const conversation = useMultiChatStore((state) =>
		state.conversations.find((item) => item.id === state.activeId),
	);
	const participants = useMultiChatStore((state) => state.participants);
	const messages = useMultiChatStore((state) => state.messages);
	const segments = useMultiChatStore((state) => state.segments);
	const runnerState = useMultiChatStore((state) => state.runnerState);
	const pending = useMultiChatStore((state) => state.pending);
	const replyMode = useMultiChatStore((state) => state.replyMode);
	const setReplyMode = useMultiChatStore((state) => state.setReplyMode);
	const sendMessage = useMultiChatStore((state) => state.sendMessage);
	const stopStreaming = useMultiChatStore((state) => state.stopStreaming);
	const removeConversation = useMultiChatStore(
		(state) => state.removeConversation,
	);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const streaming = runnerState === "running";

	const byId = useMemo(() => {
		const map = new Map<string, ConversationParticipant>();
		for (const participant of participants) {
			map.set(participant.character_id, participant);
		}
		return map;
	}, [participants]);

	const bottomRef = useRef<HTMLDivElement | null>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: the transcript ref must follow every appended message or streamed segment
	useEffect(() => {
		bottomRef.current?.scrollIntoView({ block: "end" });
	}, [messages, segments]);

	if (!activeId || !conversation) {
		return (
			<div className="flex h-full items-center justify-center text-sm text-text-muted">
				{t("multiChat.emptyChat")}
			</div>
		);
	}

	return (
		<div className="flex h-full min-h-0 flex-col">
			<header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
				<div className="flex -space-x-1.5">
					{participants.slice(0, 5).map((participant) => (
						<span
							key={participant.character_id}
							title={participant.character_snapshot.name}
							className="shrink-0 self-center rounded-md"
							style={{
								boxShadow: `0 0 0 2px ${participantAccent(participant.position)}`,
							}}
						>
							<CharacterAvatar
								avatar={participant.character_snapshot.avatar}
								characterId={participant.character_id}
								name={participant.character_snapshot.name}
								size="small"
							/>
						</span>
					))}
				</div>
				<h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary">
					{conversation.title}
				</h2>
				{pending > 0 && (
					<span className="shrink-0 rounded-full bg-control px-2 py-0.5 text-[10px] tabular-nums text-text-muted">
						{t("multiChat.queuePending", { count: pending })}
					</span>
				)}
				{runnerState === "paused" && (
					<span className="shrink-0 rounded-full bg-warning-bg px-2 py-0.5 text-[10px] text-warning">
						{t("multiChat.runnerPaused")}
					</span>
				)}
				<label className="flex shrink-0 items-center gap-1.5 text-[11px] text-text-muted">
					{t("multiChat.replyMode")}
					<select
						value={replyMode}
						aria-label={t("multiChat.selectReplyMode")}
						onChange={(event) =>
							void setReplyMode(event.target.value as ReplyMode)
						}
						className="h-7 rounded-md border border-border bg-surface px-1.5 text-[11px] text-text-primary outline-none focus:border-accent"
					>
						<option value="sequential">
							{t("multiChat.replyModeSequential")}
						</option>
						<option value="smart">{t("multiChat.replyModeSmart")}</option>
					</select>
				</label>
				<button
					type="button"
					onClick={() => setSettingsOpen(true)}
					aria-label={t("multiChat.settingsTitle")}
					title={t("multiChat.settingsTitle")}
					className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-control hover:text-text-primary"
				>
					<Settings2 className="h-4 w-4" />
				</button>
				<button
					type="button"
					aria-label={t("multiChat.delete")}
					title={t("multiChat.delete")}
					onClick={() => {
						void confirm
							.ask(
								t("multiChat.deleteConfirmTitle"),
								t("multiChat.deleteConfirmBody"),
								true,
							)
							.then((ok) => {
								if (ok) void removeConversation(activeId);
							});
					}}
					className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-control hover:text-danger"
				>
					<Trash2 className="h-4 w-4" />
				</button>
			</header>

			<div className="min-h-0 flex-1 overflow-y-auto py-2">
				<div className="mx-auto w-full max-w-[1080px]">
					{messages.map((message) => {
						if (message.role === "user") {
							return (
								<GroupMessageBubble
									key={message.id}
									speaker={t("multiChat.you")}
									variant="user"
									content={message.content}
								/>
							);
						}
						const sender = message.sender_character_id
							? byId.get(message.sender_character_id)
							: undefined;
						return (
							<GroupMessageBubble
								key={message.id}
								speaker={sender?.character_snapshot.name ?? t("multiChat.you")}
								avatar={sender?.character_snapshot.avatar}
								characterId={sender?.character_id}
								accent={sender ? participantAccent(sender.position) : undefined}
								variant="assistant"
								content={message.content}
								reasoning={message.reasoning}
							/>
						);
					})}
					{segments.map((segment) => (
						<GroupMessageBubble
							key={segment.participantId}
							speaker={segment.name}
							avatar={segment.avatar}
							characterId={segment.participantId}
							accent={participantAccent(segment.position)}
							variant="assistant"
							content={segment.status === "error" ? "" : segment.content}
							reasoning={segment.reasoning}
							streaming={segment.status === "streaming"}
							status={segment.status}
							error={segment.error}
						/>
					))}
					{streaming && segments.length === 0 && (
						<p className="px-4 py-3 text-[11px] text-text-muted">
							{t("multiChat.thinking")}
						</p>
					)}
					<div ref={bottomRef} />
				</div>
			</div>

			<GroupComposer
				participants={participants}
				streaming={streaming}
				onSend={(content, mentions) => void sendMessage(content, mentions)}
				onStop={() => void stopStreaming()}
			/>

			<GroupSettingsPanel
				open={settingsOpen}
				onClose={() => setSettingsOpen(false)}
			/>
		</div>
	);
}

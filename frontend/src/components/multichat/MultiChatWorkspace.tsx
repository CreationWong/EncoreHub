// Workspace app surface for multi-AI group conversations.
//
// Left pane lists group conversations (conversations with a member roster),
// right pane shows the active transcript. Group creation happens in a dialog so
// the surface keeps the transcript visible while configuring members.

import { Loader2, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useT } from "../../i18n";
import { useMultiChatStore } from "../../stores/multiChatStore";
import CharacterAvatar from "../character/CharacterAvatar";
import GroupChatView from "./GroupChatView";
import GroupCreateDialog from "./GroupCreateDialog";
import { participantAccent } from "./participantAccent";

export default function MultiChatWorkspace() {
	const t = useT();
	const conversations = useMultiChatStore((state) => state.conversations);
	const listLoading = useMultiChatStore((state) => state.listLoading);
	const activeId = useMultiChatStore((state) => state.activeId);
	const loadConversations = useMultiChatStore(
		(state) => state.loadConversations,
	);
	const openConversation = useMultiChatStore((state) => state.openConversation);
	const [creating, setCreating] = useState(false);

	useEffect(() => {
		void loadConversations();
	}, [loadConversations]);

	return (
		<div className="relative flex h-full min-h-0">
			<aside className="flex w-64 shrink-0 flex-col border-r border-border">
				<div className="flex h-14 shrink-0 items-center justify-between px-3">
					<h1 className="text-sm font-semibold text-text-primary">
						{t("multiChat.heading")}
					</h1>
					<button
						type="button"
						onClick={() => setCreating(true)}
						aria-label={t("multiChat.newGroup")}
						title={t("multiChat.newGroup")}
						className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-control hover:text-text-primary"
					>
						<Plus className="h-4 w-4" />
					</button>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
					{listLoading && conversations.length === 0 ? (
						<div className="flex justify-center py-6 text-text-muted">
							<Loader2 className="h-4 w-4 animate-spin" />
						</div>
					) : conversations.length === 0 ? (
						<div className="px-2 py-6 text-center">
							<p className="text-xs text-text-secondary">
								{t("multiChat.emptyList")}
							</p>
							<p className="mt-1 text-[11px] leading-4 text-text-muted">
								{t("multiChat.emptyListHint")}
							</p>
						</div>
					) : (
						<ul className="space-y-1">
							{conversations.map((conversation) => {
								const active = conversation.id === activeId;
								return (
									<li key={conversation.id}>
										<button
											type="button"
											onClick={() => void openConversation(conversation.id)}
											className={`flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-2 text-left transition-colors ${
												active ? "bg-selected" : "hover:bg-surface-hover"
											}`}
										>
											<div className="flex shrink-0 -space-x-1">
												{(conversation.participants ?? [])
													.slice(0, 3)
													.map((participant) => (
														<span
															key={participant.character_id}
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
											<span className="min-w-0 flex-1">
												<span className="block truncate text-xs font-medium text-text-primary">
													{conversation.title}
												</span>
												<span className="block truncate text-[10px] text-text-muted">
													{(conversation.participants ?? [])
														.map(
															(participant) =>
																participant.character_snapshot.name,
														)
														.join(" · ")}
												</span>
											</span>
										</button>
									</li>
								);
							})}
						</ul>
					)}
				</div>
			</aside>

			<section className="min-w-0 flex-1">
				{activeId ? (
					<GroupChatView />
				) : (
					<div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
						<p className="text-sm font-medium text-text-primary">
							{t("multiChat.emptyChat")}
						</p>
						<p className="max-w-sm text-xs leading-5 text-text-muted">
							{t("multiChat.emptyChatHint")}
						</p>
						<button
							type="button"
							onClick={() => setCreating(true)}
							className="mt-1 flex h-9 items-center gap-2 rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-hover"
						>
							<Plus className="h-4 w-4" />
							{t("multiChat.newGroup")}
						</button>
					</div>
				)}
			</section>

			{creating && <GroupCreateDialog onClose={() => setCreating(false)} />}
		</div>
	);
}

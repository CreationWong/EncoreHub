import { FileText, ImageOff, Send, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
	type Attachment,
	fetchAttachmentContent,
} from "../../services/attachments";
import type { Message } from "../../services/conversation";
import CopyButton from "./CopyButton";

interface UserBubbleProps {
	message: Message;
	editing?: boolean;
	onEditCancel?: () => void;
	onEditSubmit?: (content: string) => void | Promise<void>;
}

function userStatus(status: Message["status"]) {
	if (status === "failed") {
		return { label: "Failed", className: "text-danger" };
	}
	if (status === "stopped") {
		return { label: "Stopped", className: "text-warning" };
	}
	return null;
}

function ImageAttachment({ attachment }: { attachment: Attachment }) {
	const [source, setSource] = useState<string | null>(null);
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		let active = true;
		let objectUrl: string | null = null;
		setFailed(false);
		void fetchAttachmentContent(attachment.conversation_id, attachment.id)
			.then((blob) => {
				if (!active) return;
				objectUrl = URL.createObjectURL(blob);
				setSource(objectUrl);
			})
			.catch(() => {
				if (active) setFailed(true);
			});
		return () => {
			active = false;
			if (objectUrl) URL.revokeObjectURL(objectUrl);
		};
	}, [attachment.conversation_id, attachment.id]);

	if (!source || failed) {
		return (
			<div
				aria-label={
					failed ? `${attachment.file_name} preview unavailable` : undefined
				}
				className="flex h-20 w-20 items-center justify-center rounded-lg border border-border bg-workspace text-text-muted"
			>
				{failed ? <ImageOff className="h-5 w-5" /> : null}
			</div>
		);
	}

	return (
		<button
			type="button"
			title={`Open ${attachment.file_name}`}
			className="h-20 w-20 overflow-hidden rounded-lg border border-border bg-workspace shadow-sm transition-colors hover:border-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
			onClick={() => window.open(source, "_blank", "noopener,noreferrer")}
		>
			<img
				src={source}
				alt={attachment.file_name}
				className="h-full w-full object-contain"
			/>
		</button>
	);
}

function AttachmentList({ attachments }: { attachments: Attachment[] }) {
	if (attachments.length === 0) return null;
	return (
		<div
			aria-label="Message attachments"
			className="flex max-w-full flex-wrap justify-end gap-2"
		>
			{attachments.map((attachment) =>
				attachment.file_category === "image" ? (
					<ImageAttachment key={attachment.id} attachment={attachment} />
				) : (
					<div
						key={attachment.id}
						title={attachment.file_name}
						className="flex h-10 max-w-56 items-center gap-2 rounded-lg border border-border bg-workspace px-3 text-xs text-text-secondary"
					>
						<FileText className="h-4 w-4 shrink-0" />
						<span className="truncate">{attachment.file_name}</span>
					</div>
				),
			)}
		</div>
	);
}

export default function UserBubble({
	message,
	editing = false,
	onEditCancel,
	onEditSubmit,
}: UserBubbleProps) {
	const status = userStatus(message.status);
	const attachments = message.attachments ?? [];
	const [draft, setDraft] = useState(message.content);
	const editorRef = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		if (!editing) return;
		setDraft(message.content);
		const frame = requestAnimationFrame(() => {
			const editor = editorRef.current;
			if (!editor) return;
			editor.focus();
			editor.setSelectionRange(editor.value.length, editor.value.length);
		});
		return () => cancelAnimationFrame(frame);
	}, [editing, message.content]);

	const submit = () => {
		const content = draft.trim();
		if (!content || content === message.content.trim()) return;
		void onEditSubmit?.(content);
	};

	return (
		<article
			aria-label="User message"
			data-message-id={message.id}
			data-message-role="user"
			className="app-message app-message-user group flex justify-end px-4 py-3"
		>
			<div
				className={`flex min-w-0 items-end gap-1.5 ${editing ? "w-full max-w-[82%]" : "max-w-[72%]"}`}
			>
				{editing ? (
					<div className="min-w-0 flex-1 overflow-hidden rounded-lg border border-border bg-workspace shadow-sm focus-within:border-accent">
						<textarea
							autoComplete="off"
							ref={editorRef}
							aria-label="Edit user message"
							value={draft}
							onChange={(event) => setDraft(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Escape") {
									event.preventDefault();
									onEditCancel?.();
								} else if (
									event.key === "Enter" &&
									(event.metaKey || event.ctrlKey)
								) {
									event.preventDefault();
									submit();
								}
							}}
							rows={4}
							className="block min-h-28 max-h-72 w-full resize-y bg-transparent px-4 py-3 text-[15px] leading-6 text-text-primary outline-none"
						/>
						<div className="flex h-11 items-center justify-end gap-1 border-t border-border px-2">
							<button
								type="button"
								onClick={onEditCancel}
								aria-label="Cancel editing"
								title="Cancel editing (Esc)"
								className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-control hover:text-text-primary"
							>
								<X className="h-4 w-4" />
							</button>
							<button
								type="button"
								onClick={submit}
								disabled={
									!draft.trim() || draft.trim() === message.content.trim()
								}
								aria-label="Update and regenerate"
								title="Update and regenerate (Ctrl+Enter)"
								className="flex h-8 w-8 items-center justify-center rounded-md bg-accent text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
							>
								<Send className="h-4 w-4" />
							</button>
						</div>
					</div>
				) : (
					<>
						{message.content.trim() && (
							<div className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
								<CopyButton text={message.content} label="Copy message" />
							</div>
						)}
						<div className="flex min-w-0 flex-col items-end gap-2">
							<AttachmentList attachments={attachments} />
							{message.content.trim() && (
								<div className="rounded-xl rounded-br-md bg-control px-3.5 py-2.5 text-[15px] leading-6 text-text-primary">
									<p className="whitespace-pre-wrap break-words">
										{message.content}
									</p>
								</div>
							)}
							{status && (
								<p
									className={`mt-1 text-right text-[11px] ${status.className}`}
								>
									{status.label}
								</p>
							)}
						</div>
					</>
				)}
			</div>
		</article>
	);
}

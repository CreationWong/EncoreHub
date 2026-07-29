import type { Message } from "../../services/conversation";
import CopyButton from "./CopyButton";

function userStatus(status: Message["status"]) {
	if (status === "failed") {
		return { label: "Failed", className: "text-danger" };
	}
	if (status === "stopped") {
		return { label: "Stopped", className: "text-warning" };
	}
	return null;
}

export default function UserBubble({ message }: { message: Message }) {
	const status = userStatus(message.status);

	return (
		<article
			aria-label="User message"
			className="app-message app-message-user group flex justify-end px-4 py-3"
		>
			<div className="flex max-w-[72%] min-w-0 items-end gap-1.5">
				<div className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
					<CopyButton text={message.content} label="Copy message" />
				</div>
				<div className="min-w-0">
					<div className="rounded-xl rounded-br-md bg-control px-3.5 py-2.5 text-[15px] leading-6 text-text-primary">
						<p className="whitespace-pre-wrap break-words">{message.content}</p>
					</div>
					{status && (
						<p className={`mt-1 text-right text-[11px] ${status.className}`}>
							{status.label}
						</p>
					)}
				</div>
			</div>
		</article>
	);
}

import { Loader2, MessageSquare } from "lucide-react";
import { useConversationStore } from "../../stores/conversationStore";
import Composer from "./Composer";
import ContextHeader from "./ContextHeader";
import MessageFeed from "./MessageFeed";

function WelcomeState() {
	return (
		<div className="flex h-full items-center justify-center px-6">
			<div className="space-y-3 text-center">
				<div className="flex justify-center">
					<div className="flex h-12 w-12 items-center justify-center rounded-lg bg-control text-accent">
						<MessageSquare className="h-6 w-6" />
					</div>
				</div>
				<h2 className="text-base font-semibold text-text-primary">EncoreHub</h2>
				<p className="text-sm text-text-muted">New conversation</p>
			</div>
		</div>
	);
}

function LoadingState() {
	return (
		<output
			aria-label="Loading conversation"
			className="flex h-full items-center justify-center"
		>
			<Loader2 className="h-5 w-5 animate-spin text-text-muted" />
		</output>
	);
}

function LoadingComposer() {
	return (
		<div
			aria-hidden="true"
			className="chat-composer-loading h-[77px] shrink-0 border-t border-border p-4"
		>
			<div className="mx-auto h-11 max-w-3xl rounded-lg bg-control" />
		</div>
	);
}

export default function ChatView() {
	const loading = useConversationStore((state) => state.loading);
	const activeId = useConversationStore((state) => state.activeId);

	return (
		<section
			aria-label="Chat workspace"
			className="flex h-full min-h-0 flex-col bg-workspace"
		>
			<ContextHeader />
			<div className="min-h-0 flex-1">
				{!activeId && <WelcomeState />}
				{activeId && loading && <LoadingState />}
				{activeId && !loading && <MessageFeed />}
			</div>
			{activeId && loading ? <LoadingComposer /> : <Composer />}
		</section>
	);
}

import { Check, Copy, Info, Sparkles, User } from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import type { Message } from "../../services/conversation";

interface Props {
	message: Message;
	isStreaming?: boolean;
}

function CopyButton({
	text,
	label = "Copy",
}: { text: string; label?: string }) {
	const [copied, setCopied] = useState(false);
	const onClick = async () => {
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			/* clipboard blocked — silently ignore */
		}
	};
	return (
		<button
			type="button"
			onClick={onClick}
			title={label}
			className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
		>
			{copied ? (
				<>
					<Check className="h-3 w-3" />
					<span>Copied</span>
				</>
			) : (
				<>
					<Copy className="h-3 w-3" />
					<span>{label}</span>
				</>
			)}
		</button>
	);
}

function CodeBlock({ language, value }: { language: string; value: string }) {
	return (
		<div className="my-3 overflow-hidden rounded-lg border border-border bg-[#1e1e1e]">
			<div className="flex items-center justify-between bg-surface-alt/40 px-3 py-1 text-[11px] text-text-muted">
				<span className="font-mono">{language}</span>
				<CopyButton text={value} />
			</div>
			<SyntaxHighlighter
				style={oneDark}
				language={language}
				PreTag="div"
				customStyle={{
					margin: 0,
					padding: "0.75rem 1rem",
					background: "transparent",
					fontSize: "0.8125rem",
				}}
			>
				{value}
			</SyntaxHighlighter>
		</div>
	);
}

export default function MessageBubble({ message, isStreaming }: Props) {
	const isUser = message.role === "user";
	const isSystem = message.role === "system";

	if (isSystem) {
		return (
			<div className="group flex gap-3 px-4 py-2">
				<Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-muted" />
				<div className="min-w-0 flex-1 text-xs text-text-muted">
					<pre className="whitespace-pre-wrap break-words font-sans">
						{message.content}
					</pre>
				</div>
			</div>
		);
	}

	if (isUser) {
		return (
			<div className="group flex justify-end px-4 py-3">
				<div className="flex max-w-[85%] items-end gap-2">
					<div className="opacity-0 transition-opacity group-hover:opacity-100">
						<CopyButton text={message.content} />
					</div>
					<div className="rounded-2xl rounded-br-sm bg-accent px-4 py-2.5 text-sm text-white shadow-sm">
						<p className="whitespace-pre-wrap break-words">{message.content}</p>
					</div>
					<div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
						<User className="h-3.5 w-3.5" />
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="group flex gap-3 px-4 py-4 hover:bg-surface-alt/30">
			<div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
				<Sparkles className="h-3.5 w-3.5" />
			</div>
			<div className="min-w-0 flex-1 pt-0.5">
				<div className="mb-1 flex items-center justify-between">
					<span className="text-xs font-medium text-text-muted">Assistant</span>
					{!isStreaming && message.content && (
						<div className="opacity-0 transition-opacity group-hover:opacity-100">
							<CopyButton text={message.content} />
						</div>
					)}
				</div>
				<div className="prose prose-sm dark:prose-invert max-w-none text-text-primary">
					<ReactMarkdown
						components={{
							code({ className, children, ...props }) {
								const match = /language-(\w+)/.exec(className || "");
								const codeStr = String(children).replace(/\n$/, "");
								if (match) {
									return <CodeBlock language={match[1]} value={codeStr} />;
								}
								return (
									<code className={className} {...props}>
										{children}
									</code>
								);
							},
						}}
					>
						{message.content}
					</ReactMarkdown>
					{isStreaming && (
						<span className="ml-0.5 inline-block h-4 w-1.5 animate-cursor-blink bg-accent align-text-bottom" />
					)}
				</div>
			</div>
		</div>
	);
}

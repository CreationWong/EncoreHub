import { Children, type ReactNode, isValidElement, memo } from "react";
import ReactMarkdown, {
	defaultUrlTransform,
	type Components,
	type UrlTransform,
} from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import remarkGfm from "remark-gfm";
import CopyButton from "./CopyButton";

interface MarkdownRendererProps {
	content: string;
	className?: string;
	size?: "sm" | "xs";
	muted?: boolean;
}

interface CodeBlockProps {
	language: string;
	value: string;
}

const remarkPlugins = [remarkGfm];

function joinClasses(...classes: Array<string | false | null | undefined>) {
	return classes.filter(Boolean).join(" ");
}

function languageFromClassName(className?: string) {
	const match = /(?:^|\s)language-([^\s]+)/.exec(className ?? "");
	return match?.[1] ?? "text";
}

function extractCodeBlock(children: ReactNode): CodeBlockProps | null {
	const child = Children.toArray(children).find(isValidElement);
	if (!child) return null;

	const props = child.props as {
		children?: ReactNode;
		className?: string;
	};
	if (props.children == null) return null;

	const raw = String(props.children ?? "");
	return {
		language: languageFromClassName(props.className),
		value: raw.replace(/\n$/, ""),
	};
}

function isExternalHref(href: string) {
	return /^(https?:)?\/\//i.test(href);
}

function toHttpUrl(href: string) {
	if (/^https?:\/\//i.test(href)) return href;
	if (/^\/\//.test(href)) return `https:${href}`;
	return null;
}

async function openHttpUrl(href: string) {
	// Only use Tauri's shell plugin when running inside the webview.
	if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
		try {
			const { open } = await import("@tauri-apps/plugin-shell");
			await open(href);
			return;
		} catch {
			// shell.open may fail if the capability is missing — fall through to window.open.
		}
	}
	window.open(href, "_blank", "noopener,noreferrer");
}

const safeUrlTransform: UrlTransform = (url) => defaultUrlTransform(url);

function CodeBlock({ language, value }: CodeBlockProps) {
	return (
		<div className="markdown-codeblock my-3 overflow-hidden rounded-lg border border-border bg-code-bg">
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
					lineHeight: 1.55,
				}}
			>
				{value}
			</SyntaxHighlighter>
		</div>
	);
}

const markdownComponents: Components = {
	a({ href, children, node, ...props }) {
		if (!href) {
			return <span className="markdown-link-disabled">{children}</span>;
		}

		const httpUrl = toHttpUrl(href);
		const isExternal = httpUrl !== null && isExternalHref(href);
		return (
			<a
				{...props}
				href={href}
				onClick={(event) => {
					props.onClick?.(event);
					if (event.defaultPrevented || !httpUrl) return;
					event.preventDefault();
					void openHttpUrl(httpUrl);
				}}
				// Don't set target="_blank" — Tauri's webview intercepts it
				// natively (before JS) and opens a system-browser tab, which
				// would race with the onClick handler and produce 2 tabs.
				rel={isExternal ? "noreferrer noopener" : undefined}
			>
				{children}
			</a>
		);
	},
	code({ children, className, node, ...props }) {
		return (
			<code {...props} className={className}>
				{children}
			</code>
		);
	},
	pre({ children, node, ...props }) {
		const codeBlock = extractCodeBlock(children);
		if (codeBlock) {
			return <CodeBlock {...codeBlock} />;
		}

		return (
			<pre {...props} className="markdown-raw-pre">
				{children}
			</pre>
		);
	},
	table({ children, node, ...props }) {
		return (
			<div className="markdown-table-wrap">
				<table {...props}>{children}</table>
			</div>
		);
	},
	input({ className, node, ...props }) {
		return (
			<input
				{...props}
				className={joinClasses("markdown-task-checkbox", className)}
			/>
		);
	},
};

function MarkdownRenderer({
	content,
	className,
	size = "sm",
	muted = false,
}: MarkdownRendererProps) {
	return (
		<ReactMarkdown
			className={joinClasses(
				"markdown-body min-w-0 max-w-none",
				size === "xs" ? "markdown-body-xs text-xs" : "markdown-body-sm text-sm",
				muted ? "text-text-muted" : "text-text-primary",
				className,
			)}
			components={markdownComponents}
			remarkPlugins={remarkPlugins}
			urlTransform={safeUrlTransform}
		>
			{content}
		</ReactMarkdown>
	);
}

export default memo(MarkdownRenderer);

import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

interface HighlightedCodeBlockProps {
	language: string;
	value: string;
}

export default function HighlightedCodeBlock({
	language,
	value,
}: HighlightedCodeBlockProps) {
	return (
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
	);
}

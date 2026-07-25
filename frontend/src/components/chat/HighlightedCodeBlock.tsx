import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import {
	oneDark,
	oneLight,
} from "react-syntax-highlighter/dist/esm/styles/prism";
import { useSettingsStore } from "../../stores/settingsStore";

interface HighlightedCodeBlockProps {
	language: string;
	value: string;
}

export default function HighlightedCodeBlock({
	language,
	value,
}: HighlightedCodeBlockProps) {
	const theme = useSettingsStore((state) => state.theme);
	const systemDark =
		theme === "system" &&
		typeof window !== "undefined" &&
		window.matchMedia("(prefers-color-scheme: dark)").matches;
	const syntaxTheme = theme === "dark" || systemDark ? oneDark : oneLight;

	return (
		<SyntaxHighlighter
			style={syntaxTheme}
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

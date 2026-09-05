// Markdown renderer entry point with pluggable math engines.
//
// Renders assistant and system output as GitHub-flavored Markdown. Math
// ($...$ inline and $$...$$ blocks) is laid out by the engine selected in
// Settings → Appearance: KaTeX (default) or MathJax. Each engine lives in its
// own lazily-loaded chunk; while it loads, the plain GFM renderer keeps the
// message visible.

import { Suspense, lazy, memo } from "react";
import { useSettingsStore } from "../../stores/settingsStore";
import {
	MarkdownCore,
	type MarkdownRendererProps,
	remarkBasePlugins,
} from "./markdownShared";

const KatexMarkdown = lazy(() => import("./KatexMarkdown"));
const MathjaxMarkdown = lazy(() => import("./MathjaxMarkdown"));

function MarkdownRenderer(props: MarkdownRendererProps) {
	const mathRenderer = useSettingsStore((state) => state.mathRenderer);

	if (mathRenderer === "mathjax") {
		return (
			<Suspense
				fallback={<MarkdownCore {...props} remarkPlugins={remarkBasePlugins} />}
			>
				<MathjaxMarkdown {...props} />
			</Suspense>
		);
	}
	if (mathRenderer === "katex") {
		return (
			<Suspense
				fallback={<MarkdownCore {...props} remarkPlugins={remarkBasePlugins} />}
			>
				<KatexMarkdown {...props} />
			</Suspense>
		);
	}
	return <MarkdownCore {...props} remarkPlugins={remarkBasePlugins} />;
}

export default memo(MarkdownRenderer);

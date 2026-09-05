// MathJax math renderer variant.
//
// Loaded on demand so MathJax (mathjax-full, SVG output) never enters the
// initial JavaScript bundle. It renders self-contained inline SVG, so unlike
// KaTeX it needs no separate stylesheet or font assets.

import rehypeMathjax from "rehype-mathjax";
import remarkMath from "remark-math";
import {
	MarkdownCore,
	type MarkdownRendererProps,
	remarkBasePlugins,
} from "./markdownShared";

export default function MathjaxMarkdown(props: MarkdownRendererProps) {
	return (
		<MarkdownCore
			{...props}
			remarkPlugins={[...remarkBasePlugins, remarkMath]}
			rehypePlugins={[rehypeMathjax]}
		/>
	);
}

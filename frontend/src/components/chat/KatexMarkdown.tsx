// KaTeX math renderer variant.
//
// Loaded on demand so the KaTeX engine, its stylesheet, and fonts never enter
// the initial JavaScript bundle. TeX is parsed by remark-math and laid out by
// rehype-katex; the CSS import is extracted by Vite into a lazily-fetched
// stylesheet alongside this chunk.

import "katex/dist/katex.min.css";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import {
	MarkdownCore,
	type MarkdownRendererProps,
	remarkBasePlugins,
} from "./markdownShared";

export default function KatexMarkdown(props: MarkdownRendererProps) {
	return (
		<MarkdownCore
			{...props}
			remarkPlugins={[...remarkBasePlugins, remarkMath]}
			rehypePlugins={[rehypeKatex]}
		/>
	);
}

import MarkdownRenderer from "./MarkdownRenderer";

export default function AnswerBody({
	content,
	streaming = false,
}: {
	content: string;
	streaming?: boolean;
}) {
	if (!content && !streaming) {
		return (
			<output className="block text-sm text-text-muted">
				No response content
			</output>
		);
	}

	return (
		<div className="min-w-0">
			{content && (
				<MarkdownRenderer content={content} className="assistant-answer" />
			)}
			{streaming && (
				<>
					<output className="sr-only">Generating response</output>
					<span
						aria-hidden="true"
						className="ml-0.5 inline-block h-4 w-1.5 animate-cursor-blink bg-accent align-text-bottom"
					/>
				</>
			)}
		</div>
	);
}

import { Check, Copy } from "lucide-react";
import { useState } from "react";

interface Props {
	text: string;
	label?: string;
}

export default function CopyButton({ text, label = "Copy" }: Props) {
	const [copied, setCopied] = useState(false);
	const onClick = async () => {
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			/* clipboard blocked - silently ignore */
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

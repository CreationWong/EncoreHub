import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { writeClipboardText } from "../../services/clipboard";
import { toast } from "../../stores/toastStore";

interface Props {
	text: string;
	label?: string;
}

export default function CopyButton({ text, label = "Copy" }: Props) {
	const [copied, setCopied] = useState(false);
	const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(
		() => () => {
			if (resetTimer.current) clearTimeout(resetTimer.current);
		},
		[],
	);

	const onClick = async () => {
		try {
			await writeClipboardText(text);
			setCopied(true);
			toast.success("Copied to clipboard");
			if (resetTimer.current) clearTimeout(resetTimer.current);
			resetTimer.current = setTimeout(() => setCopied(false), 1500);
		} catch {
			toast.error("Copy failed");
		}
	};
	const accessibleLabel = copied ? "Copied" : label;

	return (
		<button
			type="button"
			onClick={onClick}
			aria-label={accessibleLabel}
			title={accessibleLabel}
			className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-control hover:text-text-primary"
		>
			{copied ? (
				<Check className="h-3.5 w-3.5 text-success" />
			) : (
				<Copy className="h-3.5 w-3.5" />
			)}
		</button>
	);
}

import { useEffect, useRef } from "react";
import { useConfirmStore } from "../../stores/confirmStore";

export default function ConfirmDialog() {
	const { open, title, message, danger, resolve } = useConfirmStore();
	const cancelRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		if (open) cancelRef.current?.focus();
	}, [open]);

	const answer = (value: boolean) => {
		resolve?.(value);
		useConfirmStore.setState({
			open: false,
			title: "",
			message: "",
			danger: false,
			resolve: null,
		});
	};

	if (!open) return null;

	return (
		<div
			className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40"
			role="dialog"
			aria-modal="true"
			aria-label={title}
			onKeyDown={(e) => {
				if (e.key === "Escape") answer(false);
			}}
		>
			<div className="w-96 max-w-[90vw] rounded-xl border border-border bg-surface p-6 shadow-xl">
				<h3 className="text-base font-semibold text-text-primary">{title}</h3>
				<p className="mt-2 text-sm text-text-secondary">{message}</p>
				<div className="mt-5 flex justify-end gap-3">
					<button
						ref={cancelRef}
						type="button"
						onClick={() => answer(false)}
						className="rounded-lg border border-border px-4 py-2 text-sm text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={() => answer(true)}
						className={`rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
							danger
								? "bg-danger hover:bg-red-600"
								: "bg-accent hover:bg-accent-hover"
						}`}
					>
						Confirm
					</button>
				</div>
			</div>
		</div>
	);
}

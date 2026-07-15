import { useEffect, useRef } from "react";
import { useConfirmStore } from "../../stores/confirmStore";

export default function ConfirmDialog() {
	const { open, title, message, danger, resolve } = useConfirmStore();
	const dialogRef = useRef<HTMLDialogElement>(null);
	const cancelRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		if (!open) return;

		const dialog = dialogRef.current;
		if (dialog && !dialog.open) {
			if (typeof dialog.showModal === "function") dialog.showModal();
			else dialog.setAttribute("open", "");
		}
		cancelRef.current?.focus();
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
		<dialog
			ref={dialogRef}
			className="fixed inset-0 z-[60] m-0 h-full max-h-none w-full max-w-none border-0 bg-black/40 p-0"
			aria-labelledby="confirm-dialog-title"
			onCancel={(event) => {
				event.preventDefault();
				answer(false);
			}}
		>
			<div className="flex h-full w-full items-center justify-center">
				<div className="w-96 max-w-[90vw] rounded-xl border border-border bg-surface p-6 shadow-xl">
					<h3
						id="confirm-dialog-title"
						className="text-base font-semibold text-text-primary"
					>
						{title}
					</h3>
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
		</dialog>
	);
}

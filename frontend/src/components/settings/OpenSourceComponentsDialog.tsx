import { PackageOpen, X } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import {
	COMPONENT_LAYERS,
	THIRD_PARTY_COMPONENTS,
} from "./thirdPartyComponents";

interface OpenSourceComponentsDialogProps {
	open: boolean;
	onClose: () => void;
}

export default function OpenSourceComponentsDialog({
	open,
	onClose,
}: OpenSourceComponentsDialogProps) {
	const dialogRef = useRef<HTMLDialogElement>(null);
	const closeButtonRef = useRef<HTMLButtonElement>(null);
	const groupedComponents = useMemo(
		() =>
			COMPONENT_LAYERS.map((layer) => ({
				layer,
				components: THIRD_PARTY_COMPONENTS.filter(
					(component) => component.layer === layer,
				),
			})),
		[],
	);

	useEffect(() => {
		if (!open) return;

		const previouslyFocused = document.activeElement as HTMLElement | null;
		const dialog = dialogRef.current;
		if (dialog && !dialog.open) {
			if (typeof dialog.showModal === "function") dialog.showModal();
			else dialog.setAttribute("open", "");
		}
		closeButtonRef.current?.focus();

		return () => previouslyFocused?.focus();
	}, [open]);

	if (!open) return null;

	return createPortal(
		<dialog
			ref={dialogRef}
			aria-labelledby="open-source-components-title"
			className="fixed inset-0 z-[70] m-0 h-full max-h-none w-full max-w-none border-0 bg-black/50 p-4 text-text-primary"
			onCancel={(event) => {
				event.preventDefault();
				onClose();
			}}
			onKeyDown={(event) => {
				event.stopPropagation();
				if (event.key === "Escape") onClose();
			}}
		>
			<div
				className="flex h-full w-full items-center justify-center"
				onMouseDown={(event) => {
					if (event.target === event.currentTarget) onClose();
				}}
			>
				<section className="flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-2xl">
					<header className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-5 py-4">
						<div className="flex min-w-0 items-start gap-3">
							<div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-alt text-text-secondary">
								<PackageOpen className="h-4 w-4" />
							</div>
							<div className="min-w-0">
								<h2
									id="open-source-components-title"
									className="text-base font-semibold text-text-primary"
								>
									Open-source components
								</h2>
								<p className="mt-1 text-xs leading-5 text-text-muted">
									{THIRD_PARTY_COMPONENTS.length} direct runtime components,
									including bundled versions and license identifiers.
								</p>
							</div>
						</div>
						<button
							ref={closeButtonRef}
							type="button"
							onClick={onClose}
							aria-label="Close open-source components"
							title="Close (Esc)"
							className="shrink-0 rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
						>
							<X className="h-4 w-4" />
						</button>
					</header>

					<div className="min-h-0 flex-1 overflow-y-auto p-5 max-[560px]:p-3">
						<div className="overflow-hidden rounded-md border border-border">
							{groupedComponents.map(({ layer, components }, groupIndex) => (
								<div
									key={layer}
									className={groupIndex > 0 ? "border-t border-border" : ""}
								>
									<h3 className="sticky top-0 z-10 bg-surface-alt px-3 py-2 text-xs font-semibold text-text-secondary">
										{layer}
									</h3>
									<div className="overflow-x-auto">
										<table className="w-full min-w-[540px] table-fixed text-left text-xs">
											<thead className="sr-only">
												<tr>
													<th>Component</th>
													<th>Version</th>
													<th>License</th>
												</tr>
											</thead>
											<tbody>
												{components.map((component) => (
													<tr
														key={component.packageName}
														className="border-t border-border first:border-t-0"
													>
														<td className="w-[52%] px-3 py-2 align-top">
															<p className="font-medium text-text-primary">
																{component.name}
															</p>
															<p className="mt-0.5 break-all font-mono text-[10px] text-text-muted">
																{component.packageName}
															</p>
														</td>
														<td className="w-[18%] px-3 py-2 align-top font-mono text-text-secondary">
															{component.version}
														</td>
														<td className="w-[30%] break-words px-3 py-2 align-top text-text-secondary">
															{component.license}
														</td>
													</tr>
												))}
											</tbody>
										</table>
									</div>
								</div>
							))}
						</div>
						<p className="mt-3 text-[11px] leading-5 text-text-muted">
							Each component remains subject to its respective open-source
							license. License identifiers use SPDX naming where available.
						</p>
					</div>
				</section>
			</div>
		</dialog>,
		document.body,
	);
}

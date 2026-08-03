import { create } from "zustand";

export type ConfirmResult = "confirm" | "discard" | "cancel";

interface ConfirmState {
	open: boolean;
	title: string;
	message: string;
	danger?: boolean;
	confirmLabel: string;
	cancelLabel: string;
	discardLabel: string | null;
	resolve: ((value: ConfirmResult) => void) | null;
	show: (opts: {
		title: string;
		message: string;
		danger?: boolean;
		confirmLabel?: string;
		cancelLabel?: string;
		discardLabel?: string;
	}) => Promise<ConfirmResult>;
}

export const useConfirmStore = create<ConfirmState>((set, get) => ({
	open: false,
	title: "",
	message: "",
	danger: false,
	confirmLabel: "Confirm",
	cancelLabel: "Cancel",
	discardLabel: null,
	resolve: null,
	show: ({
		title,
		message,
		danger,
		confirmLabel = "Confirm",
		cancelLabel = "Cancel",
		discardLabel,
	}) =>
		new Promise<ConfirmResult>((resolve) => {
			set({
				open: true,
				title,
				message,
				danger: danger ?? false,
				confirmLabel,
				cancelLabel,
				discardLabel: discardLabel ?? null,
				resolve,
			});
		}),
}));

/** Imperative helper for call sites outside components. */
export const confirm = {
	/**
	 * Show a confirmation dialog and return true/false.
	 * @param title short heading
	 * @param message body text
	 * @param danger use destructive styling
	 */
	ask: async (
		title: string,
		message: string,
		danger = false,
	): Promise<boolean> =>
		(await useConfirmStore.getState().show({ title, message, danger })) ===
		"confirm",
	choose: (options: {
		title: string;
		message: string;
		confirmLabel: string;
		discardLabel: string;
		cancelLabel?: string;
	}): Promise<ConfirmResult> => useConfirmStore.getState().show(options),
};

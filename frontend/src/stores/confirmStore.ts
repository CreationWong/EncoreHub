import { create } from "zustand";

interface ConfirmState {
	open: boolean;
	title: string;
	message: string;
	danger?: boolean;
	resolve: ((value: boolean) => void) | null;
	show: (opts: {
		title: string;
		message: string;
		danger?: boolean;
	}) => Promise<boolean>;
}

export const useConfirmStore = create<ConfirmState>((set, get) => ({
	open: false,
	title: "",
	message: "",
	danger: false,
	resolve: null,
	show: ({ title, message, danger }) =>
		new Promise<boolean>((resolve) => {
			set({ open: true, title, message, danger: danger ?? false, resolve });
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
	ask: (title: string, message: string, danger = false): Promise<boolean> =>
		useConfirmStore.getState().show({ title, message, danger }),
};

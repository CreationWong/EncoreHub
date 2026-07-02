import { create } from "zustand";

export type ToastKind = "success" | "error" | "info" | "warning";

export interface Toast {
	id: number;
	kind: ToastKind;
	message: string;
}

interface ToastState {
	toasts: Toast[];
	push: (kind: ToastKind, message: string, durationMs?: number) => number;
	dismiss: (id: number) => void;
}

let nextId = 1;
const DEFAULT_DURATION = 4000;

export const useToastStore = create<ToastState>((set, get) => ({
	toasts: [],
	push: (kind, message, durationMs = DEFAULT_DURATION) => {
		const id = nextId++;
		set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }));
		if (durationMs > 0) {
			setTimeout(() => get().dismiss(id), durationMs);
		}
		return id;
	},
	dismiss: (id) =>
		set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Imperative helpers for non-component call sites. */
export const toast = {
	success: (msg: string, ms?: number) =>
		useToastStore.getState().push("success", msg, ms),
	error: (msg: string, ms?: number) =>
		useToastStore.getState().push("error", msg, ms),
	info: (msg: string, ms?: number) =>
		useToastStore.getState().push("info", msg, ms),
	warning: (msg: string, ms?: number) =>
		useToastStore.getState().push("warning", msg, ms),
};

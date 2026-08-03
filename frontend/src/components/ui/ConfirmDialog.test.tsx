import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type ConfirmResult,
	confirm,
	useConfirmStore,
} from "../../stores/confirmStore";
import ConfirmDialog from "./ConfirmDialog";

afterEach(() => {
	cleanup();
	useConfirmStore.setState({
		open: false,
		title: "",
		message: "",
		danger: false,
		confirmLabel: "Confirm",
		cancelLabel: "Cancel",
		discardLabel: null,
		resolve: null,
	});
});

describe("ConfirmDialog", () => {
	it("uses native dialog semantics and resolves cancel events", async () => {
		const result = confirm.ask(
			"Delete conversation",
			"This cannot be undone.",
			true,
		);
		render(<ConfirmDialog />);

		const dialog = screen.getByRole("dialog", { name: "Delete conversation" });
		const cancel = screen.getByRole("button", { name: "Cancel" });
		expect(document.activeElement).toBe(cancel);

		const event = new Event("cancel", { cancelable: true });
		fireEvent(dialog, event);

		expect(event.defaultPrevented).toBe(true);
		await expect(result).resolves.toBe(false);
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("resolves confirmation with true", async () => {
		const onResult = vi.fn<(value: ConfirmResult) => void>();
		useConfirmStore.setState({
			open: true,
			title: "Apply change",
			message: "Continue?",
			danger: false,
			confirmLabel: "Confirm",
			cancelLabel: "Cancel",
			discardLabel: null,
			resolve: onResult,
		});
		render(<ConfirmDialog />);

		fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

		expect(onResult).toHaveBeenCalledWith("confirm");
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("offers save, discard, and cancel choices for unsaved work", async () => {
		const result = confirm.choose({
			title: "Unsaved provider changes",
			message: "Save before leaving?",
			confirmLabel: "Save changes",
			discardLabel: "Don't save",
			cancelLabel: "Cancel",
		});
		render(<ConfirmDialog />);

		expect(screen.getByRole("button", { name: "Save changes" })).toBeDefined();
		expect(screen.getByRole("button", { name: "Don't save" })).toBeDefined();
		expect(screen.getByRole("button", { name: "Cancel" })).toBeDefined();
		fireEvent.click(screen.getByRole("button", { name: "Don't save" }));

		await expect(result).resolves.toBe("discard");
	});
});

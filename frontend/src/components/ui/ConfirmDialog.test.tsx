import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { confirm, useConfirmStore } from "../../stores/confirmStore";
import ConfirmDialog from "./ConfirmDialog";

afterEach(() => {
	cleanup();
	useConfirmStore.setState({
		open: false,
		title: "",
		message: "",
		danger: false,
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
		const onResult = vi.fn<(value: boolean) => void>();
		useConfirmStore.setState({
			open: true,
			title: "Apply change",
			message: "Continue?",
			danger: false,
			resolve: onResult,
		});
		render(<ConfirmDialog />);

		fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

		expect(onResult).toHaveBeenCalledWith(true);
		expect(screen.queryByRole("dialog")).toBeNull();
	});
});

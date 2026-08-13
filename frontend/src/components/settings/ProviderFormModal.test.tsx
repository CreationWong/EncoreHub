// Verifies custom provider creation semantics at the user-facing dialog boundary.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ProviderFormModal from "./ProviderFormModal";

vi.mock("../../stores/providerStore", () => ({
	useProviderStore: (selector: (state: { profiles: never[] }) => unknown) =>
		selector({ profiles: [] }),
}));

afterEach(cleanup);

describe("ProviderFormModal", () => {
	it("creates providers with UTF-8 names and generated UUID ids", () => {
		const onCreated = vi.fn();
		render(<ProviderFormModal onCreated={onCreated} onClose={vi.fn()} />);

		fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
			target: { value: "深度求索 🚀" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Create" }));

		expect(onCreated).toHaveBeenCalledWith(
			expect.objectContaining({
				id: expect.stringMatching(
					/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
				),
				name: "深度求索 🚀",
			}),
		);
	});

	it("does not submit while an IME composition is being confirmed", () => {
		const onCreated = vi.fn();
		render(<ProviderFormModal onCreated={onCreated} onClose={vi.fn()} />);
		const nameInput = screen.getByRole("textbox", { name: "Name" });

		fireEvent.change(nameInput, { target: { value: "中文" } });
		fireEvent.keyDown(nameInput, { key: "Enter", isComposing: true });

		expect(onCreated).not.toHaveBeenCalled();
	});

	it("does not expose provider names to browser autofill", () => {
		render(<ProviderFormModal onCreated={vi.fn()} onClose={vi.fn()} />);

		expect(
			screen
				.getByRole("textbox", { name: "Name" })
				.getAttribute("autocomplete"),
		).toBe("off");
	});

	it("stays open when the backdrop is clicked", () => {
		const onClose = vi.fn();
		const { container } = render(
			<ProviderFormModal onCreated={vi.fn()} onClose={onClose} />,
		);

		fireEvent.click(container.firstElementChild as Element);
		expect(onClose).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		expect(onClose).toHaveBeenCalledTimes(1);
	});
});

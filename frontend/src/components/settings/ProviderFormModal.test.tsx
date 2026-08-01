import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ProviderFormModal from "./ProviderFormModal";

vi.mock("../../stores/providerStore", () => ({
	useProviderStore: (selector: (state: { profiles: never[] }) => unknown) =>
		selector({ profiles: [] }),
}));

afterEach(cleanup);

describe("ProviderFormModal", () => {
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

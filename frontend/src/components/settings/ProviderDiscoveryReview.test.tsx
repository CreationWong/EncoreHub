import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ProviderDiscoveryReview from "./ProviderDiscoveryReview";
import { buildProviderModelDiscoveryDiff } from "./providerDiscovery";

afterEach(cleanup);

describe("ProviderDiscoveryReview", () => {
	it("lets the user choose additions for a multi-owner response", () => {
		const diff = buildProviderModelDiscoveryDiff(
			[],
			[
				{
					id: "alpha/model-a",
					name: "Model A",
					provider: "custom",
					owned_by: "alpha",
				},
				{
					id: "beta/model-b",
					name: "Model B",
					provider: "custom",
					owned_by: "beta",
				},
			],
			true,
		);
		const onApply = vi.fn();
		render(
			<ProviderDiscoveryReview
				diff={diff}
				onApply={onApply}
				onCancel={vi.fn()}
			/>,
		);

		const checkboxes = screen.getAllByRole("checkbox");
		expect(checkboxes).toHaveLength(2);
		fireEvent.click(checkboxes[1]);
		fireEvent.click(
			screen.getByRole("button", { name: "Save selected models" }),
		);

		expect(onApply).toHaveBeenCalledWith([
			expect.objectContaining({ id: "alpha/model-a", owned_by: "alpha" }),
		]);
	});
});

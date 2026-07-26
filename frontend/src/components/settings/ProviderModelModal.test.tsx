import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ProviderModelModal from "./ProviderModelModal";

afterEach(cleanup);

describe("ProviderModelModal", () => {
	it("creates a model with capability and pricing metadata", () => {
		const onSave = vi.fn();
		render(
			<ProviderModelModal
				model={null}
				existingIds={[]}
				onSave={onSave}
				onClose={vi.fn()}
			/>,
		);

		fireEvent.change(screen.getByPlaceholderText("gpt-4.1-mini"), {
			target: { value: "model-new" },
		});
		fireEvent.change(screen.getByPlaceholderText("GPT-4.1 Mini"), {
			target: { value: "Model New" },
		});
		fireEvent.change(screen.getByPlaceholderText("General"), {
			target: { value: "Reasoning" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Vision" }));
		fireEvent.click(screen.getByRole("button", { name: "Tools" }));
		fireEvent.change(screen.getByLabelText("Input price"), {
			target: { value: "1.25" },
		});
		fireEvent.change(screen.getByLabelText("Output price"), {
			target: { value: "4.5" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Add model" }));

		expect(onSave).toHaveBeenCalledWith(
			expect.objectContaining({
				id: "model-new",
				name: "Model New",
				group: "Reasoning",
				capabilities: expect.arrayContaining(["vision", "tools"]),
				input_price: 1.25,
				output_price: 4.5,
				streaming: true,
			}),
		);
	});

	it("allows an existing model ID to be changed without confusing its display name", () => {
		const onSave = vi.fn();
		render(
			<ProviderModelModal
				model={{
					id: "model-old",
					name: "Local note",
					group: "General",
					capabilities: [],
					streaming: true,
					currency: "USD",
				}}
				existingIds={["model-old", "model-taken"]}
				onSave={onSave}
				onClose={vi.fn()}
			/>,
		);

		fireEvent.change(screen.getByPlaceholderText("gpt-4.1-mini"), {
			target: { value: "model-new" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save" }));

		expect(onSave).toHaveBeenCalledWith(
			expect.objectContaining({ id: "model-new", name: "Local note" }),
		);
	});
});

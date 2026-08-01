import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ModelMetadataTable from "./ModelMetadataTable";

afterEach(cleanup);

describe("ModelMetadataTable", () => {
	it("edits a cell on double click and saves the updated database records", async () => {
		const onSave = vi.fn().mockResolvedValue(undefined);
		render(
			<ModelMetadataTable
				providerName="Catalog"
				records={[
					{
						id: "openai/gpt-test",
						name: "Old name",
						ownedBy: "openai",
						contextWindow: 128000,
					},
				]}
				onSave={onSave}
			/>,
		);

		fireEvent.doubleClick(screen.getByText("Old name"));
		const editor = screen.getByRole("textbox", {
			name: "Edit Name for openai/gpt-test",
		});
		fireEvent.change(editor, { target: { value: "New name" } });
		fireEvent.blur(editor);
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

		await waitFor(() =>
			expect(onSave).toHaveBeenCalledWith([
				expect.objectContaining({
					id: "openai/gpt-test",
					name: "New name",
				}),
			]),
		);
	});
});

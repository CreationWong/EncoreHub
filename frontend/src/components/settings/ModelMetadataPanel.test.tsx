import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	DEFAULT_MODEL_METADATA_PROVIDER,
	MODEL_METADATA_FIELD_LABELS,
} from "../../services/modelMetadata";
import { useModelMetadataStore } from "../../stores/modelMetadataStore";
import ModelMetadataPanel from "./ModelMetadataPanel";

const fetchMock = vi.fn();

describe("ModelMetadataPanel", () => {
	beforeEach(() => {
		localStorage.clear();
		fetchMock.mockReset();
		vi.stubGlobal("fetch", fetchMock);
		useModelMetadataStore.setState({
			providers: [
				{
					...DEFAULT_MODEL_METADATA_PROVIDER,
					mapping: { ...DEFAULT_MODEL_METADATA_PROVIDER.mapping },
				},
			],
		});
	});

	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
	});

	it("loads a sample, auto maps fields, and saves manual paths", async () => {
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => ({
				"demo/model": {
					id: "demo/model",
					name: "Demo model",
					limit: { context: 1000 },
					modalities: { input: ["text"] },
				},
			}),
		});
		render(<ModelMetadataPanel />);

		fireEvent.click(screen.getByRole("button", { name: "Load sample" }));
		await waitFor(() =>
			expect(screen.getByText(/records loaded/)).toBeDefined(),
		);

		fireEvent.click(screen.getByRole("button", { name: "Auto map" }));
		expect(
			(
				screen.getByRole("textbox", {
					name: `Mapping ${MODEL_METADATA_FIELD_LABELS.contextWindow}`,
				}) as HTMLInputElement
			).value,
		).toBe("limit.context");

		fireEvent.change(
			screen.getByRole("textbox", {
				name: `Mapping ${MODEL_METADATA_FIELD_LABELS.name}`,
			}),
			{ target: { value: "display.title" } },
		);
		fireEvent.click(screen.getByRole("button", { name: "Save provider" }));

		expect(useModelMetadataStore.getState().providers[0].mapping.name).toBe(
			"display.title",
		);
	});
});

import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MODEL_METADATA_PROVIDER } from "../../services/modelMetadata";
import { useModelMetadataStore } from "../../stores/modelMetadataStore";
import ProviderModelModal from "./ProviderModelModal";

afterEach(cleanup);

describe("ProviderModelModal", () => {
	beforeEach(() => {
		// Keep unit tests deterministic; individual metadata tests opt into records.
		useModelMetadataStore.setState({
			providers: [
				{
					...DEFAULT_MODEL_METADATA_PROVIDER,
					enabled: false,
					mapping: { ...DEFAULT_MODEL_METADATA_PROVIDER.mapping },
				},
			],
			recordsByProvider: {},
			loadingProviderIds: [],
		});
	});

	it("creates a model with capability and pricing metadata", () => {
		const onSave = vi.fn();
		render(
			<ProviderModelModal
				model={null}
				existingIds={[]}
				protocol="openai"
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
				protocol="openai"
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

	it("configures an embedding model as a non-chat utility", () => {
		const onSave = vi.fn();
		render(
			<ProviderModelModal
				model={null}
				existingIds={[]}
				protocol="openai"
				onSave={onSave}
				onClose={vi.fn()}
			/>,
		);

		fireEvent.change(screen.getByPlaceholderText("gpt-4.1-mini"), {
			target: { value: "text-embedding-3-small" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Embedding" }));
		expect(screen.queryByLabelText("Output price")).toBeNull();
		fireEvent.change(screen.getByLabelText("Default dimensions"), {
			target: { value: "256" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Add model" }));

		expect(onSave).toHaveBeenCalledWith(
			expect.objectContaining({
				id: "text-embedding-3-small",
				type: "embedding",
				dimensions: 256,
				streaming: false,
				output_price: 0,
			}),
		);
	});

	it("automatically applies matching metadata capabilities and context size", async () => {
		useModelMetadataStore.setState({
			providers: [
				{
					...DEFAULT_MODEL_METADATA_PROVIDER,
					mapping: { ...DEFAULT_MODEL_METADATA_PROVIDER.mapping },
				},
			],
			recordsByProvider: {
				"models-dev": [
					{
						id: "vendor/model-with-metadata",
						name: "Metadata model",
						family: "Reasoning",
						contextWindow: 128000,
						reasoning: true,
						toolCalling: true,
						attachments: true,
					},
				],
			},
		});
		const onSave = vi.fn();
		render(
			<ProviderModelModal
				model={null}
				existingIds={[]}
				protocol="openai"
				onSave={onSave}
				onClose={vi.fn()}
			/>,
		);

		fireEvent.change(screen.getByPlaceholderText("gpt-4.1-mini"), {
			target: { value: "model-with-metadata" },
		});

		await waitFor(() =>
			expect(
				(screen.getByLabelText("Maximum context size") as HTMLInputElement)
					.value,
			).toBe("128000"),
		);
		expect(
			screen
				.getByRole("button", { name: "Vision" })
				.getAttribute("aria-pressed"),
		).toBe("true");
		expect(
			screen
				.getByRole("button", { name: "Deep thinking" })
				.getAttribute("aria-pressed"),
		).toBe("true");
		expect(
			screen
				.getByRole("button", { name: "Tools" })
				.getAttribute("aria-pressed"),
		).toBe("true");

		fireEvent.click(screen.getByRole("button", { name: "Add model" }));
		expect(onSave).toHaveBeenCalledWith(
			expect.objectContaining({
				id: "model-with-metadata",
				name: "Metadata model",
				group: "Reasoning",
				capabilities: expect.arrayContaining(["vision", "reasoning", "tools"]),
				context_window: 128000,
			}),
		);
	});

	it("hides embedding settings and forces chat models for Anthropic", () => {
		const onSave = vi.fn();
		render(
			<ProviderModelModal
				model={{
					id: "legacy-embedding",
					name: "Legacy embedding",
					type: "embedding",
					dimensions: 1024,
					capabilities: ["embedding"],
					streaming: false,
				}}
				existingIds={["legacy-embedding"]}
				protocol="anthropic"
				onSave={onSave}
				onClose={vi.fn()}
			/>,
		);

		expect(screen.queryByRole("group", { name: "Model function" })).toBeNull();
		expect(screen.queryByLabelText("Default dimensions")).toBeNull();
		expect(screen.getByLabelText("Output price")).toBeDefined();

		fireEvent.click(screen.getByRole("button", { name: "Save" }));

		expect(onSave).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "chat",
				dimensions: undefined,
				capabilities: [],
			}),
		);
	});
});

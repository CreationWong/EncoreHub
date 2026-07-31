import { describe, expect, it } from "vitest";
import {
	DEFAULT_MODEL_METADATA_MAPPING,
	inferMetadataMapping,
	normalizeModelMetadata,
	parseModelMetadata,
} from "./modelMetadata";

describe("model metadata parsing", () => {
	it("parses an object index such as models.dev", () => {
		const result = parseModelMetadata(
			{
				"openai/gpt-test": {
					id: "openai/gpt-test",
					name: "GPT Test",
					limit: { context: 128000, output: 4096 },
					modalities: { input: ["text"], output: ["text"] },
					reasoning: true,
				},
			},
			{ format: "object", mapping: DEFAULT_MODEL_METADATA_MAPPING },
		);

		expect(result.count).toBe(1);
		expect(result.records[0]).toMatchObject({
			id: "openai/gpt-test",
			name: "GPT Test",
			contextWindow: 128000,
			maxOutputTokens: 4096,
			inputModalities: ["text"],
			capabilities: ["reasoning"],
			reasoning: true,
		});
	});

	it("infers aliases and nested paths from a representative record", () => {
		const mapping = inferMetadataMapping({
			model_id: "demo",
			display_name: "Demo",
			context_length: 32000,
			modalities: { input: ["text"] },
			tool_calling: true,
		});

		expect(mapping).toMatchObject({
			id: "model_id",
			name: "display_name",
			contextWindow: "context_length",
			inputModalities: "modalities.input",
			toolCalling: "tool_calling",
		});
	});

	it("uses the object key when an array record has no id field", () => {
		expect(
			normalizeModelMetadata(
				{ name: "Demo" },
				{ id: "id", name: "name" },
				"provider/demo",
			),
		).toMatchObject({ id: "provider/demo", name: "Demo" });
	});
});

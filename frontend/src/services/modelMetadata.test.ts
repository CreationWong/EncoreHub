import { describe, expect, it } from "vitest";
import {
	DEFAULT_MODEL_METADATA_MAPPING,
	MODEL_METADATA_PRESETS,
	applyMetadataToModelConfig,
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

	it("normalizes OpenAI data envelopes with owner, modalities, and tiered pricing", () => {
		const preset = MODEL_METADATA_PRESETS.find(
			(candidate) => candidate.id === "openai-data",
		);
		expect(preset).toBeDefined();
		const result = parseModelMetadata(
			{
				data: [
					{
						id: "anthropic/claude-sonnet-4.5",
						display_name: "Anthropic: Claude Sonnet 4.5",
						owned_by: "anthropic",
						input_modalities: ["text", "image", "file"],
						output_modalities: ["text"],
						capabilities: { reasoning: true },
						context_length: 200000,
						pricings: {
							prompt: [
								{
									value: 3,
									unit: "perMTokens",
									currency: "USD",
									conditions: {
										prompt_tokens: { unit: "kTokens", gte: 0, lt: 200 },
									},
								},
							],
						},
					},
				],
			},
			{
				format: preset?.format ?? "array",
				dataPath: preset?.dataPath,
				mapping: preset?.mapping ?? {},
			},
		);

		expect(result.records[0]).toMatchObject({
			id: "anthropic/claude-sonnet-4.5",
			ownedBy: "anthropic",
			contextWindow: 200000,
			inputModalities: ["text", "image", "file"],
			capabilities: ["reasoning"],
			pricing: {
				prompt: [
					{
						value: 3,
						conditions: {
							prompt_tokens: { gte: 0, lt: 200 },
						},
					},
				],
			},
		});
	});

	it("normalizes AIML-style nested info, feature, endpoint, and documentation fields", () => {
		const preset = MODEL_METADATA_PRESETS.find(
			(candidate) => candidate.id === "aimlapi",
		);
		const result = parseModelMetadata(
			[
				{
					id: "o3-mini",
					info: {
						name: "o3 mini",
						developer: "Open AI",
						description: "Reasoning model",
						contextLength: 200000,
						maxTokens: 100000,
						url: "https://example.com/o3-mini",
						docs_url: "https://docs.example.com/o3-mini",
					},
					features: ["openai/chat-completion.reasoning"],
					endpoints: ["/v1/chat/completions", "/v1/responses"],
				},
			],
			{
				format: preset?.format ?? "array",
				dataPath: preset?.dataPath,
				mapping: preset?.mapping ?? {},
			},
		);

		expect(result.records[0]).toMatchObject({
			id: "o3-mini",
			name: "o3 mini",
			ownedBy: "Open AI",
			contextWindow: 200000,
			maxOutputTokens: 100000,
			apiEndpoints: ["/v1/chat/completions", "/v1/responses"],
			documentationUrl: "https://docs.example.com/o3-mini",
			sourceUrl: "https://example.com/o3-mini",
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

	it("applies metadata capabilities and context while preserving local-only flags", () => {
		const configured = applyMetadataToModelConfig(
			{
				id: "demo",
				name: "Old name",
				capabilities: ["web", "vision"],
				streaming: true,
			},
			{
				id: "demo",
				name: "Metadata name",
				family: "demo-family",
				capabilities: ["reasoning", "tools"],
				contextWindow: 128000,
			},
		);

		expect(configured).toMatchObject({
			name: "Old name",
			group: "demo-family",
			capabilities: ["web", "reasoning", "tools"],
			context_window: 128000,
		});
	});
});

import { beforeEach, describe, expect, it } from "vitest";
import {
	DEFAULT_COEFFICIENTS,
	DEFAULT_OUTPUT_COEFFICIENTS,
	clampCoefficients,
	fitCoefficients,
	fitOutputCoefficients,
	loadModel,
	modelKeyFor,
	predictOutputTokens,
	predictTokens,
	recordOutputSample,
	recordSample,
	solveLinearSystem,
	splitOutputTokens,
} from "./tokenModel";

describe("tokenModel", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it("predicts tokens from the default heuristic coefficients", () => {
		const tokens = predictTokens(DEFAULT_COEFFICIENTS, {
			asciiBytes: 100,
			nonAsciiChars: 3,
			messageCount: 2,
		});
		// 100 * 0.25 + 3 * 1 + 2 * 4 = 25 + 3 + 8 = 36.
		expect(tokens).toBe(36);
	});

	it("measures plain text without per-message overhead", () => {
		expect(
			predictOutputTokens(DEFAULT_OUTPUT_COEFFICIENTS, "hello world"),
		).toBe(3);
		expect(predictOutputTokens(DEFAULT_OUTPUT_COEFFICIENTS, "你好")).toBe(2);
	});

	it("recovers a known linear relationship with least squares", () => {
		const samples = Array.from({ length: 16 }, (_, index) => {
			const asciiBytes = 40 + index * 37;
			const nonAsciiChars = index % 5;
			const messageCount = 1 + (index % 3);
			const actual =
				120 + 0.25 * asciiBytes + 1.1 * nonAsciiChars + 4 * messageCount;
			return {
				id: `sample-${index}`,
				features: { asciiBytes, nonAsciiChars, messageCount },
				actual,
			};
		});

		const fitted = fitCoefficients(samples);

		expect(fitted).not.toBeNull();
		if (!fitted) return;
		expect(fitted.intercept).toBeCloseTo(120, 0);
		expect(fitted.asciiPerByte).toBeCloseTo(0.25, 2);
		expect(fitted.nonAsciiPerChar).toBeCloseTo(1.1, 1);
		expect(fitted.perMessage).toBeCloseTo(4, 1);
	});

	it("refuses to fit fewer than the trust threshold", () => {
		const samples = [
			{
				id: "a",
				features: { asciiBytes: 40, nonAsciiChars: 0, messageCount: 1 },
				actual: 20,
			},
			{
				id: "b",
				features: { asciiBytes: 60, nonAsciiChars: 0, messageCount: 2 },
				actual: 30,
			},
		];
		expect(fitCoefficients(samples)).toBeNull();
	});

	it("clamps out-of-range coefficients back into safe bounds", () => {
		const clamped = clampCoefficients({
			intercept: -50,
			asciiPerByte: 99,
			nonAsciiPerChar: 0,
			perMessage: Number.NaN,
		});
		expect(clamped.intercept).toBe(0);
		expect(clamped.asciiPerByte).toBe(0.5);
		expect(clamped.nonAsciiPerChar).toBe(0.5);
		expect(clamped.perMessage).toBe(DEFAULT_COEFFICIENTS.perMessage);
	});

	it("solves a small linear system exactly", () => {
		// 2x + y = 5; x - y = 1  =>  x = 2, y = 1.
		const solution = solveLinearSystem(
			[
				[2, 1],
				[1, -1],
			],
			[5, 1],
		);
		expect(solution).not.toBeNull();
		if (!solution) return;
		expect(solution[0]).toBeCloseTo(2, 6);
		expect(solution[1]).toBeCloseTo(1, 6);
	});

	it("starts untrusted with defaults and no samples", () => {
		expect(loadModel("openai|gpt-test")).toEqual({
			coeffs: DEFAULT_COEFFICIENTS,
			sampleCount: 0,
			trusted: false,
			outputCoeffs: DEFAULT_OUTPUT_COEFFICIENTS,
			outputSampleCount: 0,
			outputTrusted: false,
		});
	});

	it("deduplicates samples by id when recording the same turn twice", () => {
		const features = { asciiBytes: 50, nonAsciiChars: 0, messageCount: 1 };
		recordSample("openai|gpt-test", "message-1", features, 30);
		const state = recordSample("openai|gpt-test", "message-1", features, 30);
		expect(state.sampleCount).toBe(1);
	});

	it("splits provider output between visible content and reasoning by weight", () => {
		// content = 40 ascii bytes -> 10 tokens weight; reasoning = 120 bytes
		// -> 30 tokens weight. Total 40 splits 10/30.
		const split = splitOutputTokens(
			DEFAULT_OUTPUT_COEFFICIENTS,
			"a".repeat(40),
			"r".repeat(120),
			40,
		);
		expect(split.visible).toBe(10);
		expect(split.reasoning).toBe(30);
	});

	it("returns the whole output as visible when there is no reasoning", () => {
		const split = splitOutputTokens(
			DEFAULT_OUTPUT_COEFFICIENTS,
			"a".repeat(40),
			"",
			40,
		);
		expect(split.visible).toBe(40);
		expect(split.reasoning).toBe(0);
	});

	it("recovers output coefficients from generated text samples", () => {
		const samples = Array.from({ length: 12 }, (_, index) => {
			const asciiBytes = 20 + ((index * 37) % 90);
			const nonAsciiChars = 1 + ((index * 29) % 17);
			return {
				id: `out-${index}`,
				features: { asciiBytes, nonAsciiChars },
				actual: Math.round(0.25 * asciiBytes + 1.2 * nonAsciiChars),
			};
		});
		const fitted = fitOutputCoefficients(samples);
		expect(fitted).not.toBeNull();
		if (!fitted) return;
		expect(fitted.asciiPerByte).toBeCloseTo(0.25, 2);
		expect(fitted.nonAsciiPerChar).toBeCloseTo(1.2, 1);
	});

	it("deduplicates output samples by id", () => {
		recordOutputSample(
			"openai|gpt-test",
			"out-1",
			{ asciiBytes: 40, nonAsciiChars: 0 },
			10,
		);
		const state = recordOutputSample(
			"openai|gpt-test",
			"out-1",
			{ asciiBytes: 40, nonAsciiChars: 0 },
			10,
		);
		expect(state.outputSampleCount).toBe(1);
	});

	it("keys models by provider and model", () => {
		expect(modelKeyFor("anthropic", "claude-sonnet")).toBe(
			"anthropic|claude-sonnet",
		);
	});
});

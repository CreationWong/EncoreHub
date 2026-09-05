// Token estimation model for context management.
//
// EncoreHub's context meter needs token counts before any provider reports
// usage (pre-flight estimates) and must stay accurate across providers whose
// tokenizers differ. This module trains two small linear models on the exact
// usage that providers return after generation, then uses the fitted
// coefficients to estimate future requests:
//
// - The **input model** predicts prompt size from [intercept, ascii bytes,
//   non-ascii code points, message count]. The intercept absorbs constant
//   overhead the frontend cannot see (base system prompt, tool definitions,
//   protocol framing); the text coefficients learn the average bytes/token
//   ratios for ASCII prose and CJK/other scripts; the per-message coefficient
//   learns the role/framing overhead added for every message.
// - The **output model** predicts generated token counts from [ascii bytes,
//   non-ascii code points] of the produced text, and is used to split a
//   provider-reported output total between visible content and reasoning so
//   the retained-context estimate matches what the gateway re-sends.
//
// Both fits solve a least-squares normal-equation system with Gaussian
// elimination, so the module needs no runtime dependencies and never ships
// user text anywhere.

export interface TokenTextStats {
	asciiBytes: number;
	nonAsciiChars: number;
}

export interface TokenFeatures extends TokenTextStats {
	messageCount: number;
}

export interface TokenCoefficients {
	intercept: number;
	asciiPerByte: number;
	nonAsciiPerChar: number;
	perMessage: number;
}

/** Text-only coefficients fitted on generated output (no framing overhead). */
export interface OutputCoefficients {
	asciiPerByte: number;
	nonAsciiPerChar: number;
}

export interface TokenModelSample {
	id: string;
	features: TokenFeatures;
	actual: number;
}

export interface TokenOutputSample {
	id: string;
	features: TokenTextStats;
	actual: number;
}

export interface TokenModelState {
	coeffs: TokenCoefficients;
	sampleCount: number;
	trusted: boolean;
	outputCoeffs: OutputCoefficients;
	outputSampleCount: number;
	outputTrusted: boolean;
}

/** Heuristic input coefficients used before enough provider snapshots exist. */
export const DEFAULT_COEFFICIENTS: TokenCoefficients = {
	intercept: 0,
	asciiPerByte: 0.25,
	nonAsciiPerChar: 1,
	perMessage: 4,
};

/** Heuristic output coefficients mirror the input text ratios. */
export const DEFAULT_OUTPUT_COEFFICIENTS: OutputCoefficients = {
	asciiPerByte: 0.25,
	nonAsciiPerChar: 1,
};

const MODEL_STORAGE_KEY = "encorehub-token-model-v2";
const MIN_SAMPLES_TO_TRUST = 8;
const MAX_SAMPLES_PER_MODEL = 256;

// Clamp ranges keep a few outlier snapshots from skewing the model into
// impossible territory (negative tokens or absurd bytes/token ratios).
const COEFFICIENT_BOUNDS: Record<
	keyof TokenCoefficients,
	readonly [number, number]
> = {
	intercept: [0, 20_000],
	asciiPerByte: [0.1, 0.5],
	nonAsciiPerChar: [0.5, 3],
	perMessage: [0, 20],
};

const OUTPUT_BOUNDS: Record<
	keyof OutputCoefficients,
	readonly [number, number]
> = {
	asciiPerByte: [0.1, 0.5],
	nonAsciiPerChar: [0.5, 3],
};

/**
 * Count the byte/code-point features of one string. ASCII bytes proxy the
 * typical 4-bytes-per-token prose ratio; every non-ASCII code point is
 * conservatively counted as one token-sized unit.
 */
export function countTextStats(text: string): TokenTextStats {
	const stats = { asciiBytes: 0, nonAsciiChars: 0 };
	for (const char of text) {
		if ((char.codePointAt(0) ?? 0) <= 0x7f) stats.asciiBytes += 1;
		else stats.nonAsciiChars += 1;
	}
	return stats;
}

export function addTextStats(
	a: TokenTextStats,
	b: TokenTextStats,
): TokenTextStats {
	return {
		asciiBytes: a.asciiBytes + b.asciiBytes,
		nonAsciiChars: a.nonAsciiChars + b.nonAsciiChars,
	};
}

/** Estimate input tokens for a request given a fitted (or default) input model. */
export function predictTokens(
	coeffs: TokenCoefficients,
	features: TokenFeatures,
): number {
	const raw =
		coeffs.intercept +
		coeffs.asciiPerByte * features.asciiBytes +
		coeffs.nonAsciiPerChar * features.nonAsciiChars +
		coeffs.perMessage * features.messageCount;
	return Math.max(0, Math.round(raw));
}

/** Estimate generated tokens for plain text using the output model. */
export function predictOutputTokens(
	coeffs: OutputCoefficients,
	text: string,
): number {
	const stats = countTextStats(text);
	const raw =
		coeffs.asciiPerByte * stats.asciiBytes +
		coeffs.nonAsciiPerChar * stats.nonAsciiChars;
	return Math.max(0, Math.round(raw));
}

/**
 * Split a provider-reported output total between visible content and hidden
 * reasoning in proportion to their fitted token weights. When no reasoning
 * exists the whole total is visible. When the total is zero the split is zero.
 */
export function splitOutputTokens(
	coeffs: OutputCoefficients,
	content: string,
	reasoning: string,
	total: number,
): { visible: number; reasoning: number } {
	if (total <= 0) return { visible: 0, reasoning: 0 };
	if (!reasoning) return { visible: total, reasoning: 0 };

	const contentStats = countTextStats(content);
	const reasoningStats = countTextStats(reasoning);
	const contentWeight = textWeight(coeffs, contentStats);
	const reasoningWeight = textWeight(coeffs, reasoningStats);
	const combined = contentWeight + reasoningWeight;
	if (combined <= 0) return { visible: total, reasoning: 0 };

	const reasoningTokens = (total * reasoningWeight) / combined;
	const visible = Math.round(total - reasoningTokens);
	return {
		visible: Math.max(0, Math.min(total, visible)),
		reasoning: Math.max(0, total - Math.max(0, Math.min(total, visible))),
	};
}

function textWeight(coeffs: OutputCoefficients, stats: TokenTextStats): number {
	return (
		coeffs.asciiPerByte * stats.asciiBytes +
		coeffs.nonAsciiPerChar * stats.nonAsciiChars
	);
}

/** Force every input coefficient into its safe range, preserving defaults. */
export function clampCoefficients(
	coeffs: TokenCoefficients,
): TokenCoefficients {
	const clamp = (key: keyof TokenCoefficients, value: number): number => {
		const [min, max] = COEFFICIENT_BOUNDS[key];
		if (!Number.isFinite(value)) return DEFAULT_COEFFICIENTS[key];
		return Math.min(max, Math.max(min, value));
	};
	return {
		intercept: clamp("intercept", coeffs.intercept),
		asciiPerByte: clamp("asciiPerByte", coeffs.asciiPerByte),
		nonAsciiPerChar: clamp("nonAsciiPerChar", coeffs.nonAsciiPerChar),
		perMessage: clamp("perMessage", coeffs.perMessage),
	};
}

/** Force every output coefficient into its safe range, preserving defaults. */
export function clampOutputCoefficients(
	coeffs: OutputCoefficients,
): OutputCoefficients {
	const clamp = (key: keyof OutputCoefficients, value: number): number => {
		const [min, max] = OUTPUT_BOUNDS[key];
		if (!Number.isFinite(value)) return DEFAULT_OUTPUT_COEFFICIENTS[key];
		return Math.min(max, Math.max(min, value));
	};
	return {
		asciiPerByte: clamp("asciiPerByte", coeffs.asciiPerByte),
		nonAsciiPerChar: clamp("nonAsciiPerChar", coeffs.nonAsciiPerChar),
	};
}

/**
 * Fit the least-squares input model. Solves `(XᵀX)β = Xᵀy` for the four
 * coefficients; returns null when there are too few samples for stability.
 */
export function fitCoefficients(
	samples: TokenModelSample[],
): TokenCoefficients | null {
	if (samples.length < MIN_SAMPLES_TO_TRUST) return null;

	const size = 4;
	const xtx: number[][] = Array.from({ length: size }, () =>
		new Array<number>(size).fill(0),
	);
	const xty = new Array<number>(size).fill(0);

	for (const sample of samples) {
		const row = [
			1,
			sample.features.asciiBytes,
			sample.features.nonAsciiChars,
			sample.features.messageCount,
		];
		for (let i = 0; i < size; i += 1) {
			xty[i] += row[i] * sample.actual;
			for (let j = 0; j < size; j += 1) xtx[i][j] += row[i] * row[j];
		}
	}

	// Tiny ridge term keeps the normal matrix non-singular for degenerate
	// feature sets (e.g. a single repeated message shape).
	for (let i = 0; i < size; i += 1) xtx[i][i] += 1e-6;

	const solution = solveLinearSystem(xtx, xty);
	if (!solution) return null;
	return clampCoefficients({
		intercept: solution[0],
		asciiPerByte: solution[1],
		nonAsciiPerChar: solution[2],
		perMessage: solution[3],
	});
}

/**
 * Fit the least-squares output model (two text coefficients, no intercept —
 * output has no per-turn framing overhead). Returns null below the trust
 * threshold.
 */
export function fitOutputCoefficients(
	samples: TokenOutputSample[],
): OutputCoefficients | null {
	if (samples.length < MIN_SAMPLES_TO_TRUST) return null;

	const size = 2;
	const xtx: number[][] = Array.from({ length: size }, () =>
		new Array<number>(size).fill(0),
	);
	const xty = new Array<number>(size).fill(0);

	for (const sample of samples) {
		const row = [sample.features.asciiBytes, sample.features.nonAsciiChars];
		for (let i = 0; i < size; i += 1) {
			xty[i] += row[i] * sample.actual;
			for (let j = 0; j < size; j += 1) xtx[i][j] += row[i] * row[j];
		}
	}

	for (let i = 0; i < size; i += 1) xtx[i][i] += 1e-6;

	const solution = solveLinearSystem(xtx, xty);
	if (!solution) return null;
	return clampOutputCoefficients({
		asciiPerByte: solution[0],
		nonAsciiPerChar: solution[1],
	});
}

/**
 * Solve `A x = b` via Gaussian elimination with partial pivoting. Returns
 * null when the matrix is singular. Pure, deterministic, no dependencies.
 */
export function solveLinearSystem(
	matrix: number[][],
	vector: number[],
): number[] | null {
	const size = vector.length;
	const augmented = matrix.map((row, i) => [...row, vector[i]]);

	for (let col = 0; col < size; col += 1) {
		let pivot = col;
		for (let row = col + 1; row < size; row += 1) {
			if (Math.abs(augmented[row][col]) > Math.abs(augmented[pivot][col]))
				pivot = row;
		}
		if (Math.abs(augmented[pivot][col]) < 1e-9) return null;
		[augmented[col], augmented[pivot]] = [augmented[pivot], augmented[col]];

		for (let row = 0; row < size; row += 1) {
			if (row === col) continue;
			const factor = augmented[row][col] / augmented[col][col];
			for (let j = col; j <= size; j += 1)
				augmented[row][j] -= factor * augmented[col][j];
		}
	}

	return augmented.map((row, i) => row[size] / row[i]);
}

interface ModelEntry {
	input: TokenModelSample[];
	output: TokenOutputSample[];
}

type ModelStore = Record<string, ModelEntry>;

function emptyEntry(): ModelEntry {
	return { input: [], output: [] };
}

function readModelStore(): ModelStore {
	if (typeof window === "undefined") return {};
	try {
		const raw = localStorage.getItem(MODEL_STORAGE_KEY);
		return raw ? (JSON.parse(raw) as ModelStore) : {};
	} catch {
		return {};
	}
}

function writeModelStore(store: ModelStore): void {
	try {
		localStorage.setItem(MODEL_STORAGE_KEY, JSON.stringify(store));
	} catch {
		/* Storage is optional in restricted webviews. */
	}
}

/** Canonical provider/model identity used to key each fitted model. */
export function modelKeyFor(provider: string, model: string): string {
	return `${provider}|${model}`;
}

/**
 * List every persisted provider/model key with its current calibration state.
 * Used by the developer panel to inspect and reset the fitted models.
 */
export function listModels(): Record<string, TokenModelState> {
	const store = readModelStore();
	const result: Record<string, TokenModelState> = {};
	for (const key of Object.keys(store)) result[key] = loadModel(key);
	return result;
}

/** Load the input and output coefficients (fitted or default) plus metadata. */
export function loadModel(modelKey: string): TokenModelState {
	const entry = readModelStore()[modelKey] ?? emptyEntry();
	const fitted = fitCoefficients(entry.input);
	const outputFitted = fitOutputCoefficients(entry.output);
	return {
		coeffs: fitted ?? DEFAULT_COEFFICIENTS,
		sampleCount: entry.input.length,
		trusted: fitted != null,
		outputCoeffs: outputFitted ?? DEFAULT_OUTPUT_COEFFICIENTS,
		outputSampleCount: entry.output.length,
		outputTrusted: outputFitted != null,
	};
}

/**
 * Record one post-generation input sample and refit the input model. Samples
 * are de-duplicated by id so replaying the same finished turn never skews the
 * fit. Returns the updated model state.
 */
export function recordSample(
	modelKey: string,
	sampleId: string,
	features: TokenFeatures,
	actual: number,
): TokenModelState {
	const store = readModelStore();
	const entry = store[modelKey] ?? emptyEntry();
	if (entry.input.some((sample) => sample.id === sampleId)) {
		return loadModel(modelKey);
	}
	const next = [...entry.input, { id: sampleId, features, actual }].slice(
		-MAX_SAMPLES_PER_MODEL,
	);
	store[modelKey] = { ...entry, input: next };
	writeModelStore(store);
	const fitted = fitCoefficients(next);
	return {
		coeffs: fitted ?? DEFAULT_COEFFICIENTS,
		sampleCount: next.length,
		trusted: fitted != null,
		outputCoeffs:
			fitOutputCoefficients(entry.output) ?? DEFAULT_OUTPUT_COEFFICIENTS,
		outputSampleCount: entry.output.length,
		outputTrusted: fitOutputCoefficients(entry.output) != null,
	};
}

/**
 * Record one post-generation output sample and refit the output model. The
 * features cover the complete generated text (visible content plus reasoning)
 * and the actual value is the provider-reported output total.
 */
export function recordOutputSample(
	modelKey: string,
	sampleId: string,
	features: TokenTextStats,
	actual: number,
): TokenModelState {
	const store = readModelStore();
	const entry = store[modelKey] ?? emptyEntry();
	if (entry.output.some((sample) => sample.id === sampleId)) {
		return loadModel(modelKey);
	}
	const next = [...entry.output, { id: sampleId, features, actual }].slice(
		-MAX_SAMPLES_PER_MODEL,
	);
	store[modelKey] = { ...entry, output: next };
	writeModelStore(store);
	const outputFitted = fitOutputCoefficients(next);
	return {
		coeffs: fitCoefficients(entry.input) ?? DEFAULT_COEFFICIENTS,
		sampleCount: entry.input.length,
		trusted: fitCoefficients(entry.input) != null,
		outputCoeffs: outputFitted ?? DEFAULT_OUTPUT_COEFFICIENTS,
		outputSampleCount: next.length,
		outputTrusted: outputFitted != null,
	};
}

/** Wipe persisted model state (used by tests and data-reset paths). */
export function clearModelStore(): void {
	try {
		localStorage.removeItem(MODEL_STORAGE_KEY);
	} catch {
		/* ignore */
	}
}

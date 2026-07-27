import type { ProviderKeyValidationResponse } from "../../services/providers";

export type ProviderRuntimeStatus =
	| "disabled"
	| "healthy"
	| "waiting"
	| "timeout"
	| "error";

interface ProviderRuntimeStatusPresentation {
	label: string;
	className: string;
	pulse: boolean;
}

const STATUS_PRESENTATION: Record<
	ProviderRuntimeStatus,
	ProviderRuntimeStatusPresentation
> = {
	disabled: {
		label: "Disabled",
		className: "border border-border bg-transparent",
		pulse: false,
	},
	healthy: {
		label: "Normal",
		className: "bg-success",
		pulse: false,
	},
	waiting: {
		label: "Waiting for connection check",
		className: "bg-warning",
		pulse: true,
	},
	timeout: {
		label: "Connection timed out",
		className: "bg-warning",
		pulse: false,
	},
	error: {
		label: "Connection fault",
		className: "bg-danger",
		pulse: false,
	},
};

export function defaultProviderRuntimeStatus(
	enabled: boolean,
	isDraft = false,
): ProviderRuntimeStatus {
	if (!enabled) return "disabled";
	return isDraft ? "waiting" : "healthy";
}

export function providerRuntimeStatusPresentation(
	status: ProviderRuntimeStatus,
): ProviderRuntimeStatusPresentation {
	return STATUS_PRESENTATION[status];
}

export function validationResultRuntimeStatus(
	enabled: boolean,
	waiting: boolean,
	status?:
		| "valid"
		| "reachable"
		| "invalid"
		| "unreachable"
		| "error"
		| "skipped",
	errorCategory?: string,
): ProviderRuntimeStatus {
	if (!enabled || status === "skipped") return "disabled";
	if (waiting) return "waiting";
	if (!status || status === "valid" || status === "reachable") {
		return "healthy";
	}
	if (errorCategory === "timeout") return "timeout";
	return "error";
}

export function statusFromValidation(
	response: ProviderKeyValidationResponse,
): ProviderRuntimeStatus {
	const failedKeys = response.key_results.filter(
		(result) => result.status === "invalid" || result.status === "error",
	);
	const failedEndpoints = response.endpoint_results.filter(
		(result) => result.status === "unreachable",
	);
	const failures = [...failedKeys, ...failedEndpoints];

	if (response.valid && failures.length === 0) return "healthy";
	if (
		failures.length > 0 &&
		failures.every((result) => result.error_category === "timeout")
	) {
		return "timeout";
	}
	return "error";
}

export function isTimeoutError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	return (
		error.name === "TimeoutError" ||
		error.name === "AbortError" ||
		/timeout|timed out/i.test(error.message)
	);
}

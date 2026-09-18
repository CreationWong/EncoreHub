// Connection-health dots for the provider list and key/endpoint rows.

import { type MessageKey, t } from "../../i18n";
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

/** Chrome keys for each status; `t()` runs when presentation is requested. */
const STATUS_PRESENTATION: Record<
	ProviderRuntimeStatus,
	{ labelKey: MessageKey; className: string; pulse: boolean }
> = {
	disabled: {
		labelKey: "providers.disabled",
		className: "border border-border bg-transparent",
		pulse: false,
	},
	healthy: {
		labelKey: "providers.normal",
		className: "bg-success",
		pulse: false,
	},
	waiting: {
		labelKey: "providers.waitingCheck",
		className: "bg-warning",
		pulse: true,
	},
	timeout: {
		labelKey: "providers.timedOut",
		className: "bg-warning",
		pulse: false,
	},
	error: {
		labelKey: "providers.connectionFault",
		className: "bg-danger",
		pulse: false,
	},
};

/** Initial list-dot status before a connection check has run. */
export function defaultProviderRuntimeStatus(
	enabled: boolean,
	isDraft = false,
): ProviderRuntimeStatus {
	if (!enabled) return "disabled";
	return isDraft ? "waiting" : "healthy";
}

/** Resolve the current-locale label together with the status chrome. */
export function providerRuntimeStatusPresentation(
	status: ProviderRuntimeStatus,
): ProviderRuntimeStatusPresentation {
	const config = STATUS_PRESENTATION[status];
	return {
		label: t(config.labelKey),
		className: config.className,
		pulse: config.pulse,
	};
}

/** Map a key/endpoint validation row onto the shared status chrome. */
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

/** Collapse a full validation response into one provider-level status. */
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

/** True when a thrown error looks like a request timeout or abort. */
export function isTimeoutError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	return (
		error.name === "TimeoutError" ||
		error.name === "AbortError" ||
		/timeout|timed out/i.test(error.message)
	);
}

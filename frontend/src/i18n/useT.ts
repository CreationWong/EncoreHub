// React hook that re-renders when the active locale preference changes.

import { useCallback } from "react";
import { resolveLocalePack } from "./registry";
import { useLocalePreference } from "./runtime";
import { translate } from "./translate";
import type { MessageKey } from "./translate";
import type { MessageVars } from "./types";

/**
 * Bound translator for the currently resolved locale pack.
 */
export function useT(): (key: MessageKey, vars?: MessageVars) => string {
	const preference = useLocalePreference();
	const localeId = resolveLocalePack(preference).id;
	return useCallback(
		(key: MessageKey, vars?: MessageVars) => translate(localeId, key, vars),
		[localeId],
	);
}

/** Resolved catalog id for `Intl` formatters in components. */
export function useActiveLocaleId(): string {
	const preference = useLocalePreference();
	return resolveLocalePack(preference).id;
}

// Active locale preference for React hooks and non-React callers.
//
// Lives outside the settings store so `t()` / `useT()` cannot import it and
// create a cycle. Settings still persist the same preference.

import { create } from "zustand";
import { normalizeLocalePreference, resolveLocalePack } from "./registry";
import { applyDocumentLocale, translate } from "./translate";
import type { MessageKey } from "./translate";
import type { LocalePreference, MessageVars } from "./types";
import { SYSTEM_LOCALE } from "./types";

interface LocaleRuntimeState {
	preference: LocalePreference;
}

const useLocaleRuntime = create<LocaleRuntimeState>(() => ({
	preference: SYSTEM_LOCALE,
}));

/** Current stored preference (`system` or a registered catalog id). */
export function getLocalePreference(): LocalePreference {
	return useLocaleRuntime.getState().preference;
}

/** Apply a preference, resolve the pack, and update `document.lang`. */
export function setLocalePreference(next: LocalePreference): LocalePreference {
	const preference = normalizeLocalePreference(next);
	useLocaleRuntime.setState({ preference });
	applyDocumentLocale(resolveLocalePack(preference).id);
	return preference;
}

/** Catalog id actually used for translation right now. */
export function activeLocaleId(): string {
	return resolveLocalePack(getLocalePreference()).id;
}

/**
 * Translate using the active preference. Safe to call from stores.
 */
export function t(key: MessageKey, vars?: MessageVars): string {
	return translate(activeLocaleId(), key, vars);
}

/** Subscribe to the active preference so UI re-renders on language change. */
export function useLocalePreference(): LocalePreference {
	return useLocaleRuntime((state) => state.preference);
}

// Public i18n API. Importing this module registers bundled locale packs.

import "./locales";

export { SYSTEM_LOCALE } from "./types";
export type { LocalePack, LocalePreference, MessageVars } from "./types";
export {
	fallbackLocale,
	getLocale,
	listLocales,
	matchLocale,
	normalizeLocalePreference,
	registerLocale,
	registerLocales,
	resolveLocalePack,
} from "./registry";
export { applyDocumentLocale, intlLocale, translate } from "./translate";
export type { MessageKey } from "./translate";
export {
	activeLocaleId,
	getLocalePreference,
	setLocalePreference,
	t,
	useLocalePreference,
} from "./runtime";
export { useActiveLocaleId, useT } from "./useT";

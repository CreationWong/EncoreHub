// Catalog lookup and `{name}` interpolation.
//
// Missing keys fall through to the fallback pack (English) so a partial new
// language still renders a complete UI.

import type { en } from "./locales/en";
import { fallbackLocale, getLocale } from "./registry";
import type { LocalePack } from "./types";
import type {
	MessageKeyOf,
	MessageTree,
	MessageValue,
	MessageVars,
	PluralMessage,
} from "./types";

export type MessageKey = MessageKeyOf<typeof en>;

function isPlural(value: MessageValue | MessageTree): value is PluralMessage {
	return (
		typeof value === "object" &&
		value !== null &&
		"one" in value &&
		"other" in value &&
		typeof (value as PluralMessage).one === "string" &&
		typeof (value as PluralMessage).other === "string"
	);
}

function lookup(tree: MessageTree, key: string): MessageValue | undefined {
	const parts = key.split(".");
	let current: MessageTree | MessageValue | undefined = tree;
	for (const part of parts) {
		if (!current || typeof current === "string" || isPlural(current)) {
			return undefined;
		}
		current = current[part];
	}
	if (typeof current === "string" || isPlural(current)) return current;
	return undefined;
}

function interpolate(template: string, vars?: MessageVars): string {
	if (!vars) return template;
	return template.replace(/\{(\w+)\}/g, (match, name: string) => {
		const value = vars[name];
		return value == null ? match : String(value);
	});
}

function packFor(localeId: string): LocalePack {
	return getLocale(localeId) ?? fallbackLocale();
}

/**
 * Translate a key for a registered locale id, falling back to the default pack.
 */
export function translate(
	localeId: string,
	key: MessageKey,
	vars?: MessageVars,
): string {
	const pack = packFor(localeId);
	const fallback = fallbackLocale();
	const value =
		lookup(pack.messages, key) ??
		(pack.id === fallback.id ? undefined : lookup(fallback.messages, key));
	if (value == null) return key;
	if (typeof value === "string") return interpolate(value, vars);
	const form = vars?.count === 1 ? "one" : "other";
	return interpolate(value[form] ?? value.other, vars);
}

/** BCP 47 tag for `Intl` and the document language. */
export function intlLocale(localeId: string): string {
	return packFor(localeId).bcp47;
}

/**
 * Keep the host document language in sync with the resolved catalog.
 */
export function applyDocumentLocale(localeId: string): void {
	if (typeof document === "undefined") return;
	document.documentElement.lang = intlLocale(localeId);
}

// Locale pack registry.
//
// New languages register here (or via registerLocale) instead of being added
// to a closed union. Lookup never switches on `en` / `zh-CN`; it scores OS
// language tags against each pack's `matches` list.

import type { LocalePack, LocalePreference } from "./types";
import { SYSTEM_LOCALE } from "./types";

const packs = new Map<string, LocalePack>();
let fallbackId: string | null = null;

/**
 * Register one language pack. Duplicate ids replace the previous pack so tests
 * and hot reload can update a catalog without leaking entries.
 */
export function registerLocale(pack: LocalePack): void {
	const id = pack.id.trim();
	if (!id || id === SYSTEM_LOCALE) {
		throw new Error("Locale pack id must be a non-empty catalog id");
	}
	packs.set(id, { ...pack, id });
	if (pack.fallback) fallbackId = id;
}

/** Register several packs; the last `fallback: true` pack becomes the default. */
export function registerLocales(next: readonly LocalePack[]): void {
	for (const pack of next) registerLocale(pack);
}

/** Packs in registration order for pickers and tests. */
export function listLocales(): LocalePack[] {
	return [...packs.values()];
}

export function getLocale(id: string): LocalePack | undefined {
	return packs.get(id);
}

/**
 * Catalog used when a key or OS language is unknown. English is registered
 * with `fallback: true`; if that flag is missing, the first pack wins.
 */
export function fallbackLocale(): LocalePack {
	if (fallbackId) {
		const pack = packs.get(fallbackId);
		if (pack) return pack;
	}
	const first = packs.values().next().value as LocalePack | undefined;
	if (!first) {
		throw new Error("No locale packs registered");
	}
	return first;
}

function normalizeTag(tag: string): string {
	return tag.trim().toLowerCase().replace(/_/g, "-");
}

/**
 * Pick a pack for an OS or stored language tag using exact then prefix matches.
 *
 * This stays data-driven: Chinese, Japanese, or any later language is selected
 * because its pack listed the tag, not because translate() special-cases it.
 */
export function matchLocale(
	tag: string,
	candidates: readonly LocalePack[] = listLocales(),
): LocalePack {
	if (candidates.length === 0) return fallbackLocale();
	const normalized = normalizeTag(tag);
	if (!normalized) return fallbackLocale();

	const exact = candidates.find(
		(pack) =>
			normalizeTag(pack.id) === normalized ||
			pack.matches.some((item) => normalizeTag(item) === normalized),
	);
	if (exact) return exact;

	const prefix = normalized.split("-")[0] ?? normalized;
	const prefixed = candidates.find(
		(pack) =>
			normalizeTag(pack.id) === prefix ||
			pack.matches.some((item) => normalizeTag(item) === prefix),
	);
	return prefixed ?? fallbackLocale();
}

/**
 * Resolve a stored preference to a registered pack.
 */
export function resolveLocalePack(preference: LocalePreference): LocalePack {
	if (preference !== SYSTEM_LOCALE) {
		const pinned = getLocale(preference);
		if (pinned) return pinned;
	}
	const language =
		typeof navigator === "undefined" ? fallbackLocale().id : navigator.language;
	return matchLocale(language);
}

/** Persistable value: `system` or a known catalog id. */
export function normalizeLocalePreference(value: unknown): LocalePreference {
	if (value === SYSTEM_LOCALE) return SYSTEM_LOCALE;
	if (typeof value === "string" && getLocale(value)) return value;
	return SYSTEM_LOCALE;
}

// Shared types for the locale registry and message catalogs.
//
// English remains the key source of truth. Additional languages register a
// pack at startup; they are not enumerated in application unions, so a new
// language is a catalog file plus one register() call.

/** Follow the OS, or pin a registered locale id. */
export const SYSTEM_LOCALE = "system";

export type LocalePreference = typeof SYSTEM_LOCALE | string;

/** Simple plural forms; languages without English-style plurals repeat `other`. */
export interface PluralMessage {
	one: string;
	other: string;
}

export type MessageValue = string | PluralMessage;

export type MessageTree = {
	[key: string]: MessageValue | MessageTree;
};

/** Interpolation values. A numeric `count` selects `one` / `other` plural forms. */
export type MessageVars = Record<string, string | number>;

/**
 * Recursively collect dot-separated keys, treating `{one, other}` as a leaf.
 */
export type MessageKeyOf<T> = {
	[K in keyof T & string]: T[K] extends PluralMessage
		? K
		: T[K] extends string
			? K
			: T[K] extends MessageTree
				? `${K}.${MessageKeyOf<T[K]>}`
				: never;
}[keyof T & string];

/** Nested partial so a new language can land before every string is translated. */
export type DeepPartialMessages<T> = {
	[K in keyof T]?: T[K] extends PluralMessage
		? PluralMessage
		: T[K] extends string
			? string
			: T[K] extends object
				? DeepPartialMessages<T[K]>
				: T[K];
};

/**
 * One translatable language. Application code reads packs through the registry
 * instead of switching on locale ids.
 */
export interface LocalePack {
	/** Stable id stored in settings, e.g. `en` or `zh-CN`. */
	id: string;
	/** BCP 47 tag for `Intl` and `document.documentElement.lang`. */
	bcp47: string;
	/** Language name in that language, shown in the picker. */
	nativeName: string;
	/**
	 * OS language tags this pack should win for, lowercase recommended.
	 * Exact tags are tried before prefixes (`zh-cn` before `zh`).
	 */
	matches: readonly string[];
	/** When true, this pack is the fallback for missing keys and unknown OS languages. */
	fallback?: boolean;
	messages: MessageTree;
}

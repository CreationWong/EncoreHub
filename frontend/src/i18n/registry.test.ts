// Locale registry: matching is data-driven so a new language is a pack, not a code branch.
import { describe, expect, it } from "vitest";
import { fallbackLocale, listLocales, matchLocale } from "./registry";
import type { LocalePack } from "./types";
import "./locales";

function pack(
	id: string,
	matches: readonly string[],
	fallback = false,
): LocalePack {
	return {
		id,
		bcp47: id,
		nativeName: id,
		matches,
		fallback,
		messages: { hello: id },
	};
}

describe("locale registry", () => {
	it("ships English as the fallback and Chinese as a registered pack", () => {
		const ids = listLocales().map((item) => item.id);
		expect(ids).toContain("en");
		expect(ids).toContain("zh-CN");
		expect(fallbackLocale().id).toBe("en");
	});

	it("selects a later language from its match list without hardcoded id checks", () => {
		const packs = [
			pack("en", ["en"], true),
			pack("zh-CN", ["zh-CN", "zh-Hans", "zh"]),
			pack("ja", ["ja"]),
		];

		expect(matchLocale("ja-JP", packs).id).toBe("ja");
		expect(matchLocale("zh-CN", packs).id).toBe("zh-CN");
		expect(matchLocale("zh-TW", packs).id).toBe("zh-CN");
		expect(matchLocale("fr-FR", packs).id).toBe("en");
	});
});

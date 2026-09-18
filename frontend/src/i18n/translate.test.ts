import { beforeEach, describe, expect, it } from "vitest";
import { t, translate } from "./index";
import { setLocalePreference } from "./runtime";

describe("translate", () => {
	beforeEach(() => {
		setLocalePreference("en");
	});

	it("interpolates English copy and falls back for missing keys", () => {
		expect(t("common.cancel")).toBe("Cancel");
		expect(t("nav.closeTab", { name: "Settings" })).toBe("Close Settings tab");
		expect(translate("zh-CN", "common.cancel")).toBe("取消");
	});

	it("uses Chinese catalogs when that pack is active", () => {
		setLocalePreference("zh-CN");
		expect(t("settings.appearance")).toBe("外观");
		expect(t("language.label")).toBe("语言");
	});
});

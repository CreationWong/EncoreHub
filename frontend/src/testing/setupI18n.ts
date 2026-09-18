// Pin the translator to English without importing stores (those files mock
// services in tests, and a store import here would capture the unmocked module).
import { beforeEach } from "vitest";
import "../i18n/locales";
import { setLocalePreference } from "../i18n/runtime";

beforeEach(() => {
	setLocalePreference("en");
});

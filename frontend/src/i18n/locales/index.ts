// Bundled locale packs.
//
// To add a language: create `locales/<id>.ts` exporting a LocalePack, then
// append it to the registerLocales() list below. Do not add language ids to
// TypeScript unions or `if (locale === "zh-CN")` branches in application code.

import { registerLocales } from "../registry";
import { english } from "./en";
import { simplifiedChinese } from "./zh-CN";

registerLocales([english, simplifiedChinese]);

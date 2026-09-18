// English locale pack. Marked as fallback so missing keys in other languages
// still resolve. Adding Japanese or any later language does not edit this file.

import type { LocalePack, MessageTree } from "../types";
import { en } from "./messages-en";

export { en };

export const english: LocalePack = {
	id: "en",
	bcp47: "en-US",
	nativeName: "English",
	matches: ["en"],
	fallback: true,
	messages: en as unknown as MessageTree,
};

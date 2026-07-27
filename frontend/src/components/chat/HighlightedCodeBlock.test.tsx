import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Theme } from "../../stores/settingsStore";
import { useSettingsStore } from "../../stores/settingsStore";
import HighlightedCodeBlock from "./HighlightedCodeBlock";

afterEach(cleanup);

describe("HighlightedCodeBlock", () => {
	it.each(["light", "dark"] satisfies Theme[])(
		"keeps multiline code backgrounds uniform in %s mode",
		(theme) => {
			useSettingsStore.setState({ theme });
			const { container } = render(
				<HighlightedCodeBlock
					language="python"
					value={[
						"def first():",
						"    return 1",
						"",
						"def second():",
						"    return 2",
					].join("\n")}
				/>,
			);

			const code = container.querySelector("code");
			expect(code).not.toBeNull();
			expect(code?.style.background).toBe("transparent");
			expect(code?.querySelector(".token")?.getAttribute("style")).toContain(
				"color",
			);
		},
	);
});

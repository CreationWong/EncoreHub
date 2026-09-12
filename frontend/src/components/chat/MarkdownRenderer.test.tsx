import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "../../stores/settingsStore";
import MarkdownRenderer from "./MarkdownRenderer";

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	useSettingsStore.setState({ mathRenderer: "katex" });
});

describe("MarkdownRenderer", () => {
	it("renders GFM tables, task lists, and strikethrough", () => {
		const markdown = [
			"| Name | Value |",
			"| --- | ---: |",
			"| DNS | 53 |",
			"",
			"- [x] resolved",
			"",
			"~~obsolete~~",
		].join("\n");

		const { container } = render(<MarkdownRenderer content={markdown} />);

		expect(container.querySelector("table")).not.toBeNull();
		expect(screen.getByText("DNS")).not.toBeNull();
		expect(screen.getByText("53")).not.toBeNull();
		const checkbox = container.querySelector<HTMLInputElement>(
			'input[type="checkbox"]',
		);
		expect(checkbox).not.toBeNull();
		expect(checkbox?.checked).toBe(true);
		expect(container.querySelector("del")?.textContent).toBe("obsolete");
	});

	it("opens external links safely and strips unsafe link protocols", () => {
		const markdown = "[site](https://example.com) [bad](javascript:alert(1))";
		const { container } = render(<MarkdownRenderer content={markdown} />);

		const site = screen.getByRole("link", { name: "site" });
		expect(site.getAttribute("href")).toBe("https://example.com");
		expect(site.getAttribute("target")).toBeNull();
		expect(site.getAttribute("rel")).toContain("noopener");

		const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
		fireEvent.click(site);
		expect(openSpy).toHaveBeenCalledWith(
			"https://example.com",
			"_blank",
			"noopener,noreferrer",
		);
		openSpy.mockRestore();

		expect(container.querySelector('a[href^="javascript"]')).toBeNull();
		expect(screen.queryByRole("link", { name: "bad" })).toBeNull();
		expect(screen.getByText("bad")).not.toBeNull();
	});

	it("renders unlabeled fenced code with the shared code block UI", () => {
		const { container } = render(
			<MarkdownRenderer content={["```", "plain text", "```"].join("\n")} />,
		);

		expect(container.querySelector(".markdown-codeblock")).not.toBeNull();
		expect(container.textContent).toContain("text");
		expect(container.textContent).toContain("plain text");
	});

	it("typesets inline and block math with KaTeX by default", async () => {
		const { container } = render(
			<MarkdownRenderer
				content={[
					"Energy is $E = mc^2$.",
					"",
					"$$",
					"\\int_0^1 x\\,dx",
					"$$",
				].join("\n")}
			/>,
		);

		await waitFor(
			() => expect(container.querySelector(".katex-display")).not.toBeNull(),
			{ timeout: 10_000 },
		);
		expect(container.querySelector(".katex")).not.toBeNull();
	}, 15_000);

	it("switches to MathJax and renders self-contained SVG", async () => {
		useSettingsStore.setState({ mathRenderer: "mathjax" });

		const { container } = render(
			<MarkdownRenderer content={"Energy is $E = mc^2$."} />,
		);

		await waitFor(
			() => expect(container.querySelector("mjx-container")).not.toBeNull(),
			{ timeout: 10_000 },
		);
	});

	it("leaves LaTeX delimiters as plain text when math is off", async () => {
		useSettingsStore.setState({ mathRenderer: "off" });

		const { container } = render(
			<MarkdownRenderer content={"Energy is $E = mc^2$."} />,
		);

		expect(container.textContent).toContain("$E = mc^2$");
		expect(container.querySelector(".katex")).toBeNull();
		expect(container.querySelector("mjx-container")).toBeNull();
	});
});

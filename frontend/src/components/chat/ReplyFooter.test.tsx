import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import ReplyFooter, { formatTokenCount } from "./ReplyFooter";

afterEach(cleanup);

describe("ReplyFooter", () => {
	it("formats exact token totals and hides zero or unknown values", () => {
		expect(formatTokenCount(13126)).toBe("13,126 tokens");

		const { rerender } = render(
			<ReplyFooter content="" status="completed" tokenCount={0} />,
		);
		expect(screen.queryByText(/tokens/)).toBeNull();

		rerender(
			<ReplyFooter content="" status="completed" tokenCount={undefined} />,
		);
		expect(screen.queryByText(/tokens/)).toBeNull();

		rerender(<ReplyFooter content="" status="completed" tokenCount={13126} />);
		expect(screen.getByText("13,126 tokens")).toBeDefined();
	});

	it("keeps actions left and the metric group right-aligned for wrapping", () => {
		render(<ReplyFooter content="answer" status="stopped" tokenCount={160} />);

		const footer = screen.getByLabelText("Reply actions and status");
		expect(footer.className).toContain("flex-wrap");
		const metrics = screen.getByText("160 tokens").parentElement;
		expect(metrics?.className).toContain("ml-auto");
		expect(metrics?.className).toContain("justify-end");
		const copy = screen.getByRole("button", { name: "Copy reply" });
		expect(copy.className).toContain("h-7");
		expect(copy.className).toContain("w-7");
	});

	it("does not expose unavailable telemetry placeholders", () => {
		render(<ReplyFooter content="answer" status="completed" />);

		expect(screen.queryByText("tokens/s")).toBeNull();
		expect(screen.queryByText(/EOS|duration/i)).toBeNull();
	});

	it("renders persisted telemetry in rate, token, duration, reason order", () => {
		render(
			<ReplyFooter
				content="answer"
				status="completed"
				inputTokens={120}
				outputTokens={30}
				durationMs={1500}
				finishReason="length"
			/>,
		);

		const footer = screen.getByLabelText("Reply actions and status");
		expect(footer.textContent).toMatch(
			/20\.0 tokens\/s.*150 tokens.*1\.5 s.*Limit/,
		);
		expect(screen.getByTitle("Finish reason: length")).toBeDefined();
	});

	it("drops invalid or unbounded telemetry values", () => {
		render(
			<ReplyFooter
				content="answer"
				status="completed"
				inputTokens={Number.POSITIVE_INFINITY}
				outputTokens={1_000_000_001}
				durationMs={86_400_001}
			/>,
		);

		expect(screen.queryByText(/tokens/)).toBeNull();
		expect(screen.queryByTitle("Provider generation duration")).toBeNull();
	});
});

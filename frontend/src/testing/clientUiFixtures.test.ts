import { describe, expect, it } from "vitest";
import {
	CLIENT_UI_BASELINE_PROVIDERS,
	CLIENT_UI_BASELINE_THEMES,
	CLIENT_UI_BASELINE_VIEWPORTS,
	CLIENT_UI_SCENARIO_IDS,
	getClientUiScenario,
	parseClientUiBaselineOptions,
} from "./clientUiFixtures";

describe("client UI baseline fixtures", () => {
	it("pins the workflow viewport and theme matrix", () => {
		expect(CLIENT_UI_BASELINE_VIEWPORTS).toEqual([
			{ id: "wide", width: 1600, height: 1120 },
			{ id: "desktop", width: 1200, height: 800 },
			{ id: "compact", width: 900, height: 700 },
			{ id: "minimum", width: 680, height: 480 },
		]);
		expect(CLIENT_UI_BASELINE_THEMES).toEqual(["light", "dark"]);
	});

	it("covers every state required by CUI-00", () => {
		expect(CLIENT_UI_SCENARIO_IDS).toEqual([
			"no-conversation",
			"empty-conversation",
			"short",
			"long-markdown",
			"system-message",
			"reasoning",
			"tool-call",
			"streaming",
			"stopped",
			"failed",
			"provider-unavailable",
			"providers-locked",
		]);

		expect(
			getClientUiScenario("reasoning").messages[1]?.reasoning,
		).toBeTruthy();
		expect(
			getClientUiScenario("tool-call").messages[1]?.tool_calls,
		).toHaveLength(1);
		expect(getClientUiScenario("streaming").streaming).toBe(true);
		expect(getClientUiScenario("stopped").messages[1]?.status).toBe("stopped");
		expect(getClientUiScenario("failed").messages[1]?.status).toBe("failed");
		expect(
			getClientUiScenario("provider-unavailable").unavailableProvider,
		).toBe(true);
	});

	it("keeps synthetic providers free of API keys", () => {
		for (const provider of CLIENT_UI_BASELINE_PROVIDERS) {
			expect(Object.keys(provider)).not.toContain("api_key");
			expect(JSON.stringify(provider)).not.toMatch(/sk-[A-Za-z0-9]/);
		}
	});

	it("clones mutable messages between fixture reads", () => {
		const first = getClientUiScenario("tool-call");
		const second = getClientUiScenario("tool-call");
		first.messages[1]?.tool_calls.push({
			id: "mutation",
			name: "mutation",
			arguments: "{}",
		});
		expect(second.messages[1]?.tool_calls).toHaveLength(1);
	});

	it("uses stable URL defaults and accepts known options", () => {
		expect(parseClientUiBaselineOptions("")).toEqual({
			scenarioId: "long-markdown",
			theme: "light",
			sidebar: "conversations",
		});
		expect(
			parseClientUiBaselineOptions(
				"?scenario=streaming&theme=dark&sidebar=characters",
			),
		).toEqual({
			scenarioId: "streaming",
			theme: "dark",
			sidebar: "characters",
		});
		expect(
			parseClientUiBaselineOptions(
				"?scenario=unknown&theme=sepia&sidebar=unknown",
			),
		).toEqual({
			scenarioId: "long-markdown",
			theme: "light",
			sidebar: "conversations",
		});
		expect(parseClientUiBaselineOptions("?sidebar=closed").sidebar).toBe(
			"closed",
		);
		expect(parseClientUiBaselineOptions("?sidebar=focus").sidebar).toBe(
			"focus",
		);
	});
});

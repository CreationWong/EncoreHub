import { describe, expect, it } from "vitest";
import type { ProviderProfile } from "../../services/providers";
import {
	chatRequestPreview,
	isValidBaseUrl,
	modelDiscoveryPreview,
	normalizeBaseUrl,
	profileEndpoints,
	profileModelConfigs,
	providerApiBaseUrl,
} from "./providerConfig";

const profile: ProviderProfile = {
	id: "custom",
	name: "Custom",
	protocol: "openai",
	base_url: "https://api.example.com/v1/",
	models: ["model-a"],
	enabled: true,
	builtin: false,
};

describe("provider URL helpers", () => {
	it("normalizes trailing slashes without rewriting custom paths", () => {
		expect(normalizeBaseUrl(" https://api.example.com/custom/v1/// ")).toBe(
			"https://api.example.com/custom/v1",
		);
		expect(
			chatRequestPreview("openai", "https://api.example.com/custom/v1/"),
		).toBe("https://api.example.com/custom/v1/chat/completions");
		expect(chatRequestPreview("anthropic", "http://127.0.0.1:9000/v1")).toBe(
			"http://127.0.0.1:9000/v1/messages",
		);
		expect(
			modelDiscoveryPreview("openai", "https://api.example.com/v1/models"),
		).toBe("https://api.example.com/v1/models");
	});

	it("accepts HTTP local endpoints but rejects credentials and query secrets", () => {
		expect(isValidBaseUrl("http://localhost:11434/v1")).toBe(true);
		expect(isValidBaseUrl("https://api.example.com/v1")).toBe(true);
		expect(isValidBaseUrl("https://user:pass@example.com/v1")).toBe(false);
		expect(isValidBaseUrl("https://api.example.com/v1?key=secret")).toBe(false);
	});

	it("completes protocol paths when only a domain is entered", () => {
		expect(providerApiBaseUrl("openai", "https://gateway.example.com")).toBe(
			"https://gateway.example.com/openai/v1",
		);
		expect(modelDiscoveryPreview("openai", "https://gateway.example.com")).toBe(
			"https://gateway.example.com/openai/v1/models",
		);
		expect(chatRequestPreview("openai", "https://gateway.example.com")).toBe(
			"https://gateway.example.com/openai/v1/chat/completions",
		);
		expect(
			modelDiscoveryPreview("anthropic", "https://gateway.example.com"),
		).toBe("https://gateway.example.com/anthropic/v1/models");
		expect(chatRequestPreview("anthropic", "https://gateway.example.com")).toBe(
			"https://gateway.example.com/anthropic/v1/messages",
		);
	});

	it("completes API prefixes without duplicating the protocol segment", () => {
		expect(
			providerApiBaseUrl("openai", "https://gateway.example.com/api"),
		).toBe("https://gateway.example.com/api/openai/v1");
		expect(
			providerApiBaseUrl("anthropic", "https://gateway.example.com/api"),
		).toBe("https://gateway.example.com/api/anthropic/v1");
		expect(
			providerApiBaseUrl(
				"anthropic",
				"https://gateway.example.com/api/anthropic",
			),
		).toBe("https://gateway.example.com/api/anthropic/v1");
		expect(
			modelDiscoveryPreview(
				"anthropic",
				"https://gateway.example.com/api/anthropic",
			),
		).toBe("https://gateway.example.com/api/anthropic/v1/models");
		expect(
			chatRequestPreview(
				"anthropic",
				"https://gateway.example.com/api/anthropic",
			),
		).toBe("https://gateway.example.com/api/anthropic/v1/messages");
	});

	it("preserves an existing v1 API path", () => {
		expect(
			providerApiBaseUrl("anthropic", "https://api.anthropic.com/v1"),
		).toBe("https://api.anthropic.com/v1");
		expect(
			providerApiBaseUrl("openai", "https://gateway.example.com/api/v1"),
		).toBe("https://gateway.example.com/api/v1");
	});
});

describe("legacy provider migration", () => {
	it("hydrates one primary endpoint from base_url", () => {
		expect(profileEndpoints(profile)).toEqual([
			{
				id: "primary",
				name: "Primary",
				base_url: "https://api.example.com/v1",
				enabled: true,
			},
		]);
	});

	it("hydrates model metadata without changing model ids", () => {
		expect(profileModelConfigs(profile)[0]).toMatchObject({
			id: "model-a",
			name: "model-a",
			streaming: true,
			currency: "USD",
		});
	});
});

import { describe, expect, it, vi } from "vitest";
import { SLASH_COMMANDS, matchCommands } from "./slash";

type Stores = Parameters<(typeof SLASH_COMMANDS)[0]["run"]>[1];

function fakeStores(overrides: Partial<Stores["conv"] & Stores["settings"]> = {}) {
	const conv = {
		newConversation: vi.fn().mockResolvedValue("c1"),
		deleteConversation: vi.fn().mockResolvedValue(undefined),
		stopStreaming: vi.fn(),
		pushSystemMessage: vi.fn(),
		activeId: null,
		...overrides,
	};
	const settings = {
		openSettings: vi.fn(),
		...overrides,
	};
	return {
		conv: conv as unknown as Stores["conv"],
		settings: settings as unknown as Stores["settings"],
		_conv: conv,
		_settings: settings,
	};
}

describe("matchCommands", () => {
	it("returns the full set on bare /", () => {
		expect(matchCommands("/").length).toBe(SLASH_COMMANDS.length);
	});
	it("filters by prefix", () => {
		const r = matchCommands("/he");
		expect(r.length).toBeGreaterThan(0);
		expect(r.every((c) => c.id.startsWith("he"))).toBe(true);
	});
	it("returns empty when no match", () => {
		expect(matchCommands("/zzzz")).toEqual([]);
	});
});

describe("SLASH_COMMANDS registry", () => {
	it("has unique ids", () => {
		const ids = SLASH_COMMANDS.map((c) => c.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
	it("every command name starts with /", () => {
		for (const c of SLASH_COMMANDS) {
			expect(c.name.startsWith("/")).toBe(true);
			expect(c.name.slice(1)).toBe(c.id);
		}
	});
});

function find(id: string) {
	const cmd = SLASH_COMMANDS.find((c) => c.id === id);
	if (!cmd) throw new Error(`missing slash command: ${id}`);
	return cmd;
}

describe("command handlers", () => {
	it("/new triggers newConversation", async () => {
		const s = fakeStores();
		await find("new").run("", { conv: s.conv, settings: s.settings });
		expect(s._conv.newConversation).toHaveBeenCalledOnce();
	});

	it("/clear deletes when an active conversation exists", async () => {
		const s = fakeStores({ activeId: "c1" });
		await find("clear").run("", { conv: s.conv, settings: s.settings });
		expect(s._conv.deleteConversation).toHaveBeenCalledWith("c1");
	});

	it("/clear is a no-op when nothing is active", async () => {
		const s = fakeStores({ activeId: null });
		await find("clear").run("", { conv: s.conv, settings: s.settings });
		expect(s._conv.deleteConversation).not.toHaveBeenCalled();
	});

	it("/stop calls stopStreaming", async () => {
		const s = fakeStores();
		await find("stop").run("", { conv: s.conv, settings: s.settings });
		expect(s._conv.stopStreaming).toHaveBeenCalledOnce();
	});

	it("/settings opens settings", async () => {
		const s = fakeStores();
		await find("settings").run("", { conv: s.conv, settings: s.settings });
		expect(s._settings.openSettings).toHaveBeenCalled();
	});

	it("/skills opens settings on skills tab", async () => {
		const s = fakeStores();
		await find("skills").run("", { conv: s.conv, settings: s.settings });
		expect(s._settings.openSettings).toHaveBeenCalledWith("skills");
	});

	it("/help pushes a system message instead of returning text", async () => {
		const s = fakeStores();
		const result = await find("help").run("", {
			conv: s.conv,
			settings: s.settings,
		});
		expect(result).toBeUndefined();
		expect(s._conv.pushSystemMessage).toHaveBeenCalledOnce();
		const body = s._conv.pushSystemMessage.mock.calls[0][0] as string;
		expect(body).toContain("/help");
		expect(body).toContain("/new");
	});
});

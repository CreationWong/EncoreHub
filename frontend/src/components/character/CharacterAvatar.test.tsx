import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_CHARACTER_ID } from "../../services/characters";
import CharacterAvatar from "./CharacterAvatar";

afterEach(cleanup);

describe("CharacterAvatar", () => {
	it("keeps the default character bot icon instead of rendering initials", () => {
		const { container } = render(
			<CharacterAvatar
				characterId={DEFAULT_CHARACTER_ID}
				name="Default character"
			/>,
		);

		expect(screen.queryByText("DC")).toBeNull();
		expect(container.querySelector("svg")).not.toBeNull();
	});

	it("falls back to stable initials when an avatar cannot be loaded", () => {
		const { container } = render(
			<CharacterAvatar
				avatar="https://example.com/missing.png"
				characterId="archivist"
				name="跨平台发布研究档案管理员"
				size="large"
			/>,
		);

		const image = container.querySelector("img");
		expect(image).not.toBeNull();
		if (image) fireEvent.error(image);

		expect(screen.getByText("跨平")).toBeDefined();
		expect(container.querySelector("img")).toBeNull();
	});
});

import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CharacterUpgradePreview } from "../../services/characters";
import type { Conversation } from "../../services/conversation";
import { useConversationStore } from "../../stores/conversationStore";

const previewCharacterUpgrade = vi.fn();

vi.mock("../../services/characters", () => ({
	previewCharacterUpgrade: (...args: unknown[]) =>
		previewCharacterUpgrade(...args),
}));

import CharacterUpgradeDialog from "./CharacterUpgradeDialog";

const currentSnapshot = {
	name: "Archivist",
	avatar: "",
	description: "Old description",
	system_prompt: "Use sources.",
	opening_message: "What should we inspect?",
	tags: ["research"],
};

const conversation: Conversation = {
	id: "conv-1",
	title: "Research",
	provider: "openai",
	model: "gpt-4.1-mini",
	character_id: "archivist",
	character_version: 1,
	character_snapshot: currentSnapshot,
	message_count: 2,
	created_at: "",
	updated_at: "",
};

const preview: CharacterUpgradePreview = {
	conversation_id: "conv-1",
	character_id: "archivist",
	from_version: 1,
	to_version: 2,
	changed: true,
	changed_fields: ["description", "system_prompt", "model"],
	current_snapshot: currentSnapshot,
	proposed_snapshot: {
		...currentSnapshot,
		description: "New description",
		system_prompt: "Use primary sources.",
	},
	current_provider: "openai",
	proposed_provider: "openai",
	current_model: "gpt-4.1-mini",
	proposed_model: "gpt-4.1",
};

const upgrade = vi.fn();

beforeEach(() => {
	previewCharacterUpgrade.mockReset().mockResolvedValue(preview);
	upgrade.mockReset().mockResolvedValue({
		...conversation,
		character_version: 2,
		character_snapshot: preview.proposed_snapshot,
		model: preview.proposed_model,
	});
	useConversationStore.setState({ upgradeConversationCharacter: upgrade });
});

afterEach(cleanup);

describe("CharacterUpgradeDialog", () => {
	it("loads and compares the immutable snapshot with the latest profile", async () => {
		render(
			<CharacterUpgradeDialog conversation={conversation} latestVersion={2} />,
		);
		fireEvent.click(
			screen.getByRole("button", { name: "Review character update" }),
		);

		await waitFor(() =>
			expect(previewCharacterUpgrade).toHaveBeenCalledWith("conv-1"),
		);
		expect(screen.getAllByText("Current snapshot")).toHaveLength(3);
		expect(screen.getAllByText("Latest profile")).toHaveLength(3);
		expect(screen.getByText("Use primary sources.")).toBeDefined();
		expect(screen.getByText("gpt-4.1")).toBeDefined();
	});

	it("applies only after explicit confirmation", async () => {
		render(
			<CharacterUpgradeDialog conversation={conversation} latestVersion={2} />,
		);
		fireEvent.click(
			screen.getByRole("button", { name: "Review character update" }),
		);
		await screen.findByRole("button", { name: "Apply update" });
		expect(upgrade).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole("button", { name: "Apply update" }));
		await waitFor(() => expect(upgrade).toHaveBeenCalledWith("conv-1", 1));
	});

	it("does not render an upgrade command for a current snapshot", () => {
		render(
			<CharacterUpgradeDialog conversation={conversation} latestVersion={1} />,
		);
		expect(
			screen.queryByRole("button", { name: "Review character update" }),
		).toBeNull();
	});
});

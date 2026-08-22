import { describe, expect, it } from "vitest";

import { isQuickPromptVisibleInColumn } from "@/quick-prompts/quick-prompt-utils";

describe("isQuickPromptVisibleInColumn", () => {
	it("shows global prompts only in active workflow columns", () => {
		const quickPrompt = { label: "Continue", prompt: "Please continue.", context: "any" as const };

		expect(isQuickPromptVisibleInColumn(quickPrompt, "in_progress")).toBe(true);
		expect(isQuickPromptVisibleInColumn(quickPrompt, "review")).toBe(true);
		expect(isQuickPromptVisibleInColumn(quickPrompt, "on_hold")).toBe(false);
		expect(isQuickPromptVisibleInColumn(quickPrompt, "trash")).toBe(false);
	});

	it("limits context-specific prompts to their configured column", () => {
		const quickPrompt = { label: "Ship it", prompt: "Open a PR.", context: "review" as const };

		expect(isQuickPromptVisibleInColumn(quickPrompt, "in_progress")).toBe(false);
		expect(isQuickPromptVisibleInColumn(quickPrompt, "review")).toBe(true);
	});
});

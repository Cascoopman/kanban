import { describe, expect, it } from "vitest";

import { DEFAULT_TASK_TITLE_MAX_CHARS, deriveTaskTitleFromPrompt, validateTaskTitle } from "../../src/core/task-title";

describe("task titles", () => {
	it("keeps generated title ellipses within the title limit", () => {
		const title = deriveTaskTitleFromPrompt("x".repeat(DEFAULT_TASK_TITLE_MAX_CHARS + 20));

		expect(title).toHaveLength(DEFAULT_TASK_TITLE_MAX_CHARS);
		expect(title.endsWith("…")).toBe(true);
		expect(validateTaskTitle(title)).toBe(title);
	});
});

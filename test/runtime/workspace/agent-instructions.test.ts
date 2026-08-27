import { afterEach, describe, expect, it } from "vitest";

import { getAgentInstructionsPath, loadAgentInstructionsFile } from "../../../src/workspace/agent-instructions";
import { createTempDir } from "../../utilities/temp-dir";

const cleanups: Array<() => void> = [];

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) {
		cleanup();
	}
});

describe("agent instructions", () => {
	it("loads project instructions without exposing a project save operation", async () => {
		const workspace = createTempDir("kanban-agent-instructions-");
		cleanups.push(workspace.cleanup);

		await expect(loadAgentInstructionsFile(workspace.path)).resolves.toEqual({
			path: getAgentInstructionsPath(workspace.path),
			content: "",
			exists: false,
		});
	});
});

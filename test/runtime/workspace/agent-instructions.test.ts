import { lstatSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
	getAgentInstructionsPath,
	loadAgentInstructionsFile,
	saveAgentInstructionsFile,
} from "../../../src/workspace/agent-instructions";
import { createTempDir } from "../../utilities/temp-dir";

const cleanups: Array<() => void> = [];

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) {
		cleanup();
	}
});

describe("workspace AGENTS.md", () => {
	it("loads a missing file as an empty draft and creates it on save", async () => {
		const workspace = createTempDir("kanban-agent-instructions-");
		cleanups.push(workspace.cleanup);

		await expect(loadAgentInstructionsFile(workspace.path)).resolves.toEqual({
			path: getAgentInstructionsPath(workspace.path),
			content: "",
			exists: false,
		});

		const saved = await saveAgentInstructionsFile(workspace.path, "# Instructions\n\nBe concise.\n");

		expect(saved).toEqual({
			path: getAgentInstructionsPath(workspace.path),
			content: "# Instructions\n\nBe concise.\n",
			exists: true,
		});
		expect(readFileSync(saved.path, "utf8")).toBe(saved.content);
	});

	it.skipIf(process.platform === "win32")(
		"updates a symlink target without replacing the AGENTS.md symlink",
		async () => {
			const workspace = createTempDir("kanban-agent-instructions-workspace-");
			const shared = createTempDir("kanban-agent-instructions-shared-");
			cleanups.push(workspace.cleanup, shared.cleanup);
			const targetPath = join(shared.path, "AGENTS.md");
			const workspacePath = getAgentInstructionsPath(workspace.path);
			writeFileSync(targetPath, "Old instructions\n");
			symlinkSync(targetPath, workspacePath);

			await saveAgentInstructionsFile(workspace.path, "Shared instructions\n");

			expect(lstatSync(workspacePath).isSymbolicLink()).toBe(true);
			expect(readFileSync(targetPath, "utf8")).toBe("Shared instructions\n");
		},
	);
});

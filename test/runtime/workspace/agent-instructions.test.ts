import { lstatSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
	getAgentInstructionsPath,
	getGlobalAgentInstructionsPath,
	loadAgentInstructionsFile,
	loadGlobalAgentInstructionsFile,
	saveGlobalAgentInstructionsFile,
} from "../../../src/workspace/agent-instructions";
import { createTempDir } from "../../utilities/temp-dir";

const cleanups: Array<() => void> = [];
const originalHome = process.env.HOME;

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) {
		cleanup();
	}
	if (originalHome === undefined) {
		delete process.env.HOME;
	} else {
		process.env.HOME = originalHome;
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

	it.skipIf(process.platform === "win32")(
		"updates a global symlink target without replacing the AGENTS.md symlink",
		async () => {
			const home = createTempDir("kanban-agent-instructions-home-");
			const shared = createTempDir("kanban-agent-instructions-shared-");
			cleanups.push(home.cleanup, shared.cleanup);
			process.env.HOME = home.path;
			const targetPath = join(shared.path, "AGENTS.md");
			const globalPath = getGlobalAgentInstructionsPath();
			mkdirSync(join(home.path, ".kanban"), { recursive: true });
			writeFileSync(targetPath, "Old instructions\n");
			symlinkSync(targetPath, globalPath);

			await saveGlobalAgentInstructionsFile("Shared instructions\n");

			expect(lstatSync(globalPath).isSymbolicLink()).toBe(true);
			expect(readFileSync(targetPath, "utf8")).toBe("Shared instructions\n");
		},
	);

	it("stores Kanban-wide instructions under the runtime home", async () => {
		const home = createTempDir("kanban-agent-instructions-home-");
		cleanups.push(home.cleanup);
		process.env.HOME = home.path;

		await expect(loadGlobalAgentInstructionsFile()).resolves.toEqual({
			path: getGlobalAgentInstructionsPath(),
			content: "",
			exists: false,
		});

		const saved = await saveGlobalAgentInstructionsFile("# Kanban instructions\n");

		expect(saved.path).toBe(join(home.path, ".kanban", "AGENTS.md"));
		expect(readFileSync(saved.path, "utf8")).toBe("# Kanban instructions\n");
	});
});

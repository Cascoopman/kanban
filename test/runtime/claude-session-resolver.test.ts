import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { resolveClaudeSessionIdForCwd } from "../../src/terminal/claude-session-resolver";

describe("resolveClaudeSessionIdForCwd", () => {
	it("returns the newest root Claude session for the task cwd", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "kanban-claude-session-resolver-"));
		const projectsRoot = join(tempDir, "projects");
		const projectDir = join(projectsRoot, "encoded-project");
		const cwd = "/tmp/kanban/task-1";
		try {
			await mkdir(projectDir, { recursive: true });
			const oldPath = join(projectDir, "old-id.jsonl");
			const sidechainPath = join(projectDir, "sidechain-id.jsonl");
			const newPath = join(projectDir, "new-id.jsonl");
			await writeFile(
				oldPath,
				[
					JSON.stringify({ type: "last-prompt", sessionId: "old-id" }),
					JSON.stringify({ type: "user", cwd, sessionId: "old-id", isSidechain: false }),
				].join("\n"),
			);
			await writeFile(
				sidechainPath,
				`${JSON.stringify({ type: "user", cwd, sessionId: "sidechain-id", isSidechain: true })}\n`,
			);
			await writeFile(
				newPath,
				[
					JSON.stringify({ type: "queue-operation", sessionId: "new-id" }),
					JSON.stringify({ type: "attachment", cwd, sessionId: "new-id", isSidechain: false }),
				].join("\n"),
			);
			await utimes(oldPath, new Date(1_000), new Date(1_000));
			await utimes(sidechainPath, new Date(3_000), new Date(3_000));
			await utimes(newPath, new Date(2_000), new Date(2_000));

			await expect(resolveClaudeSessionIdForCwd(cwd, projectsRoot)).resolves.toBe("new-id");
		} finally {
			await rm(tempDir, { recursive: true, force: true });
		}
	});
});

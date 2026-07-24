import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { resolveCodexSessionIdForCwd } from "../../src/terminal/codex-session-resolver";

describe("resolveCodexSessionIdForCwd", () => {
	it("returns the newest root Codex session for the task cwd", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "kanban-codex-session-resolver-"));
		const sessionsRoot = join(tempDir, "sessions", "2026", "07", "23");
		const cwd = "/tmp/kanban/task-1";
		try {
			await mkdir(sessionsRoot, { recursive: true });
			await writeFile(
				join(sessionsRoot, "rollout-2026-07-23T10-00-00-old.jsonl"),
				`${JSON.stringify({ type: "session_meta", payload: { id: "old-id", cwd, source: "cli" } })}\n`,
			);
			await writeFile(
				join(sessionsRoot, "rollout-2026-07-23T11-00-00-subagent.jsonl"),
				`${JSON.stringify({
					type: "session_meta",
					payload: { id: "subagent-id", cwd, source: { subagent: { thread_spawn: {} } } },
				})}\n`,
			);
			await writeFile(
				join(sessionsRoot, "rollout-2026-07-23T12-00-00-new.jsonl"),
				`${JSON.stringify({ type: "session_meta", payload: { id: "new-id", cwd, source: "cli" } })}\n`,
			);

			await expect(resolveCodexSessionIdForCwd(cwd, join(tempDir, "sessions"))).resolves.toBe("new-id");
		} finally {
			await rm(tempDir, { recursive: true, force: true });
		}
	});
});

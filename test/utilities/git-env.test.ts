import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { devNull } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createGitProcessEnv } from "../../src/core/git-process-env";
import { createGitTestEnv } from "./git-env";
import { createTempDir } from "./temp-dir";

function runGit(cwd: string, args: string[]): string {
	const result = spawnSync("git", args, {
		cwd,
		encoding: "utf8",
		env: createGitTestEnv(),
	});
	if (result.status !== 0) {
		throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
	}
	return result.stdout.trim();
}

function runGitWithProcessEnvironment(cwd: string, args: string[]): string {
	const result = spawnSync("git", args, {
		cwd,
		encoding: "utf8",
		env: createGitProcessEnv({
			GIT_AUTHOR_NAME: "Test",
			GIT_AUTHOR_EMAIL: "test@test.com",
			GIT_COMMITTER_NAME: "Test",
			GIT_COMMITTER_EMAIL: "test@test.com",
			GIT_CONFIG_NOSYSTEM: "1",
			GIT_CONFIG_GLOBAL: devNull,
		}),
	});
	if (result.status !== 0) {
		throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
	}
	return result.stdout.trim();
}

function withEnvironment<T>(overrides: NodeJS.ProcessEnv, run: () => T): T {
	const previous = new Map<string, string | undefined>();
	for (const [key, value] of Object.entries(overrides)) {
		previous.set(key, process.env[key]);
		if (value === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = value;
		}
	}
	try {
		return run();
	} finally {
		for (const [key, value] of previous) {
			if (value === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = value;
			}
		}
	}
}

describe("createGitTestEnv", () => {
	it("keeps fixture commits out of a poisoned hook checkout", () => {
		const { path: sandbox, cleanup } = createTempDir("kanban-git-test-env-");
		try {
			const realCheckout = join(sandbox, "real-checkout");
			const fixtureCheckout = join(sandbox, "fixture-checkout");
			mkdirSync(realCheckout, { recursive: true });
			mkdirSync(fixtureCheckout, { recursive: true });

			runGit(realCheckout, ["init"]);
			writeFileSync(join(realCheckout, "README.md"), "real checkout\n", "utf8");
			runGit(realCheckout, ["add", "README.md"]);
			runGit(realCheckout, ["commit", "-m", "Keep real checkout unchanged"]);

			withEnvironment(
				{
					GIT_DIR: join(realCheckout, ".git"),
					GIT_WORK_TREE: realCheckout,
					GIT_INDEX_FILE: join(realCheckout, ".git", "index"),
					GIT_CONFIG_COUNT: "1",
					GIT_CONFIG_KEY_0: "core.worktree",
					GIT_CONFIG_VALUE_0: realCheckout,
				},
				() => {
					runGitWithProcessEnvironment(fixtureCheckout, ["init"]);
					writeFileSync(join(fixtureCheckout, "fixture.md"), "fixture checkout\n", "utf8");
					runGitWithProcessEnvironment(fixtureCheckout, ["add", "fixture.md"]);
					runGitWithProcessEnvironment(fixtureCheckout, ["commit", "-m", "Commit fixture only"]);
				},
			);

			expect(runGit(realCheckout, ["status", "--porcelain"])).toBe("");
			expect(runGit(realCheckout, ["log", "-1", "--format=%s"])).toBe("Keep real checkout unchanged");
			expect(runGit(fixtureCheckout, ["log", "-1", "--format=%s"])).toBe("Commit fixture only");
		} finally {
			cleanup();
		}
	});
});

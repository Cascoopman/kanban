import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const childProcessMocks = vi.hoisted(() => ({
	execFile: vi.fn(),
	execFilePromise: vi.fn(),
}));

vi.mock("node:child_process", () => ({
	execFile: Object.assign(childProcessMocks.execFile, {
		[promisify.custom]: childProcessMocks.execFilePromise,
	}),
}));

import { closeGitSshMultiplexing, initializeGitSshMultiplexing } from "../../src/core/git-ssh-multiplexing";
import { runGit } from "../../src/workspace/git-utils";

describe.runIf(process.platform !== "win32")("runGit SSH multiplexing", () => {
	const isolatedGitEnv: NodeJS.ProcessEnv = {
		PATH: process.env.PATH,
	};

	beforeEach(() => {
		childProcessMocks.execFile.mockReset();
		childProcessMocks.execFilePromise.mockReset();
	});

	afterEach(async () => {
		await closeGitSshMultiplexing();
	});

	it("preserves core.sshCommand while adding the runtime control connection", async () => {
		childProcessMocks.execFilePromise.mockImplementation(async (_file: string, args: string[]) => {
			const command = args.join(" ");
			if (command === "config --get core.sshCommand") {
				return { stdout: "ssh -i ~/.ssh/work\n", stderr: "" };
			}
			if (command === "config --get ssh.variant") {
				throw new Error("not configured");
			}
			return { stdout: "", stderr: "" };
		});
		expect(initializeGitSshMultiplexing()).toBe(true);

		await expect(runGit("/tmp", ["fetch", "--all", "--prune"], { env: isolatedGitEnv })).resolves.toMatchObject({
			ok: true,
		});
		await expect(runGit("/tmp", ["fetch", "--all", "--prune"], { env: isolatedGitEnv })).resolves.toMatchObject({
			ok: true,
		});

		const fetchCalls = childProcessMocks.execFilePromise.mock.calls.filter(([, args]) =>
			(args as string[]).includes("fetch"),
		);
		expect(fetchCalls).toHaveLength(2);
		const firstFetchOptions = fetchCalls[0]?.[2] as { env?: NodeJS.ProcessEnv } | undefined;
		const secondFetchOptions = fetchCalls[1]?.[2] as { env?: NodeJS.ProcessEnv } | undefined;
		expect(firstFetchOptions?.env?.GIT_SSH_COMMAND).toContain("ssh -i ~/.ssh/work");
		expect(firstFetchOptions?.env?.GIT_SSH_COMMAND).toContain("ControlMaster=auto");
		expect(firstFetchOptions?.env?.GIT_SSH_COMMAND).toContain("ControlPersist=8h");
		expect(firstFetchOptions?.env?.GIT_SSH_VARIANT).toBe("ssh");
		expect(secondFetchOptions?.env?.GIT_SSH_COMMAND).toBe(firstFetchOptions?.env?.GIT_SSH_COMMAND);
		expect(
			childProcessMocks.execFilePromise.mock.calls.filter(
				([, args]) => (args as string[]).join(" ") === "config --get core.sshCommand",
			),
		).toHaveLength(1);
	});

	it("shares a socket across repositories that use the same SSH account", async () => {
		childProcessMocks.execFilePromise.mockImplementation(
			async (_file: string, args: string[]) => {
				const command = args.join(" ");
				if (command.startsWith("config --get")) {
					throw new Error("not configured");
				}
				return { stdout: "", stderr: "" };
			},
		);
		expect(initializeGitSshMultiplexing()).toBe(true);

		await runGit("/repos/main", ["fetch", "--all", "--prune"], { env: isolatedGitEnv });
		await runGit("/repos/worktree", ["fetch", "--all", "--prune"], { env: isolatedGitEnv });
		await runGit("/repos/personal", ["fetch", "--all", "--prune"], { env: isolatedGitEnv });

		const commands = childProcessMocks.execFilePromise.mock.calls
			.filter(([, args]) => (args as string[]).includes("fetch"))
			.map(([, , options]) => (options as { env?: NodeJS.ProcessEnv }).env?.GIT_SSH_COMMAND);
		expect(commands[1]).toBe(commands[0]);
		expect(commands[2]).toBe(commands[0]);
	});
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const gitMocks = vi.hoisted(() => ({
	runGit: vi.fn(),
}));

vi.mock("../../src/workspace/git-utils.js", () => ({
	runGit: gitMocks.runGit,
}));

import { refreshTaskBaseRefs, resolveLatestTaskBaseCommit } from "../../src/workspace/task-base-ref";

function gitResult(stdout = "", ok = true) {
	return {
		ok,
		stdout,
		stderr: "",
		output: stdout,
		error: ok ? null : "git failed",
		exitCode: ok ? 0 : 1,
	};
}

describe("task base ref refresh", () => {
	beforeEach(() => {
		gitMocks.runGit.mockReset();
	});

	it("fetches again for task creation after the workspace startup fetch", async () => {
		gitMocks.runGit.mockImplementation(async (_cwd: string, args: string[]) => {
			const command = args.join(" ");
			if (command === "fetch --all --prune") return gitResult();
			if (command === "rev-parse --verify main^{commit}") return gitResult("local-commit");
			if (command === "rev-parse --symbolic-full-name main") return gitResult("refs/heads/main");
			if (command === "for-each-ref --format=%(upstream:short) refs/heads/main") return gitResult("origin/main");
			if (command === "rev-parse --verify origin/main^{commit}") return gitResult("remote-commit");
			if (command === "merge-base --is-ancestor local-commit remote-commit") return gitResult();
			throw new Error(`Unexpected git command: ${command}`);
		});

		await refreshTaskBaseRefs("/tmp/kanban-startup-fetch-test");
		await expect(resolveLatestTaskBaseCommit("/tmp/kanban-startup-fetch-test", "main")).resolves.toBe(
			"remote-commit",
		);

		expect(
			gitMocks.runGit.mock.calls.filter(([, args]) => (args as string[]).join(" ") === "fetch --all --prune"),
		).toHaveLength(2);
	});

	it("shares only an in-flight refresh for the same repository", async () => {
		let finishFetch: ((result: ReturnType<typeof gitResult>) => void) | undefined;
		gitMocks.runGit.mockImplementation(
			async () =>
				await new Promise<ReturnType<typeof gitResult>>((resolveFetch) => {
					finishFetch = resolveFetch;
				}),
		);

		const first = refreshTaskBaseRefs("/tmp/kanban-concurrent-fetch-test");
		const second = refreshTaskBaseRefs("/tmp/kanban-concurrent-fetch-test");
		await Promise.resolve();
		expect(gitMocks.runGit).toHaveBeenCalledOnce();
		finishFetch?.(gitResult());

		await expect(Promise.all([first, second])).resolves.toHaveLength(2);
	});

	it("serializes startup refreshes across repositories so the SSH master can be reused", async () => {
		let finishFirstFetch: ((result: ReturnType<typeof gitResult>) => void) | undefined;
		gitMocks.runGit
			.mockImplementationOnce(
				async () =>
					await new Promise<ReturnType<typeof gitResult>>((resolveFetch) => {
						finishFirstFetch = resolveFetch;
					}),
			)
			.mockResolvedValueOnce(gitResult());

		const first = refreshTaskBaseRefs("/tmp/kanban-serial-fetch-a");
		const second = refreshTaskBaseRefs("/tmp/kanban-serial-fetch-b");
		await Promise.resolve();
		expect(gitMocks.runGit).toHaveBeenCalledOnce();

		finishFirstFetch?.(gitResult());
		await first;
		await second;
		expect(gitMocks.runGit).toHaveBeenCalledTimes(2);
	});
});

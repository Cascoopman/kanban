import { beforeEach, describe, expect, it, vi } from "vitest";

const gitMocks = vi.hoisted(() => ({
	runGit: vi.fn(),
}));

vi.mock("../../src/workspace/git-utils.js", () => ({
	runGit: gitMocks.runGit,
}));

import {
	createTaskBaseRefRefreshScheduler,
	refreshTaskBaseRefs,
	resolveLatestTaskBaseCommit,
} from "../../src/workspace/task-base-ref";

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

	it("reuses a recent startup fetch for task creation", async () => {
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
		).toHaveLength(1);
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

	it("starts an interactive task refresh before queued background warmups", async () => {
		let finishFirstFetch: ((result: ReturnType<typeof gitResult>) => void) | undefined;
		let finishInteractiveFetch: ((result: ReturnType<typeof gitResult>) => void) | undefined;
		const startedRepos: string[] = [];
		const scheduler = createTaskBaseRefRefreshScheduler({
			refresh: async (repoPath: string) => {
				startedRepos.push(repoPath);
				if (repoPath === "/tmp/kanban-priority-background-a") {
					return await new Promise<ReturnType<typeof gitResult>>((resolveFetch) => {
						finishFirstFetch = resolveFetch;
					});
				}
				if (repoPath === "/tmp/kanban-priority-interactive") {
					return await new Promise<ReturnType<typeof gitResult>>((resolveFetch) => {
						finishInteractiveFetch = resolveFetch;
					});
				}
				return gitResult();
			},
		});

		const first = scheduler.refresh("/tmp/kanban-priority-background-a", { priority: "background" });
		const second = scheduler.refresh("/tmp/kanban-priority-background-b", { priority: "background" });
		const third = scheduler.refresh("/tmp/kanban-priority-background-c", { priority: "background" });
		const interactive = scheduler.refresh("/tmp/kanban-priority-interactive", { priority: "interactive" });
		await Promise.resolve();
		expect(startedRepos).toEqual(["/tmp/kanban-priority-background-a"]);

		finishFirstFetch?.(gitResult());
		await first;
		await Promise.resolve();
		expect(startedRepos).toEqual(["/tmp/kanban-priority-background-a", "/tmp/kanban-priority-interactive"]);

		finishInteractiveFetch?.(gitResult());
		await interactive;
		await Promise.all([second, third]);
		expect(startedRepos).toEqual([
			"/tmp/kanban-priority-background-a",
			"/tmp/kanban-priority-interactive",
			"/tmp/kanban-priority-background-b",
			"/tmp/kanban-priority-background-c",
		]);
	});

	it("promotes a queued background refresh for the same repository", async () => {
		let finishActiveFetch: ((result: ReturnType<typeof gitResult>) => void) | undefined;
		let finishTaskFetch: ((result: ReturnType<typeof gitResult>) => void) | undefined;
		const startedRepos: string[] = [];
		const scheduler = createTaskBaseRefRefreshScheduler({
			refresh: async (repoPath: string) =>
				await new Promise<ReturnType<typeof gitResult>>((resolveFetch) => {
					startedRepos.push(repoPath);
					if (repoPath === "/tmp/active") {
						finishActiveFetch = resolveFetch;
					} else {
						finishTaskFetch = resolveFetch;
					}
				}),
		});

		const active = scheduler.refresh("/tmp/active", { priority: "background" });
		const queuedBackground = scheduler.refresh("/tmp/task", { priority: "background" });
		const queuedInteractive = scheduler.refresh("/tmp/task", { priority: "interactive" });
		await Promise.resolve();
		expect(startedRepos).toEqual(["/tmp/active"]);

		finishActiveFetch?.(gitResult());
		await active;
		await Promise.resolve();
		expect(startedRepos).toEqual(["/tmp/active", "/tmp/task"]);

		finishTaskFetch?.(gitResult());
		await Promise.all([queuedBackground, queuedInteractive]);
	});

	it("refreshes again after the freshness window expires", async () => {
		let currentTime = 0;
		const refresh = vi.fn(async () => gitResult());
		const scheduler = createTaskBaseRefRefreshScheduler({
			refresh,
			now: () => currentTime,
			freshnessMs: 30_000,
		});

		await scheduler.refresh("/tmp/freshness", { priority: "background" });
		currentTime = 30_001;
		await scheduler.refresh("/tmp/freshness", { priority: "interactive" });

		expect(refresh).toHaveBeenCalledTimes(2);
	});

	it("uses the fetched upstream when the requested local branch has diverged", async () => {
		gitMocks.runGit.mockImplementation(async (_cwd: string, args: string[]) => {
			const command = args.join(" ");
			if (command === "fetch --all --prune") return gitResult();
			if (command === "rev-parse --verify main^{commit}") return gitResult("local-commit");
			if (command === "rev-parse --symbolic-full-name main") return gitResult("refs/heads/main");
			if (command === "for-each-ref --format=%(upstream:short) refs/heads/main") return gitResult("origin/main");
			if (command === "rev-parse --verify origin/main^{commit}") return gitResult("remote-commit");
			throw new Error(`Unexpected git command: ${command}`);
		});

		await expect(resolveLatestTaskBaseCommit("/tmp/kanban-diverged-base-test", "main")).resolves.toBe(
			"remote-commit",
		);
	});
});

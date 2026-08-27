import { resolve } from "node:path";

import { runGit } from "./git-utils";

const TASK_BASE_REF_FRESHNESS_MS = 30_000;

export type TaskBaseRefRefreshPriority = "background" | "interactive";

interface TaskBaseRefRefreshOptions {
	priority?: TaskBaseRefRefreshPriority;
}

type TaskBaseRefRefreshResult = Awaited<ReturnType<typeof runGit>>;

interface TaskBaseRefRefreshWaiter {
	resolve: (result: TaskBaseRefRefreshResult) => void;
	reject: (error: unknown) => void;
}

interface QueuedTaskBaseRefRefresh {
	repoPath: string;
	priority: TaskBaseRefRefreshPriority;
	waiters: TaskBaseRefRefreshWaiter[];
}

interface RecentTaskBaseRefRefresh {
	completedAt: number;
	result: TaskBaseRefRefreshResult;
}

export interface TaskBaseRefRefreshScheduler {
	refresh: (repoPath: string, options?: TaskBaseRefRefreshOptions) => Promise<TaskBaseRefRefreshResult>;
}

interface CreateTaskBaseRefRefreshSchedulerOptions {
	refresh?: (repoPath: string) => Promise<TaskBaseRefRefreshResult>;
	now?: () => number;
	freshnessMs?: number;
}

export function createTaskBaseRefRefreshScheduler(
	options: CreateTaskBaseRefRefreshSchedulerOptions = {},
): TaskBaseRefRefreshScheduler {
	const refresh =
		options.refresh ?? (async (repoPath: string) => await runGit(repoPath, ["fetch", "--all", "--prune"]));
	const now = options.now ?? (() => Date.now());
	const freshnessMs = options.freshnessMs ?? TASK_BASE_REF_FRESHNESS_MS;
	const queuedByRepoPath = new Map<string, QueuedTaskBaseRefRefresh>();
	const interactiveQueue: QueuedTaskBaseRefRefresh[] = [];
	const backgroundQueue: QueuedTaskBaseRefRefresh[] = [];
	const recentByRepoPath = new Map<string, RecentTaskBaseRefRefresh>();
	let activeRefresh: QueuedTaskBaseRefRefresh | null = null;

	const removeFromQueue = (queue: QueuedTaskBaseRefRefresh[], refreshToRemove: QueuedTaskBaseRefRefresh): void => {
		const index = queue.indexOf(refreshToRemove);
		if (index !== -1) {
			queue.splice(index, 1);
		}
	};

	const enqueue = (queuedRefresh: QueuedTaskBaseRefRefresh): void => {
		if (queuedRefresh.priority === "interactive") {
			interactiveQueue.push(queuedRefresh);
			return;
		}
		backgroundQueue.push(queuedRefresh);
	};

	const runNext = (): void => {
		if (activeRefresh) {
			return;
		}
		const nextRefresh = interactiveQueue.shift() ?? backgroundQueue.shift();
		if (!nextRefresh) {
			return;
		}

		activeRefresh = nextRefresh;
		void (async () => {
			try {
				const result = await refresh(nextRefresh.repoPath);
				if (result.ok) {
					recentByRepoPath.set(nextRefresh.repoPath, {
						completedAt: now(),
						result,
					});
				}
				for (const waiter of nextRefresh.waiters) {
					waiter.resolve(result);
				}
			} catch (error) {
				for (const waiter of nextRefresh.waiters) {
					waiter.reject(error);
				}
			} finally {
				queuedByRepoPath.delete(nextRefresh.repoPath);
				activeRefresh = null;
				runNext();
			}
		})();
	};

	return {
		refresh: async (repoPath: string, refreshOptions: TaskBaseRefRefreshOptions = {}) => {
			const cacheKey = resolve(repoPath);
			const priority = refreshOptions.priority ?? "background";
			const recent = recentByRepoPath.get(cacheKey);
			if (recent && now() - recent.completedAt <= freshnessMs) {
				return recent.result;
			}

			const existingRefresh = queuedByRepoPath.get(cacheKey);
			if (existingRefresh) {
				if (priority === "interactive" && existingRefresh.priority === "background") {
					removeFromQueue(backgroundQueue, existingRefresh);
					existingRefresh.priority = "interactive";
					interactiveQueue.push(existingRefresh);
				}
				return await new Promise<TaskBaseRefRefreshResult>((resolveExisting, rejectExisting) => {
					existingRefresh.waiters.push({ resolve: resolveExisting, reject: rejectExisting });
				});
			}

			return await new Promise<TaskBaseRefRefreshResult>((resolveRefresh, rejectRefresh) => {
				const queuedRefresh: QueuedTaskBaseRefRefresh = {
					repoPath: cacheKey,
					priority,
					waiters: [{ resolve: resolveRefresh, reject: rejectRefresh }],
				};
				queuedByRepoPath.set(cacheKey, queuedRefresh);
				enqueue(queuedRefresh);
				runNext();
			});
		},
	};
}

const taskBaseRefRefreshScheduler = createTaskBaseRefRefreshScheduler();

export async function refreshTaskBaseRefs(
	repoPath: string,
	options: TaskBaseRefRefreshOptions = {},
): Promise<TaskBaseRefRefreshResult> {
	return await taskBaseRefRefreshScheduler.refresh(repoPath, options);
}

function isMissingInitialCommitError(message: string): boolean {
	const normalizedMessage = message.trim().toLowerCase();
	if (!normalizedMessage) {
		return false;
	}

	return (
		normalizedMessage.includes("needed a single revision") ||
		normalizedMessage.includes("ambiguous argument") ||
		normalizedMessage.includes("unknown revision or path not in the working tree") ||
		normalizedMessage.includes("bad revision")
	);
}

function getBaseRefResolutionErrorMessage(baseRef: string, errorMessage: string): string {
	if (!isMissingInitialCommitError(errorMessage)) {
		return errorMessage;
	}

	return `This repository does not have an initial commit yet, so Kanban cannot create a task worktree from base ref "${baseRef}". Create an initial commit, then try moving the task to in progress again.`;
}

export async function resolveLatestTaskBaseCommit(repoPath: string, baseRef: string): Promise<string> {
	const fetchResult = await refreshTaskBaseRefs(repoPath, { priority: "interactive" });
	if (!fetchResult.ok) {
		throw new Error(
			`Could not fetch the latest remote refs before creating the task worktree. ${fetchResult.error ?? fetchResult.output}`,
		);
	}

	const localCommitResult = await runGit(repoPath, ["rev-parse", "--verify", `${baseRef}^{commit}`]);
	if (!localCommitResult.ok) {
		throw new Error(getBaseRefResolutionErrorMessage(baseRef, localCommitResult.stderr || localCommitResult.output));
	}

	const symbolicRefResult = await runGit(repoPath, ["rev-parse", "--symbolic-full-name", baseRef]);
	const localBranchRef = symbolicRefResult.ok ? symbolicRefResult.stdout : "";
	if (!localBranchRef.startsWith("refs/heads/")) {
		return localCommitResult.stdout;
	}

	const branchName = localBranchRef.slice("refs/heads/".length);
	const upstreamResult = await runGit(repoPath, ["for-each-ref", "--format=%(upstream:short)", localBranchRef]);
	const upstreamRef = upstreamResult.ok && upstreamResult.stdout ? upstreamResult.stdout : `origin/${branchName}`;
	const upstreamCommitResult = await runGit(repoPath, ["rev-parse", "--verify", `${upstreamRef}^{commit}`]);
	if (!upstreamCommitResult.ok) {
		return localCommitResult.stdout;
	}

	// Task worktrees should start from the fetched shared branch state. Fetching
	// updates the remote-tracking ref without moving the user's local branch, so
	// the local branch may be behind, ahead, or diverged without being the right
	// source for a new task. Callers can still request an untracked ref or commit
	// explicitly when they need a purely local base.
	return upstreamCommitResult.stdout;
}

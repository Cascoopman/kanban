import { resolve } from "node:path";

import { runGit } from "./git-utils";

const activeTaskBaseRefRefreshes = new Map<string, Promise<Awaited<ReturnType<typeof runGit>>>>();
let taskBaseRefRefreshQueue: Promise<void> = Promise.resolve();

function enqueueTaskBaseRefRefresh(repoPath: string): Promise<Awaited<ReturnType<typeof runGit>>> {
	const refresh = taskBaseRefRefreshQueue.then(async () => await runGit(repoPath, ["fetch", "--all", "--prune"]));
	taskBaseRefRefreshQueue = refresh.then(
		() => undefined,
		() => undefined,
	);
	return refresh;
}

export async function refreshTaskBaseRefs(repoPath: string): Promise<Awaited<ReturnType<typeof runGit>>> {
	const cacheKey = resolve(repoPath);
	const existingRefresh = activeTaskBaseRefRefreshes.get(cacheKey);
	if (existingRefresh) {
		return await existingRefresh;
	}

	// Indexed workspaces subscribe together at startup. Serializing their first
	// fetch prevents multiple repositories on the same SSH host from racing to
	// establish the shared ControlMaster connection and showing duplicate key
	// authentication prompts.
	const refresh = enqueueTaskBaseRefRefresh(cacheKey);
	activeTaskBaseRefRefreshes.set(cacheKey, refresh);
	try {
		return await refresh;
	} finally {
		if (activeTaskBaseRefRefreshes.get(cacheKey) === refresh) {
			activeTaskBaseRefRefreshes.delete(cacheKey);
		}
	}
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
	const fetchResult = await refreshTaskBaseRefs(repoPath);
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

	const localIsAncestorResult = await runGit(repoPath, [
		"merge-base",
		"--is-ancestor",
		localCommitResult.stdout,
		upstreamCommitResult.stdout,
	]);
	if (localIsAncestorResult.ok) {
		return upstreamCommitResult.stdout;
	}
	if (localIsAncestorResult.exitCode !== 1) {
		throw new Error(localIsAncestorResult.error ?? "Could not compare the local and remote task base commits.");
	}

	const upstreamIsAncestorResult = await runGit(repoPath, [
		"merge-base",
		"--is-ancestor",
		upstreamCommitResult.stdout,
		localCommitResult.stdout,
	]);
	if (upstreamIsAncestorResult.ok) {
		return localCommitResult.stdout;
	}
	if (upstreamIsAncestorResult.exitCode !== 1) {
		throw new Error(upstreamIsAncestorResult.error ?? "Could not compare the local and remote task base commits.");
	}

	throw new Error(
		`Local branch "${branchName}" and its upstream "${upstreamRef}" have diverged. Choose an explicit base ref before starting the task.`,
	);
}

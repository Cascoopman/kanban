import type { RuntimeTaskSessionSummary, RuntimeWorkspaceStateResponse } from "../core/api-contract";
import { listWorkspaceIndexEntries, loadWorkspaceState, saveWorkspaceState } from "../state/workspace-state";
import { removeTaskWorktreeSetupLock } from "../workspace/task-worktree";
import type { WorkspaceRegistry } from "./workspace-registry";

export interface RuntimeShutdownCoordinatorDependencies {
	workspaceRegistry: Pick<WorkspaceRegistry, "listManagedWorkspaces">;
	warn: (message: string) => void;
	closeRuntimeServer: () => Promise<void>;
	skipSessionCleanup?: boolean;
}

async function persistStoppedSessions(
	workspacePath: string,
	stoppedSessions: RuntimeTaskSessionSummary[],
	options?: {
		workspaceState?: RuntimeWorkspaceStateResponse;
	},
): Promise<void> {
	if (stoppedSessions.length === 0) {
		return;
	}
	const workspaceState = options?.workspaceState ?? (await loadWorkspaceState(workspacePath));
	const nextSessions = {
		...workspaceState.sessions,
	};
	const stoppedAt = Date.now();
	for (const summary of stoppedSessions) {
		nextSessions[summary.taskId] = {
			...summary,
			pid: null,
			updatedAt: stoppedAt,
		};
	}
	await saveWorkspaceState(workspacePath, {
		board: workspaceState.board,
		sessions: nextSessions,
	});
}

async function cleanupTaskWorktreeSetupLocks(
	repoPaths: Iterable<string>,
	warn: (message: string) => void,
): Promise<void> {
	await Promise.all(
		Array.from(new Set(repoPaths)).map(async (repoPath) => {
			try {
				await removeTaskWorktreeSetupLock(repoPath);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				warn(`Could not remove task worktree setup lock for ${repoPath} during shutdown cleanup. ${message}`);
			}
		}),
	);
}

export async function shutdownRuntimeServer(deps: RuntimeShutdownCoordinatorDependencies): Promise<void> {
	if (deps.skipSessionCleanup) {
		await deps.closeRuntimeServer();
		return;
	}

	const stoppedSessionsByWorkspace: Array<{
		workspacePath: string;
		stoppedSessions: RuntimeTaskSessionSummary[];
		workspaceState?: RuntimeWorkspaceStateResponse;
	}> = [];
	const managedWorkspacePaths = new Set<string>();

	for (const { workspacePath, terminalManager } of deps.workspaceRegistry.listManagedWorkspaces()) {
		const stoppedSessions = terminalManager.markInterruptedAndStopAll();
		if (!workspacePath) {
			continue;
		}
		managedWorkspacePaths.add(workspacePath);
		try {
			const workspaceState = await loadWorkspaceState(workspacePath);
			stoppedSessionsByWorkspace.push({
				workspacePath,
				stoppedSessions,
				workspaceState,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			deps.warn(`Could not load workspace state for ${workspacePath} during shutdown cleanup. ${message}`);
		}
	}

	const indexedWorkspaces = await listWorkspaceIndexEntries();

	await Promise.all(
		stoppedSessionsByWorkspace.map(async (workspace) => {
			await persistStoppedSessions(workspace.workspacePath, workspace.stoppedSessions, {
				workspaceState: workspace.workspaceState,
			});
		}),
	);

	await deps.closeRuntimeServer();

	await cleanupTaskWorktreeSetupLocks(
		[...managedWorkspacePaths, ...indexedWorkspaces.map((workspace) => workspace.repoPath)],
		deps.warn,
	);
}

import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { RuntimeBoardData, RuntimeTaskSessionSummary } from "../../src/core/api-contract";
import { shutdownRuntimeServer } from "../../src/server/shutdown-coordinator";
import { loadWorkspaceState, saveWorkspaceState } from "../../src/state/workspace-state";
import type { TerminalSessionManager } from "../../src/terminal/session-manager";
import { createGitTestEnv } from "../utilities/git-env";
import { createTempDir } from "../utilities/temp-dir";

async function withTemporaryHome<T>(run: () => Promise<T>): Promise<T> {
	const { path: tempHome, cleanup } = createTempDir("kanban-home-shutdown-");
	const previousHome = process.env.HOME;
	const previousUserProfile = process.env.USERPROFILE;
	process.env.HOME = tempHome;
	process.env.USERPROFILE = tempHome;
	try {
		return await run();
	} finally {
		if (previousHome === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = previousHome;
		}
		if (previousUserProfile === undefined) {
			delete process.env.USERPROFILE;
		} else {
			process.env.USERPROFILE = previousUserProfile;
		}
		cleanup();
	}
}

function initGitRepository(path: string): void {
	const init = spawnSync("git", ["init"], {
		cwd: path,
		stdio: "ignore",
		env: createGitTestEnv(),
	});
	if (init.status !== 0) {
		throw new Error(`Failed to initialize git repository at ${path}`);
	}
}

function createCard(taskId: string) {
	return {
		id: taskId,
		title: `Task ${taskId}`,
		prompt: `Task ${taskId}`,
		startInPlanMode: false,
		baseRef: "main",
		createdAt: Date.now(),
		updatedAt: Date.now(),
	};
}

function createBoard(taskIds: {
	inProgress?: string[];
	review?: string[];
	onHold?: string[];
	trash?: string[];
}): RuntimeBoardData {
	return {
		columns: [
			{ id: "backlog", title: "Backlog", cards: [] },
			{
				id: "in_progress",
				title: "In Progress",
				cards: (taskIds.inProgress ?? []).map((taskId) => createCard(taskId)),
			},
			{
				id: "review",
				title: "Review",
				cards: (taskIds.review ?? []).map((taskId) => createCard(taskId)),
			},
			{
				id: "on_hold",
				title: "On Hold",
				cards: (taskIds.onHold ?? []).map((taskId) => createCard(taskId)),
			},
			{
				id: "trash",
				title: "Done",
				cards: (taskIds.trash ?? []).map((taskId) => createCard(taskId)),
			},
		],
		dependencies: [],
	};
}

function createSession(taskId: string, state: "running" | "awaiting_review" | "idle"): RuntimeTaskSessionSummary {
	return {
		taskId,
		state,
		agentId: "codex",
		workspacePath: `/tmp/${taskId}`,
		pid: state === "idle" ? null : 1234,
		startedAt: state === "idle" ? null : Date.now() - 1_000,
		updatedAt: Date.now(),
		lastOutputAt: state === "idle" ? null : Date.now(),
		reviewReason: state === "awaiting_review" ? "hook" : null,
		exitCode: null,
		lastHookAt: null,
		latestHookActivity: null,
	};
}

describe.sequential("shutdown coordinator integration", () => {
	it("stops managed sessions without changing task columns or unrelated indexed workspaces", async () => {
		await withTemporaryHome(async () => {
			const { path: sandboxRoot, cleanup } = createTempDir("kanban-shutdown-scope-");
			try {
				const managedProjectPath = join(sandboxRoot, "managed-project");
				const indexedProjectPath = join(sandboxRoot, "indexed-project");
				mkdirSync(managedProjectPath, { recursive: true });
				mkdirSync(indexedProjectPath, { recursive: true });
				initGitRepository(managedProjectPath);
				initGitRepository(indexedProjectPath);

				const managedInitial = await loadWorkspaceState(managedProjectPath);
				await saveWorkspaceState(managedProjectPath, {
					board: createBoard({
						inProgress: ["managed-running", "managed-missing-session"],
						review: ["managed-review"],
						onHold: ["managed-on-hold"],
						trash: ["managed-done"],
					}),
					sessions: {
						"managed-running": createSession("managed-running", "running"),
						"managed-review": createSession("managed-review", "awaiting_review"),
						"managed-on-hold": createSession("managed-on-hold", "awaiting_review"),
						"managed-done": createSession("managed-done", "idle"),
					},
					expectedRevision: managedInitial.revision,
				});

				const indexedInitial = await loadWorkspaceState(indexedProjectPath);
				await saveWorkspaceState(indexedProjectPath, {
					board: createBoard({
						inProgress: ["indexed-missing-session"],
						review: ["indexed-awaiting-review"],
					}),
					sessions: {
						"indexed-awaiting-review": createSession("indexed-awaiting-review", "awaiting_review"),
					},
					expectedRevision: indexedInitial.revision,
				});

				let didCloseRuntimeServer = false;
				const managedTerminalManager = {
					markInterruptedAndStopAll: () => [
						createSession("managed-running", "running"),
						createSession("managed-review", "awaiting_review"),
						createSession("managed-on-hold", "awaiting_review"),
					],
				} as unknown as TerminalSessionManager;
				await shutdownRuntimeServer({
					workspaceRegistry: {
						listManagedWorkspaces: () => [
							{
								workspaceId: "managed-project",
								workspacePath: managedProjectPath,
								terminalManager: managedTerminalManager,
							},
						],
					},
					warn: () => {},
					closeRuntimeServer: async () => {
						didCloseRuntimeServer = true;
					},
				});

				expect(didCloseRuntimeServer).toBe(true);

				const managedAfter = await loadWorkspaceState(managedProjectPath);
				const managedInProgress =
					managedAfter.board.columns.find((column) => column.id === "in_progress")?.cards ?? [];
				const managedReview = managedAfter.board.columns.find((column) => column.id === "review")?.cards ?? [];
				const managedOnHold = managedAfter.board.columns.find((column) => column.id === "on_hold")?.cards ?? [];
				const managedTrash = managedAfter.board.columns.find((column) => column.id === "trash")?.cards ?? [];
				expect(managedInProgress.map((card) => card.id).sort()).toEqual(
					["managed-missing-session", "managed-running"].sort(),
				);
				expect(managedReview.map((card) => card.id)).toEqual(["managed-review"]);
				expect(managedOnHold.map((card) => card.id)).toEqual(["managed-on-hold"]);
				expect(managedTrash.map((card) => card.id)).toEqual(["managed-done"]);
				expect(managedAfter.sessions["managed-running"]?.state).toBe("running");
				expect(managedAfter.sessions["managed-running"]?.pid).toBeNull();
				expect(managedAfter.sessions["managed-review"]?.state).toBe("awaiting_review");
				expect(managedAfter.sessions["managed-review"]?.reviewReason).toBe("hook");
				expect(managedAfter.sessions["managed-review"]?.pid).toBeNull();
				expect(managedAfter.sessions["managed-on-hold"]?.state).toBe("awaiting_review");
				expect(managedAfter.sessions["managed-on-hold"]?.reviewReason).toBe("hook");
				expect(managedAfter.sessions["managed-on-hold"]?.pid).toBeNull();
				expect(managedAfter.sessions["managed-done"]?.state).toBe("idle");
				expect(managedAfter.sessions["managed-missing-session"]).toBeUndefined();

				const indexedAfter = await loadWorkspaceState(indexedProjectPath);
				const indexedInProgress =
					indexedAfter.board.columns.find((column) => column.id === "in_progress")?.cards ?? [];
				const indexedReview = indexedAfter.board.columns.find((column) => column.id === "review")?.cards ?? [];
				const indexedTrash = indexedAfter.board.columns.find((column) => column.id === "trash")?.cards ?? [];
				expect(indexedInProgress.map((card) => card.id)).toEqual(["indexed-missing-session"]);
				expect(indexedReview.map((card) => card.id)).toEqual(["indexed-awaiting-review"]);
				expect(indexedTrash).toEqual([]);
				expect(indexedAfter.sessions["indexed-awaiting-review"]?.state).toBe("awaiting_review");
				expect(indexedAfter.sessions["indexed-missing-session"]).toBeUndefined();
			} finally {
				cleanup();
			}
		});
	}, 30_000);
});

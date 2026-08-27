import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import type { Command } from "commander";

import type {
	RuntimeAgentId,
	RuntimeBoardCard,
	RuntimeBoardColumnId,
	RuntimeWorkspaceStateResponse,
} from "../core/api-contract";
import { runtimeAgentIdSchema } from "../core/api-contract";
import { buildKanbanRuntimeUrl, getKanbanRuntimeOrigin, getRuntimeFetch } from "../core/runtime-endpoint";
import {
	addTaskToColumn,
	deleteTasksFromBoard,
	getTaskColumnId,
	trashTask as moveTaskToTrash,
	updateTask,
} from "../core/task-board-mutations";
import { resolveProjectInputPath } from "../projects/project-path";
import { loadWorkspaceContext, mutateWorkspaceState, resolveWorkspaceContextById } from "../state/workspace-state";
import { readTaskSessionContextFromEnv } from "../terminal/hook-runtime-context";
import type { RuntimeAppRouter } from "../trpc/app-router";

const LIST_TASK_COLUMNS = ["in_progress", "review", "on_hold", "trash"] as const;
type ListTaskColumn = (typeof LIST_TASK_COLUMNS)[number];
type TaskCommandTarget = { taskId?: string; column?: ListTaskColumn };

type ResolvedTaskCommandTarget =
	| {
			kind: "task";
			taskId: string;
	  }
	| {
			kind: "column";
			column: ListTaskColumn;
	  };

interface RuntimeWorkspaceMutationResult<T> {
	board: RuntimeWorkspaceStateResponse["board"];
	value: T;
}

type JsonRecord = Record<string, unknown>;

function toErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message.trim().length > 0) {
		return error.message;
	}
	return String(error);
}

function printJson(payload: unknown): void {
	process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function parseListColumn(value: string | undefined): ListTaskColumn | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (value === "done") {
		return "trash";
	}
	if (value === "in_progress" || value === "review" || value === "on_hold" || value === "trash") {
		return value;
	}
	throw new Error(`Invalid column "${value}". Expected one of: ${LIST_TASK_COLUMNS.join(", ")}, done.`);
}

const VALID_AGENT_IDS = runtimeAgentIdSchema.options;

function parseAgentId(value: string | undefined): RuntimeAgentId | null | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (value === "default") {
		return null;
	}
	const result = runtimeAgentIdSchema.safeParse(value);
	if (result.success) {
		return result.data;
	}
	throw new Error(`Invalid agent ID "${value}". Expected one of: ${VALID_AGENT_IDS.join(", ")}, default.`);
}

function resolveTaskCommandTarget(input: TaskCommandTarget, commandName: string): ResolvedTaskCommandTarget {
	const taskId = input.taskId?.trim();
	const column = input.column;
	if (taskId && column) {
		throw new Error(`${commandName} accepts exactly one of --task-id or --column.`);
	}
	if (taskId) {
		return {
			kind: "task",
			taskId,
		};
	}
	if (column) {
		return {
			kind: "column",
			column,
		};
	}
	throw new Error(`${commandName} requires either --task-id or --column.`);
}

function createRuntimeTrpcClient(workspaceId: string | null) {
	return createTRPCProxyClient<RuntimeAppRouter>({
		links: [
			httpBatchLink({
				url: buildKanbanRuntimeUrl("/api/trpc"),
				headers: () => (workspaceId ? { "x-kanban-workspace-id": workspaceId } : {}),
				fetch: async (url, options) => {
					const runtimeFetch = await getRuntimeFetch();
					return runtimeFetch(url, options);
				},
			}),
		],
	});
}

async function resolveRuntimeWorkspace(
	projectPath: string | undefined,
	cwd: string,
	options: { autoCreateIfMissing?: boolean } = {},
) {
	const normalizedProjectPath = (projectPath ?? "").trim();
	if (!normalizedProjectPath) {
		const { workspaceId } = readTaskSessionContextFromEnv();
		if (workspaceId) {
			const workspace = await resolveWorkspaceContextById(workspaceId);
			if (workspace.kind === "unknown") {
				throw new Error(`Kanban task session workspace "${workspaceId}" is no longer registered.`);
			}
			if (workspace.kind === "unavailable") {
				throw new Error(workspace.message);
			}
			return workspace.context;
		}
	}
	const resolvedPath = normalizedProjectPath ? resolveProjectInputPath(normalizedProjectPath, cwd) : cwd;
	return await loadWorkspaceContext(resolvedPath, {
		autoCreateIfMissing: options.autoCreateIfMissing ?? true,
	});
}

function resolveCurrentTaskId(explicitTaskId: string | undefined, commandName: string): string {
	const taskId = explicitTaskId?.trim() || readTaskSessionContextFromEnv().taskId;
	if (!taskId) {
		throw new Error(`${commandName} requires --task-id outside a Kanban task session.`);
	}
	return taskId;
}

async function resolveWorkspaceRepoPath(
	projectPath: string | undefined,
	cwd: string,
	options: { autoCreateIfMissing?: boolean } = {},
): Promise<string> {
	const workspace = await resolveRuntimeWorkspace(projectPath, cwd, options);
	return workspace.repoPath;
}

async function ensureRuntimeWorkspace(workspaceRepoPath: string): Promise<string> {
	const runtimeClient = createRuntimeTrpcClient(null);
	const added = await runtimeClient.projects.add.mutate({
		path: workspaceRepoPath,
	});
	if (!added.ok || !added.project) {
		throw new Error(added.error ?? `Could not register project ${workspaceRepoPath} in Kanban runtime.`);
	}
	return added.project.id;
}

async function notifyRuntimeWorkspaceStateUpdated(
	runtimeClient: ReturnType<typeof createRuntimeTrpcClient>,
): Promise<void> {
	await runtimeClient.workspace.notifyStateUpdated.mutate().catch(() => null);
}

async function updateRuntimeWorkspaceState<T>(
	runtimeClient: ReturnType<typeof createRuntimeTrpcClient>,
	workspaceRepoPath: string,
	mutate: (state: RuntimeWorkspaceStateResponse) => RuntimeWorkspaceMutationResult<T>,
): Promise<T> {
	const mutationResponse = await mutateWorkspaceState(workspaceRepoPath, (state) => {
		const mutation = mutate(state);
		return {
			board: mutation.board,
			value: mutation.value,
		};
	});

	if (mutationResponse.saved) {
		await notifyRuntimeWorkspaceStateUpdated(runtimeClient);
	}

	return mutationResponse.value;
}

function resolveTaskBaseRef(state: RuntimeWorkspaceStateResponse): string {
	return state.git.currentBranch ?? state.git.defaultBranch ?? state.git.branches[0] ?? "";
}

function findTaskRecord(
	state: RuntimeWorkspaceStateResponse,
	taskId: string,
): { task: RuntimeBoardCard; columnId: RuntimeBoardColumnId } | null {
	for (const column of state.board.columns) {
		const task = column.cards.find((candidate) => candidate.id === taskId);
		if (task) {
			return {
				task,
				columnId: column.id,
			};
		}
	}
	return null;
}

function formatTaskRecord(
	state: RuntimeWorkspaceStateResponse,
	task: RuntimeBoardCard,
	columnId: RuntimeBoardColumnId,
): JsonRecord {
	const session = state.sessions[task.id] ?? null;
	return {
		id: task.id,
		title: task.title,
		column: columnId,
		baseRef: task.baseRef,
		startInPlanMode: task.startInPlanMode,
		...(task.agentId ? { agentId: task.agentId } : {}),
		...(task.branchedFromTaskId ? { branchedFromTaskId: task.branchedFromTaskId } : {}),
		createdAt: task.createdAt,
		updatedAt: task.updatedAt,
		session: session
			? {
					state: session.state,
					agentId: session.agentId,
					pid: session.pid,
					startedAt: session.startedAt,
					updatedAt: session.updatedAt,
					lastOutputAt: session.lastOutputAt,
					reviewReason: session.reviewReason,
					exitCode: session.exitCode,
				}
			: null,
	};
}

async function getCurrentTask(input: { cwd: string; projectPath?: string }): Promise<JsonRecord> {
	const taskId = resolveCurrentTaskId(undefined, "task current");
	const workspace = await resolveRuntimeWorkspace(input.projectPath, input.cwd, {
		autoCreateIfMissing: false,
	});
	const runtimeClient = createRuntimeTrpcClient(workspace.workspaceId);
	const state = await runtimeClient.workspace.getState.query();
	const taskRecord = findTaskRecord(state, taskId);
	if (!taskRecord) {
		throw new Error(`Current task "${taskId}" was not found in workspace ${workspace.repoPath}.`);
	}

	return {
		ok: true,
		workspacePath: workspace.repoPath,
		task: formatTaskRecord(state, taskRecord.task, taskRecord.columnId),
	};
}

function findTasksInColumn(
	state: RuntimeWorkspaceStateResponse,
	columnId: ListTaskColumn,
): Array<{ task: RuntimeBoardCard; columnId: RuntimeBoardColumnId }> {
	const column = state.board.columns.find((candidate) => candidate.id === columnId);
	if (!column) {
		return [];
	}
	return column.cards.map((task) => ({
		task,
		columnId: column.id,
	}));
}

async function listTasks(input: { cwd: string; projectPath?: string; column?: ListTaskColumn }): Promise<JsonRecord> {
	const workspace = await resolveRuntimeWorkspace(input.projectPath, input.cwd, {
		autoCreateIfMissing: false,
	});
	const runtimeClient = createRuntimeTrpcClient(workspace.workspaceId);
	const state = await runtimeClient.workspace.getState.query();

	const tasks = state.board.columns.flatMap((boardColumn) => {
		if (!input.column && boardColumn.id === "trash") {
			return [];
		}
		if (input.column && boardColumn.id !== input.column) {
			return [];
		}
		return boardColumn.cards.map((task) => formatTaskRecord(state, task, boardColumn.id));
	});

	return {
		ok: true,
		workspacePath: workspace.repoPath,
		column: input.column ?? null,
		tasks,
		count: tasks.length,
	};
}

async function stopTaskRuntimeSession(
	runtimeClient: ReturnType<typeof createRuntimeTrpcClient>,
	taskId: string,
): Promise<void> {
	await runtimeClient.runtime.stopTaskSession
		.mutate({
			taskId,
		})
		.catch(() => null);
}

async function deleteTaskWorkspace(
	runtimeClient: ReturnType<typeof createRuntimeTrpcClient>,
	taskId: string,
): Promise<{ removed: boolean; error?: string }> {
	try {
		const deleted = await runtimeClient.workspace.deleteWorktree.mutate({
			taskId,
		});
		return {
			removed: deleted.removed,
			error: deleted.ok ? undefined : deleted.error,
		};
	} catch (error) {
		return {
			removed: false,
			error: toErrorMessage(error),
		};
	}
}

async function createTask(input: {
	cwd: string;
	title: string;
	projectPath?: string;
	baseRef?: string;
	startInPlanMode?: boolean;
	agentId?: RuntimeAgentId;
}): Promise<JsonRecord> {
	const workspaceRepoPath = await resolveWorkspaceRepoPath(input.projectPath, input.cwd);
	const workspaceId = await ensureRuntimeWorkspace(workspaceRepoPath);
	const runtimeClient = createRuntimeTrpcClient(workspaceId);
	const created = await updateRuntimeWorkspaceState(runtimeClient, workspaceRepoPath, (state) => {
		const resolvedBaseRef = (input.baseRef ?? "").trim() || resolveTaskBaseRef(state);
		if (!resolvedBaseRef) {
			throw new Error("Could not determine task base branch for this workspace.");
		}
		const result = addTaskToColumn(
			state.board,
			"in_progress",
			{
				title: input.title,
				startInPlanMode: input.startInPlanMode,
				agentId: input.agentId,
				baseRef: resolvedBaseRef,
			},
			() => globalThis.crypto.randomUUID(),
		);
		return {
			board: result.board,
			value: result.task,
		};
	});
	await startTask({ cwd: input.cwd, taskId: created.id, projectPath: input.projectPath });

	return {
		ok: true,
		task: {
			id: created.id,
			column: "in_progress",
			workspacePath: workspaceRepoPath,
			title: created.title,
			baseRef: created.baseRef,
			startInPlanMode: created.startInPlanMode,
			...(created.agentId ? { agentId: created.agentId } : {}),
		},
	};
}

async function branchTaskCommand(input: {
	cwd: string;
	taskId: string;
	title: string;
	prompt?: string;
	projectPath?: string;
}): Promise<JsonRecord> {
	const workspaceRepoPath = await resolveWorkspaceRepoPath(input.projectPath, input.cwd);
	const workspaceId = await ensureRuntimeWorkspace(workspaceRepoPath);
	const runtimeClient = createRuntimeTrpcClient(workspaceId);
	const runtimeState = await runtimeClient.workspace.getState.query();
	const sourceRecord = findTaskRecord(runtimeState, input.taskId);
	if (!sourceRecord) {
		throw new Error(`Task "${input.taskId}" was not found in workspace ${workspaceRepoPath}.`);
	}

	const targetTaskId = globalThis.crypto.randomUUID();
	const branchedWorkspace = await runtimeClient.workspace.branchTaskWorkspace.mutate({
		sourceTaskId: sourceRecord.task.id,
		targetTaskId,
		baseRef: sourceRecord.task.baseRef,
	});
	if (!branchedWorkspace.ok) {
		throw new Error(branchedWorkspace.error ?? "Could not branch the task workspace.");
	}

	let created: RuntimeBoardCard;
	try {
		created = await updateRuntimeWorkspaceState(runtimeClient, workspaceRepoPath, (latestState) => {
			const latestSource = findTaskRecord(latestState, input.taskId);
			if (!latestSource) {
				throw new Error(`Task "${input.taskId}" was deleted before the branch could be created.`);
			}
			const result = addTaskToColumn(
				latestState.board,
				"in_progress",
				{
					taskId: targetTaskId,
					title: input.title,
					startInPlanMode: latestSource.task.startInPlanMode,
					agentId: latestSource.task.agentId,
					branchedFromTaskId: latestSource.task.id,
					baseRef: latestSource.task.baseRef,
				},
				() => targetTaskId,
			);
			return {
				board: result.board,
				value: result.task,
			};
		});
	} catch (error) {
		await deleteTaskWorkspace(runtimeClient, targetTaskId);
		throw error;
	}

	await startTask({
		cwd: input.cwd,
		taskId: created.id,
		projectPath: input.projectPath,
		prompt: input.prompt,
	});

	return {
		ok: true,
		sourceTaskId: sourceRecord.task.id,
		warning: branchedWorkspace.warning,
		task: {
			id: created.id,
			column: "in_progress",
			workspacePath: branchedWorkspace.path,
			title: created.title,
			baseRef: created.baseRef,
			startInPlanMode: created.startInPlanMode,
			...(created.agentId ? { agentId: created.agentId } : {}),
			branchedFromTaskId: sourceRecord.task.id,
		},
	};
}

async function updateTaskCommand(input: {
	cwd: string;
	taskId: string;
	title?: string;
	projectPath?: string;
	baseRef?: string;
	startInPlanMode?: boolean;
	agentId?: RuntimeAgentId | null;
}): Promise<JsonRecord> {
	if (
		input.title === undefined &&
		input.baseRef === undefined &&
		input.startInPlanMode === undefined &&
		input.agentId === undefined
	) {
		throw new Error("task update requires at least one field to change.");
	}

	const workspaceRepoPath = await resolveWorkspaceRepoPath(input.projectPath, input.cwd);
	const workspaceId = await ensureRuntimeWorkspace(workspaceRepoPath);
	const runtimeClient = createRuntimeTrpcClient(workspaceId);
	const updated = await updateRuntimeWorkspaceState(runtimeClient, workspaceRepoPath, (runtimeState) => {
		const taskRecord = findTaskRecord(runtimeState, input.taskId);
		if (!taskRecord) {
			throw new Error(`Task "${input.taskId}" was not found in workspace ${workspaceRepoPath}.`);
		}
		const updatedTask = updateTask(runtimeState.board, input.taskId, {
			title: input.title ?? taskRecord.task.title,
			baseRef: input.baseRef ?? taskRecord.task.baseRef,
			startInPlanMode: input.startInPlanMode ?? taskRecord.task.startInPlanMode,
			agentId: input.agentId,
		});
		if (!updatedTask.updated || !updatedTask.task) {
			throw new Error(`Task "${input.taskId}" could not be updated.`);
		}

		const nextState: RuntimeWorkspaceStateResponse = {
			...runtimeState,
			board: updatedTask.board,
		};

		return {
			board: updatedTask.board,
			value: formatTaskRecord(nextState, updatedTask.task, taskRecord.columnId),
		};
	});

	return {
		ok: true,
		task: updated,
		workspacePath: workspaceRepoPath,
	};
}

async function startTask(input: {
	cwd: string;
	taskId: string;
	projectPath?: string;
	prompt?: string;
}): Promise<JsonRecord> {
	const workspaceRepoPath = await resolveWorkspaceRepoPath(input.projectPath, input.cwd);
	const workspaceId = await ensureRuntimeWorkspace(workspaceRepoPath);
	const runtimeClient = createRuntimeTrpcClient(workspaceId);
	const runtimeState = await runtimeClient.workspace.getState.query();
	const fromColumnId = getTaskColumnId(runtimeState.board, input.taskId);
	if (!fromColumnId) {
		throw new Error(`Task "${input.taskId}" was not found in workspace ${workspaceRepoPath}.`);
	}

	if (fromColumnId !== "in_progress") {
		throw new Error(`Task "${input.taskId}" is in "${fromColumnId}" and can only be started from in_progress.`);
	}

	const currentRecord = findTaskRecord(runtimeState, input.taskId);
	const task = currentRecord?.task;
	if (!task) {
		throw new Error(`Task "${input.taskId}" could not be resolved.`);
	}

	const existingSession = runtimeState.sessions[task.id] ?? null;
	const shouldStartSession = !existingSession || existingSession.state !== "running";

	if (shouldStartSession) {
		const ensured = await runtimeClient.workspace.ensureWorktree.mutate({
			taskId: task.id,
			baseRef: task.baseRef,
		});
		if (!ensured.ok) {
			throw new Error(ensured.error ?? "Could not ensure task worktree.");
		}

		const started = await runtimeClient.runtime.startTaskSession.mutate({
			taskId: task.id,
			prompt: input.prompt ?? "",
			startInPlanMode: task.startInPlanMode,
			baseRef: task.baseRef,
			agentId: task.agentId,
			branchedFromTaskId: task.branchedFromTaskId,
		});
		if (!started.ok || !started.summary) {
			throw new Error(started.error ?? "Could not start task session.");
		}
	}

	return {
		ok: true,
		task: {
			id: task.id,
			title: task.title,
			column: "in_progress",
			workspacePath: workspaceRepoPath,
		},
	};
}

interface TrashTaskExecutionResult {
	task: JsonRecord;
	taskId: string;
	previousColumnId: ListTaskColumn;
	worktreeDeleted: boolean;
	worktreeDeleteError?: string;
	alreadyInTrash: boolean;
}

interface TrashTaskMutationValue {
	task: JsonRecord;
	previousColumnId: ListTaskColumn;
	alreadyInTrash: boolean;
}

function columnCanHaveLiveTaskSession(columnId: ListTaskColumn): boolean {
	return columnId === "in_progress" || columnId === "review" || columnId === "on_hold";
}

async function trashTaskById(input: {
	cwd: string;
	taskId: string;
	projectPath?: string;
	workspaceRepoPath: string;
	runtimeClient: ReturnType<typeof createRuntimeTrpcClient>;
}): Promise<TrashTaskExecutionResult> {
	const mutation = await mutateWorkspaceState<TrashTaskMutationValue>(input.workspaceRepoPath, (latestState) => {
		const latestRecord = findTaskRecord(latestState, input.taskId);
		if (!latestRecord) {
			throw new Error(`Task "${input.taskId}" was not found in workspace ${input.workspaceRepoPath}.`);
		}
		if (latestRecord.columnId === "trash") {
			return {
				board: latestState.board,
				value: {
					task: formatTaskRecord(latestState, latestRecord.task, latestRecord.columnId),
					previousColumnId: latestRecord.columnId,
					alreadyInTrash: true,
				},
				save: false,
			};
		}

		const trashed = moveTaskToTrash(latestState.board, input.taskId);
		if (!trashed.moved || !trashed.task) {
			throw new Error(`Task "${input.taskId}" could not be moved to done.`);
		}

		const nextState: RuntimeWorkspaceStateResponse = {
			...latestState,
			board: trashed.board,
		};
		return {
			board: trashed.board,
			value: {
				task: formatTaskRecord(nextState, trashed.task, "trash"),
				previousColumnId: latestRecord.columnId,
				alreadyInTrash: false,
			},
		};
	});

	if (mutation.saved) {
		await notifyRuntimeWorkspaceStateUpdated(input.runtimeClient);
	}

	if (mutation.value.alreadyInTrash) {
		return {
			task: mutation.value.task,
			taskId: input.taskId,
			previousColumnId: mutation.value.previousColumnId,
			worktreeDeleted: false,
			alreadyInTrash: true,
		};
	}

	if (columnCanHaveLiveTaskSession(mutation.value.previousColumnId)) {
		await stopTaskRuntimeSession(input.runtimeClient, input.taskId);
	}

	const deletedWorkspace = await deleteTaskWorkspace(input.runtimeClient, input.taskId);

	return {
		task: mutation.value.task,
		taskId: input.taskId,
		previousColumnId: mutation.value.previousColumnId,
		worktreeDeleted: deletedWorkspace.removed,
		worktreeDeleteError: deletedWorkspace.error,
		alreadyInTrash: false,
	};
}

async function trashTask(input: {
	cwd: string;
	taskId?: string;
	column?: ListTaskColumn;
	projectPath?: string;
}): Promise<JsonRecord> {
	const target = resolveTaskCommandTarget(input, "task done");
	const workspaceRepoPath = await resolveWorkspaceRepoPath(input.projectPath, input.cwd);
	const workspaceId = await ensureRuntimeWorkspace(workspaceRepoPath);
	const runtimeClient = createRuntimeTrpcClient(workspaceId);

	if (target.kind === "task") {
		const trashed = await trashTaskById({
			cwd: input.cwd,
			taskId: target.taskId,
			projectPath: input.projectPath,
			workspaceRepoPath,
			runtimeClient,
		});
		if (trashed.alreadyInTrash) {
			return {
				ok: true,
				message: `Task "${target.taskId}" is already done.`,
				task: trashed.task,
				workspacePath: workspaceRepoPath,
			};
		}
		return {
			ok: true,
			task: trashed.task,
			workspacePath: workspaceRepoPath,
			worktreeDeleted: trashed.worktreeDeleted,
			worktreeDeleteError: trashed.worktreeDeleteError,
		};
	}

	const initialState = await runtimeClient.workspace.getState.query();
	const targetTasks = findTasksInColumn(initialState, target.column);
	if (targetTasks.length === 0) {
		return {
			ok: true,
			column: target.column,
			workspacePath: workspaceRepoPath,
			trashedTasks: [],
			alreadyTrashedTasks: [],
			worktreeCleanup: [],
			count: 0,
		};
	}

	const results: TrashTaskExecutionResult[] = [];
	for (const { task } of targetTasks) {
		results.push(
			await trashTaskById({
				cwd: input.cwd,
				taskId: task.id,
				projectPath: input.projectPath,
				workspaceRepoPath,
				runtimeClient,
			}),
		);
	}

	const trashedTasks = results.filter((result) => !result.alreadyInTrash);
	const alreadyTrashedTasks = results.filter((result) => result.alreadyInTrash);

	return {
		ok: true,
		column: target.column,
		workspacePath: workspaceRepoPath,
		trashedTasks: trashedTasks.map((result) => result.task),
		alreadyTrashedTasks: alreadyTrashedTasks.map((result) => result.task),
		worktreeCleanup: trashedTasks.map((result) => ({
			taskId: result.taskId,
			removed: result.worktreeDeleted,
			error: result.worktreeDeleteError,
		})),
		count: trashedTasks.length,
	};
}

async function deleteTaskCommand(input: {
	cwd: string;
	taskId?: string;
	column?: ListTaskColumn;
	projectPath?: string;
}): Promise<JsonRecord> {
	const target = resolveTaskCommandTarget(input, "task delete");
	const workspaceRepoPath = await resolveWorkspaceRepoPath(input.projectPath, input.cwd);
	const workspaceId = await ensureRuntimeWorkspace(workspaceRepoPath);
	const runtimeClient = createRuntimeTrpcClient(workspaceId);
	const mutation = await mutateWorkspaceState(workspaceRepoPath, (latestState) => {
		const latestTargetRecords =
			target.kind === "task"
				? (() => {
						const record = findTaskRecord(latestState, target.taskId);
						if (!record) {
							throw new Error(`Task "${target.taskId}" was not found in workspace ${workspaceRepoPath}.`);
						}
						return [record];
					})()
				: findTasksInColumn(latestState, target.column);

		if (latestTargetRecords.length === 0) {
			return {
				board: latestState.board,
				value: {
					deletedTaskIds: [] as string[],
					taskIdsRequiringStop: [] as string[],
					deletedTasks: [] as JsonRecord[],
				},
				save: false,
			};
		}

		const deleted = deleteTasksFromBoard(
			latestState.board,
			latestTargetRecords.map(({ task }) => task.id),
		);
		if (!deleted.deleted) {
			return {
				board: latestState.board,
				value: {
					deletedTaskIds: [] as string[],
					taskIdsRequiringStop: [] as string[],
					deletedTasks: [] as JsonRecord[],
				},
				save: false,
			};
		}

		const deletedTasks = latestTargetRecords.map(({ task, columnId }) =>
			formatTaskRecord(latestState, task, columnId),
		);
		const taskIdsRequiringStop = latestTargetRecords
			.filter(({ columnId }) => columnCanHaveLiveTaskSession(columnId))
			.map(({ task }) => task.id);
		return {
			board: deleted.board,
			value: {
				deletedTaskIds: deleted.deletedTaskIds,
				taskIdsRequiringStop,
				deletedTasks,
			},
		};
	});

	if (mutation.saved) {
		await notifyRuntimeWorkspaceStateUpdated(runtimeClient);
	}

	if (mutation.value.deletedTaskIds.length === 0) {
		return {
			ok: true,
			workspacePath: workspaceRepoPath,
			column: target.kind === "column" ? target.column : null,
			deletedTasks: [],
			count: 0,
		};
	}

	await Promise.all(
		mutation.value.taskIdsRequiringStop.map(async (taskId) => await stopTaskRuntimeSession(runtimeClient, taskId)),
	);

	const workspaceCleanupResults = await Promise.all(
		mutation.value.deletedTaskIds.map(async (taskId) => ({
			taskId,
			...(await deleteTaskWorkspace(runtimeClient, taskId)),
		})),
	);

	return {
		ok: true,
		workspacePath: workspaceRepoPath,
		column: target.kind === "column" ? target.column : null,
		deletedTasks: mutation.value.deletedTasks,
		count: mutation.value.deletedTaskIds.length,
		worktreeCleanup: workspaceCleanupResults,
	};
}

function parseOptionalBooleanOption(value: unknown, flagName: string): boolean | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (value === true || value === false) {
		return value;
	}
	if (typeof value !== "string") {
		throw new Error(`Invalid boolean value for ${flagName}. Use true or false.`);
	}
	const normalized = value.trim().toLowerCase();
	if (normalized === "true" || normalized === "1" || normalized === "yes") {
		return true;
	}
	if (normalized === "false" || normalized === "0" || normalized === "no") {
		return false;
	}
	throw new Error(`Invalid boolean value for ${flagName}: "${value}". Use true or false.`);
}

async function runTaskCommand(
	handler: () => Promise<JsonRecord>,
	options: { includeRuntimeOrigin?: boolean } = {},
): Promise<void> {
	try {
		printJson(await handler());
	} catch (error) {
		const runtimeContext = options.includeRuntimeOrigin === false ? "" : ` at ${getKanbanRuntimeOrigin()}`;
		printJson({
			ok: false,
			error: `Task command failed${runtimeContext}: ${toErrorMessage(error)}`,
		});
		process.exitCode = 1;
	}
}

export function registerTaskCommand(program: Command): void {
	const task = program.command("task").alias("tasks").description("Manage Kanban board tasks from the CLI.");

	task
		.command("list")
		.description("List Kanban tasks for a workspace.")
		.option("--project-path <path>", "Workspace path. Defaults to current directory workspace.")
		.option(
			"--column <column>",
			"Filter column: in_progress | review | on_hold | done. trash is also accepted.",
			parseListColumn,
		)
		.action(async (options: { projectPath?: string; column?: ListTaskColumn }) => {
			await runTaskCommand(
				async () =>
					await listTasks({
						cwd: process.cwd(),
						projectPath: options.projectPath,
						column: options.column,
					}),
			);
		});

	task
		.command("current")
		.alias("whoami")
		.description("Show the task associated with the current agent session.")
		.option("--project-path <path>", "Workspace path. Defaults to the current task workspace.")
		.action(async (options: { projectPath?: string }) => {
			await runTaskCommand(
				async () =>
					await getCurrentTask({
						cwd: process.cwd(),
						projectPath: options.projectPath,
					}),
			);
		});

	task
		.command("create")
		.description("Create a task and start its agent session.")
		.requiredOption("--title <text>", "Task title.")
		.option("--project-path <path>", "Workspace path. Defaults to current directory workspace.")
		.option("--base-ref <branch>", "Task base branch/ref.")
		.option("--start-in-plan-mode [value]", "Set plan mode (true|false). Flag-only implies true.")
		.option("--agent-id <id>", "Agent override: claude | codex | default.")
		.action(
			async (options: {
				title: string;
				projectPath?: string;
				baseRef?: string;
				startInPlanMode?: unknown;
				agentId?: string;
			}) => {
				await runTaskCommand(
					async () =>
						await createTask({
							cwd: process.cwd(),
							title: options.title,
							projectPath: options.projectPath,
							baseRef: options.baseRef,
							startInPlanMode: parseOptionalBooleanOption(options.startInPlanMode, "--start-in-plan-mode"),
							agentId: parseAgentId(options.agentId) ?? undefined,
						}),
				);
			},
		);

	task
		.command("branch")
		.alias("fork")
		.description("Branch a task's worktree and agent conversation into a new running task.")
		.requiredOption("--title <text>", "New task title.")
		.option("--task-id <id>", "Source task ID. Defaults to the current agent task.")
		.option("--prompt <text>", "Optional first prompt for the forked agent session.")
		.option("--project-path <path>", "Workspace path. Defaults to the current task workspace.")
		.action(async (options: { title: string; taskId?: string; prompt?: string; projectPath?: string }) => {
			await runTaskCommand(
				async () =>
					await branchTaskCommand({
						cwd: process.cwd(),
						taskId: resolveCurrentTaskId(options.taskId, "task branch"),
						title: options.title,
						prompt: options.prompt,
						projectPath: options.projectPath,
					}),
			);
		});

	task
		.command("update")
		.description("Update an existing task.")
		.option("--task-id <id>", "Task ID. Defaults to the current agent task.")
		.option("--title <text>", "Replacement task title.")
		.option("--project-path <path>", "Workspace path. Defaults to current directory workspace.")
		.option("--base-ref <branch>", "Replacement base branch/ref.")
		.option("--start-in-plan-mode [value]", "Set plan mode (true|false). Flag-only implies true.")
		.option("--agent-id <id>", 'Agent override: claude | codex. Use "default" to clear.')
		.action(
			async (options: {
				taskId?: string;
				title?: string;
				projectPath?: string;
				baseRef?: string;
				startInPlanMode?: unknown;
				agentId?: string;
			}) => {
				await runTaskCommand(
					async () =>
						await updateTaskCommand({
							cwd: process.cwd(),
							taskId: resolveCurrentTaskId(options.taskId, "task update"),
							title: options.title,
							projectPath: options.projectPath,
							baseRef: options.baseRef,
							startInPlanMode: parseOptionalBooleanOption(options.startInPlanMode, "--start-in-plan-mode"),
							agentId: parseAgentId(options.agentId),
						}),
				);
			},
		);

	task
		.command("trash")
		.alias("done")
		.description("Move a task or an entire column to done and clean up task workspaces.")
		.option("--task-id <id>", "Task ID.")
		.option(
			"--column <column>",
			"Column to move to done: in_progress | review | on_hold | done. trash is also accepted.",
			parseListColumn,
		)
		.option("--project-path <path>", "Workspace path. Defaults to current directory workspace.")
		.action(async (options: { taskId?: string; column?: ListTaskColumn; projectPath?: string }) => {
			await runTaskCommand(
				async () =>
					await trashTask({
						cwd: process.cwd(),
						taskId: options.taskId,
						column: options.column,
						projectPath: options.projectPath,
					}),
			);
		});

	task
		.command("delete")
		.description("Permanently delete a task or every task in a column.")
		.option("--task-id <id>", "Task ID to permanently delete.")
		.option(
			"--column <column>",
			"Column to bulk-delete: in_progress | review | on_hold | done. trash is also accepted.",
			parseListColumn,
		)
		.option("--project-path <path>", "Workspace path. Defaults to current directory workspace.")
		.action(async (options: { taskId?: string; column?: ListTaskColumn; projectPath?: string }) => {
			await runTaskCommand(
				async () =>
					await deleteTaskCommand({
						cwd: process.cwd(),
						taskId: options.taskId,
						column: options.column,
						projectPath: options.projectPath,
					}),
			);
		});

	task
		.command("start")
		.description("Start or restart an in-progress task session.")
		.requiredOption("--task-id <id>", "Task ID.")
		.option("--project-path <path>", "Workspace path. Defaults to current directory workspace.")
		.action(async (options: { taskId: string; projectPath?: string }) => {
			await runTaskCommand(
				async () =>
					await startTask({
						cwd: process.cwd(),
						taskId: options.taskId,
						projectPath: options.projectPath,
					}),
			);
		});
}

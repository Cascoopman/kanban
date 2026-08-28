import { type RuntimeConfigState, toGlobalRuntimeConfigState } from "../config/runtime-config";
import type {
	RuntimeBoardColumnId,
	RuntimeBoardData,
	RuntimeProjectBoardSnapshot,
	RuntimeProjectSummary,
	RuntimeProjectTaskCounts,
	RuntimeWorkspaceStateResponse,
} from "../core/api-contract";
import {
	ensureWorkspaceIndexCompatibility,
	listWorkspaceIndexEntries,
	loadPersistedWorkspaceStateById,
	loadWorkspaceBoardById,
	loadWorkspaceContext,
	loadWorkspaceState,
	type RuntimeWorkspaceIndexEntry,
	reconcileWorkspaceSessionSummary,
} from "../state/workspace-state";
import { TerminalSessionManager } from "../terminal/session-manager";

interface WorkspaceRegistryScope {
	workspaceId: string;
	workspacePath: string;
}

export interface CreateWorkspaceRegistryDependencies {
	cwd: string;
	loadGlobalRuntimeConfig: () => Promise<RuntimeConfigState>;
	loadRuntimeConfig: (cwd: string) => Promise<RuntimeConfigState>;
	hasGitRepository: (path: string) => boolean;
	pathIsDirectory: (path: string) => Promise<boolean>;
	onTerminalManagerReady?: (workspaceId: string, manager: TerminalSessionManager) => void;
}

interface DisposeWorkspaceRegistryOptions {
	stopTerminalSessions?: boolean;
}

export interface ResolvedWorkspaceStreamTarget {
	workspaceId: string | null;
	workspacePath: string | null;
	requestedWorkspaceError: string | null;
}

interface UnavailableWorkspaceNotice {
	workspaceId: string;
	repoPath: string;
	message: string;
}

export interface WorkspaceRegistry {
	getActiveWorkspaceId: () => string | null;
	getActiveWorkspacePath: () => string | null;
	getWorkspacePathById: (workspaceId: string) => string | null;
	rememberWorkspace: (workspaceId: string, repoPath: string) => void;
	getActiveRuntimeConfig: () => RuntimeConfigState;
	setActiveRuntimeConfig: (config: RuntimeConfigState) => void;
	loadScopedRuntimeConfig: (scope: WorkspaceRegistryScope) => Promise<RuntimeConfigState>;
	getTerminalManagerForWorkspace: (workspaceId: string) => TerminalSessionManager | null;
	ensureTerminalManagerForWorkspace: (workspaceId: string, repoPath: string) => Promise<TerminalSessionManager>;
	setActiveWorkspace: (workspaceId: string, repoPath: string) => Promise<void>;
	clearActiveWorkspace: () => void;
	disposeWorkspace: (
		workspaceId: string,
		options?: DisposeWorkspaceRegistryOptions,
	) => {
		terminalManager: TerminalSessionManager | null;
		workspacePath: string | null;
	};
	summarizeProjectTaskCounts: (workspaceId: string, repoPath: string) => Promise<RuntimeProjectTaskCounts>;
	createProjectSummary: (input: {
		workspaceId: string;
		repoPath: string;
		taskCounts: RuntimeProjectTaskCounts;
	}) => RuntimeProjectSummary;
	buildWorkspaceStateSnapshot: (workspaceId: string, workspacePath: string) => Promise<RuntimeWorkspaceStateResponse>;
	buildProjectBoardSnapshots: () => Promise<RuntimeProjectBoardSnapshot[]>;
	reconcileWorkspaceSessionSummary: (
		workspaceId: string,
		summary: RuntimeWorkspaceStateResponse["sessions"][string],
	) => ReturnType<typeof reconcileWorkspaceSessionSummary>;
	buildProjectsPayload: (preferredCurrentProjectId: string | null) => Promise<{
		currentProjectId: string | null;
		projects: RuntimeProjectSummary[];
	}>;
	resolveWorkspaceForStream: (requestedWorkspaceId: string | null) => Promise<ResolvedWorkspaceStreamTarget>;
	listManagedWorkspaces: () => Array<{
		workspaceId: string;
		workspacePath: string | null;
		terminalManager: TerminalSessionManager;
	}>;
}

function createEmptyProjectTaskCounts(): RuntimeProjectTaskCounts {
	return {
		in_progress: 0,
		review: 0,
		on_hold: 0,
		trash: 0,
	};
}

function countTasksByColumn(board: RuntimeBoardData): RuntimeProjectTaskCounts {
	const counts = createEmptyProjectTaskCounts();
	for (const column of board.columns) {
		const count = column.cards.length;
		switch (column.id) {
			case "in_progress":
				counts.in_progress += count;
				break;
			case "review":
				counts.review += count;
				break;
			case "on_hold":
				counts.on_hold += count;
				break;
			case "trash":
				counts.trash += count;
				break;
		}
	}
	return counts;
}

export function collectProjectWorktreeTaskIdsForRemoval(board: RuntimeBoardData): Set<string> {
	const taskIds = new Set<string>();
	for (const column of board.columns) {
		if (column.id === "trash") {
			continue;
		}
		for (const card of column.cards) {
			taskIds.add(card.id);
		}
	}
	return taskIds;
}

function applyLiveSessionStateToProjectTaskCounts(
	counts: RuntimeProjectTaskCounts,
	board: RuntimeBoardData,
	sessionSummaries: RuntimeWorkspaceStateResponse["sessions"],
): RuntimeProjectTaskCounts {
	const taskColumnById = new Map<string, RuntimeBoardColumnId>();
	for (const column of board.columns) {
		for (const card of column.cards) {
			taskColumnById.set(card.id, column.id);
		}
	}
	const next = {
		...counts,
	};
	for (const summary of Object.values(sessionSummaries)) {
		const columnId = taskColumnById.get(summary.taskId);
		if (!columnId) {
			continue;
		}
		if (summary.state === "awaiting_review" && columnId === "in_progress") {
			next.in_progress = Math.max(0, next.in_progress - 1);
			next.review += 1;
		}
	}
	return next;
}

function toProjectSummary(project: {
	workspaceId: string;
	repoPath: string;
	taskCounts: RuntimeProjectTaskCounts;
}): RuntimeProjectSummary {
	const normalized = project.repoPath.replaceAll("\\", "/").replace(/\/+$/g, "");
	const segments = normalized.split("/").filter((segment) => segment.length > 0);
	const name = segments[segments.length - 1] ?? normalized;
	return {
		id: project.workspaceId,
		path: project.repoPath,
		name,
		taskCounts: project.taskCounts,
	};
}

export async function createWorkspaceRegistry(deps: CreateWorkspaceRegistryDependencies): Promise<WorkspaceRegistry> {
	await ensureWorkspaceIndexCompatibility();
	const launchedFromGitRepo = deps.hasGitRepository(deps.cwd);
	let initialWorkspace = null;
	if (launchedFromGitRepo) {
		try {
			initialWorkspace = await loadWorkspaceContext(deps.cwd);
		} catch {
			// A Git probe can race with a temporarily unavailable checkout. Fall back
			// to the persisted registry rather than making startup destructive.
		}
	}
	let indexedWorkspace: RuntimeWorkspaceIndexEntry | null = null;
	if (!initialWorkspace) {
		const indexedWorkspaces = await listWorkspaceIndexEntries();
		indexedWorkspace = indexedWorkspaces[0] ?? null;
	}

	let activeWorkspaceId: string | null = initialWorkspace?.workspaceId ?? indexedWorkspace?.workspaceId ?? null;
	let activeWorkspacePath: string | null = initialWorkspace?.repoPath ?? indexedWorkspace?.repoPath ?? null;
	let globalRuntimeConfig = await deps.loadGlobalRuntimeConfig();
	let activeRuntimeConfig = activeWorkspacePath
		? await deps.loadRuntimeConfig(activeWorkspacePath)
		: globalRuntimeConfig;
	const workspacePathsById = new Map<string, string>(
		activeWorkspaceId && activeWorkspacePath ? [[activeWorkspaceId, activeWorkspacePath]] : [],
	);
	const projectTaskCountsByWorkspaceId = new Map<string, RuntimeProjectTaskCounts>();
	const terminalManagersByWorkspaceId = new Map<string, TerminalSessionManager>();
	const terminalManagerLoadPromises = new Map<string, Promise<TerminalSessionManager>>();

	const rememberWorkspace = (workspaceId: string, repoPath: string): void => {
		workspacePathsById.set(workspaceId, repoPath);
	};

	const notifyTerminalManagerReady = (workspaceId: string, manager: TerminalSessionManager): void => {
		deps.onTerminalManagerReady?.(workspaceId, manager);
	};

	const getTerminalManagerForWorkspace = (workspaceId: string): TerminalSessionManager | null => {
		return terminalManagersByWorkspaceId.get(workspaceId) ?? null;
	};

	const ensureTerminalManagerForWorkspace = async (
		workspaceId: string,
		repoPath: string,
	): Promise<TerminalSessionManager> => {
		rememberWorkspace(workspaceId, repoPath);
		const existing = terminalManagersByWorkspaceId.get(workspaceId);
		if (existing) {
			notifyTerminalManagerReady(workspaceId, existing);
			return existing;
		}
		const pending = terminalManagerLoadPromises.get(workspaceId);
		if (pending) {
			const loaded = await pending;
			notifyTerminalManagerReady(workspaceId, loaded);
			return loaded;
		}
		const loading = (async () => {
			const manager = new TerminalSessionManager();
			try {
				const existingWorkspace = await loadWorkspaceState(repoPath);
				manager.hydrateFromRecord(existingWorkspace.sessions);
			} catch {
				// The checkout may be temporarily unavailable. Its persisted board and
				// sessions are still authoritative and can be hydrated without Git.
				try {
					const persistedWorkspace = await loadPersistedWorkspaceStateById(workspaceId);
					manager.hydrateFromRecord(persistedWorkspace.sessions);
				} catch {
					// Workspace state will be created on demand when the checkout returns.
				}
			}
			terminalManagersByWorkspaceId.set(workspaceId, manager);
			return manager;
		})().finally(() => {
			terminalManagerLoadPromises.delete(workspaceId);
		});
		terminalManagerLoadPromises.set(workspaceId, loading);
		const loaded = await loading;
		notifyTerminalManagerReady(workspaceId, loaded);
		return loaded;
	};

	const setActiveWorkspace = async (workspaceId: string, repoPath: string): Promise<void> => {
		activeWorkspaceId = workspaceId;
		activeWorkspacePath = repoPath;
		rememberWorkspace(workspaceId, repoPath);
		await ensureTerminalManagerForWorkspace(workspaceId, repoPath);
		activeRuntimeConfig = await deps.loadRuntimeConfig(repoPath);
		globalRuntimeConfig = toGlobalRuntimeConfigState(activeRuntimeConfig);
	};

	const clearActiveWorkspace = (): void => {
		activeWorkspaceId = null;
		activeWorkspacePath = null;
		activeRuntimeConfig = globalRuntimeConfig;
	};

	const disposeWorkspace = (
		workspaceId: string,
		options?: DisposeWorkspaceRegistryOptions,
	): { terminalManager: TerminalSessionManager | null; workspacePath: string | null } => {
		const terminalManager = getTerminalManagerForWorkspace(workspaceId);
		if (terminalManager) {
			if (options?.stopTerminalSessions !== false) {
				terminalManager.markInterruptedAndStopAll();
			}
			terminalManagersByWorkspaceId.delete(workspaceId);
			terminalManagerLoadPromises.delete(workspaceId);
		}
		projectTaskCountsByWorkspaceId.delete(workspaceId);
		const workspacePath = workspacePathsById.get(workspaceId) ?? null;
		workspacePathsById.delete(workspaceId);
		return {
			terminalManager,
			workspacePath,
		};
	};

	const summarizeProjectTaskCounts = async (
		workspaceId: string,
		_repoPath: string,
	): Promise<RuntimeProjectTaskCounts> => {
		try {
			const board = await loadWorkspaceBoardById(workspaceId);
			const persistedCounts = countTasksByColumn(board);
			const terminalManager = getTerminalManagerForWorkspace(workspaceId);
			if (!terminalManager) {
				projectTaskCountsByWorkspaceId.set(workspaceId, persistedCounts);
				return persistedCounts;
			}
			const liveSessionsByTaskId: RuntimeWorkspaceStateResponse["sessions"] = {};
			for (const summary of terminalManager.listSummaries()) {
				liveSessionsByTaskId[summary.taskId] = summary;
			}
			const nextCounts = applyLiveSessionStateToProjectTaskCounts(persistedCounts, board, liveSessionsByTaskId);
			projectTaskCountsByWorkspaceId.set(workspaceId, nextCounts);
			return nextCounts;
		} catch {
			return projectTaskCountsByWorkspaceId.get(workspaceId) ?? createEmptyProjectTaskCounts();
		}
	};

	const buildWorkspaceStateSnapshot = async (
		workspaceId: string,
		workspacePath: string,
	): Promise<RuntimeWorkspaceStateResponse> => {
		const response = await loadWorkspaceState(workspacePath);
		const terminalManager = await ensureTerminalManagerForWorkspace(workspaceId, workspacePath);
		for (const summary of terminalManager.listSummaries()) {
			response.sessions[summary.taskId] = summary;
		}
		return response;
	};

	const buildProjectBoardSnapshots = async (): Promise<RuntimeProjectBoardSnapshot[]> => {
		const projects = await listWorkspaceIndexEntries();
		return await Promise.all(
			projects.map(async (project) => {
				const terminalManager = await ensureTerminalManagerForWorkspace(project.workspaceId, project.repoPath);
				let workspaceState: Pick<RuntimeWorkspaceStateResponse, "board" | "sessions">;
				try {
					workspaceState = await loadWorkspaceState(project.repoPath);
				} catch {
					workspaceState = await loadPersistedWorkspaceStateById(project.workspaceId);
				}
				for (const summary of terminalManager.listSummaries()) {
					workspaceState.sessions[summary.taskId] = summary;
				}
				const persistedCounts = countTasksByColumn(workspaceState.board);
				const taskCounts = applyLiveSessionStateToProjectTaskCounts(
					persistedCounts,
					workspaceState.board,
					workspaceState.sessions,
				);
				return {
					project: toProjectSummary({
						workspaceId: project.workspaceId,
						repoPath: project.repoPath,
						taskCounts,
					}),
					board: workspaceState.board,
					sessions: workspaceState.sessions,
				};
			}),
		);
	};

	const reconcileSessionSummary = async (
		workspaceId: string,
		summary: RuntimeWorkspaceStateResponse["sessions"][string],
	): ReturnType<typeof reconcileWorkspaceSessionSummary> => {
		const workspacePath = workspacePathsById.get(workspaceId);
		if (!workspacePath) {
			throw new Error(`Workspace "${workspaceId}" is not loaded.`);
		}
		return await reconcileWorkspaceSessionSummary(workspacePath, summary);
	};

	const buildProjectsPayload = async (preferredCurrentProjectId: string | null) => {
		const projects = await listWorkspaceIndexEntries();
		const fallbackProjectId =
			projects.find((project) => project.workspaceId === activeWorkspaceId)?.workspaceId ?? null;
		const resolvedCurrentProjectId =
			(preferredCurrentProjectId &&
				projects.some((project) => project.workspaceId === preferredCurrentProjectId) &&
				preferredCurrentProjectId) ||
			fallbackProjectId;
		const projectSummaries = await Promise.all(
			projects.map(async (project) => {
				const taskCounts = await summarizeProjectTaskCounts(project.workspaceId, project.repoPath);
				return toProjectSummary({
					workspaceId: project.workspaceId,
					repoPath: project.repoPath,
					taskCounts,
				});
			}),
		);
		return {
			currentProjectId: resolvedCurrentProjectId,
			projects: projectSummaries,
		};
	};

	const resolveWorkspaceForStream = async (
		requestedWorkspaceId: string | null,
	): Promise<ResolvedWorkspaceStreamTarget> => {
		const allProjects = await listWorkspaceIndexEntries();
		const availableProjects: RuntimeWorkspaceIndexEntry[] = [];
		const unavailableProjects: UnavailableWorkspaceNotice[] = [];

		for (const project of allProjects) {
			let unavailableMessage: string | null = null;
			if (!(await deps.pathIsDirectory(project.repoPath))) {
				unavailableMessage = `Workspace "${project.workspaceId}" is still registered but its directory is unavailable at ${project.repoPath}. Restore or reconnect the directory, or remove the project explicitly. Persisted board and session data has been kept.`;
			} else if (!deps.hasGitRepository(project.repoPath)) {
				unavailableMessage = `Workspace "${project.workspaceId}" is still registered but Kanban could not open a Git repository at ${project.repoPath}. Check the checkout, then reconnect it or remove the project explicitly. Persisted board and session data has been kept.`;
			}

			if (!unavailableMessage) {
				availableProjects.push(project);
				continue;
			}

			unavailableProjects.push({
				workspaceId: project.workspaceId,
				repoPath: project.repoPath,
				message: unavailableMessage,
			});
		}

		const activeWorkspaceMissing = !availableProjects.some((project) => project.workspaceId === activeWorkspaceId);
		if (activeWorkspaceMissing) {
			if (availableProjects[0]) {
				await setActiveWorkspace(availableProjects[0].workspaceId, availableProjects[0].repoPath);
			} else {
				clearActiveWorkspace();
			}
		}

		if (requestedWorkspaceId) {
			const requestedWorkspace = availableProjects.find((project) => project.workspaceId === requestedWorkspaceId);
			if (requestedWorkspace) {
				if (
					activeWorkspaceId !== requestedWorkspace.workspaceId ||
					activeWorkspacePath !== requestedWorkspace.repoPath
				) {
					await setActiveWorkspace(requestedWorkspace.workspaceId, requestedWorkspace.repoPath);
				}
				return {
					workspaceId: requestedWorkspace.workspaceId,
					workspacePath: requestedWorkspace.repoPath,
					requestedWorkspaceError: null,
				};
			}
		}

		const fallbackWorkspace =
			availableProjects.find((project) => project.workspaceId === activeWorkspaceId) ?? availableProjects[0] ?? null;
		const requestedWorkspaceError = requestedWorkspaceId
			? (unavailableProjects.find((project) => project.workspaceId === requestedWorkspaceId)?.message ??
				`Unknown workspace ID: ${requestedWorkspaceId}`)
			: null;
		if (!fallbackWorkspace) {
			return {
				workspaceId: null,
				workspacePath: null,
				requestedWorkspaceError,
			};
		}
		return {
			workspaceId: fallbackWorkspace.workspaceId,
			workspacePath: fallbackWorkspace.repoPath,
			requestedWorkspaceError,
		};
	};

	const indexedProjects = await listWorkspaceIndexEntries();
	await Promise.all(
		indexedProjects.map(async (project) => {
			const manager = await ensureTerminalManagerForWorkspace(project.workspaceId, project.repoPath);
			if (!deps.hasGitRepository(project.repoPath)) {
				return;
			}
			for (const summary of manager.listSummaries()) {
				await reconcileWorkspaceSessionSummary(project.repoPath, summary);
			}
		}),
	);

	return {
		getActiveWorkspaceId: () => activeWorkspaceId,
		getActiveWorkspacePath: () => activeWorkspacePath,
		getWorkspacePathById: (workspaceId: string) => workspacePathsById.get(workspaceId) ?? null,
		rememberWorkspace,
		getActiveRuntimeConfig: () => activeRuntimeConfig,
		setActiveRuntimeConfig: (config: RuntimeConfigState) => {
			globalRuntimeConfig = toGlobalRuntimeConfigState(config);
			activeRuntimeConfig = activeWorkspaceId ? config : globalRuntimeConfig;
		},
		loadScopedRuntimeConfig: async (scope: WorkspaceRegistryScope) => {
			if (scope.workspaceId === activeWorkspaceId) {
				return activeRuntimeConfig;
			}
			return await deps.loadRuntimeConfig(scope.workspacePath);
		},
		getTerminalManagerForWorkspace,
		ensureTerminalManagerForWorkspace,
		setActiveWorkspace,
		clearActiveWorkspace,
		disposeWorkspace,
		summarizeProjectTaskCounts,
		createProjectSummary: toProjectSummary,
		buildWorkspaceStateSnapshot,
		buildProjectBoardSnapshots,
		reconcileWorkspaceSessionSummary: reconcileSessionSummary,
		buildProjectsPayload,
		resolveWorkspaceForStream,
		listManagedWorkspaces: () => {
			return Array.from(terminalManagersByWorkspaceId.entries()).map(([workspaceId, terminalManager]) => ({
				workspaceId,
				workspacePath: workspacePathsById.get(workspaceId) ?? null,
				terminalManager,
			}));
		},
	};
}

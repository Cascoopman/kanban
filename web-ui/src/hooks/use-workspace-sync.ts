import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { notifyError } from "@/components/app-toaster";
import { createInitialBoardData } from "@/data/board-data";
import { selectNewestTaskSessionSummary } from "@/hooks/task-session-summary";
import { areWorkspaceBoardsEqual, mergeWorkspaceBoards } from "@/runtime/merge-workspace-board";
import type {
	RuntimeGitRepositoryInfo,
	RuntimeTaskSessionSummary,
	RuntimeWorkspaceStateResponse,
} from "@/runtime/types";
import { fetchWorkspaceState } from "@/runtime/workspace-state-query";
import { normalizeBoardData } from "@/state/board-state";
import type { BoardData } from "@/types";

interface UseWorkspaceSyncInput {
	board: BoardData;
	currentProjectId: string | null;
	streamedWorkspaceState: RuntimeWorkspaceStateResponse | null;
	hasNoProjects: boolean;
	hasReceivedSnapshot: boolean;
	isDocumentVisible: boolean;
	setBoard: Dispatch<SetStateAction<BoardData>>;
	setSessions: Dispatch<SetStateAction<Record<string, RuntimeTaskSessionSummary>>>;
	setCanPersistWorkspaceState: Dispatch<SetStateAction<boolean>>;
	onWorkspaceStateConflict?: (input: { workspaceId: string; currentRevision: number }) => void;
	getPendingPersistBoard?: () => BoardData | null;
}

interface RefreshWorkspaceStateOptions {
	discardLocalBoardChanges?: boolean;
	mergeBaseBoard?: BoardData;
}

interface UseWorkspaceSyncResult {
	workspacePath: string | null;
	workspaceGit: RuntimeGitRepositoryInfo | null;
	workspaceRevision: number | null;
	workspaceBaseBoard: BoardData | null;
	isWorkspaceStateRefreshing: boolean;
	isWorkspaceMetadataPending: boolean;
	refreshWorkspaceState: (options?: RefreshWorkspaceStateOptions) => Promise<void>;
	acceptWorkspaceState: (workspaceState: RuntimeWorkspaceStateResponse, persistedBoard?: BoardData) => void;
	resetWorkspaceSyncState: () => void;
}

function mergeTaskSessionSummaries(
	currentSessions: Record<string, RuntimeTaskSessionSummary>,
	nextSessions: Record<string, RuntimeTaskSessionSummary>,
): Record<string, RuntimeTaskSessionSummary> {
	const mergedSessions = { ...currentSessions };
	for (const [taskId, summary] of Object.entries(nextSessions)) {
		const newestSummary = selectNewestTaskSessionSummary(mergedSessions[taskId] ?? null, summary);
		if (newestSummary) {
			mergedSessions[taskId] = newestSummary;
		}
	}
	return mergedSessions;
}

export function useWorkspaceSync({
	board,
	currentProjectId,
	streamedWorkspaceState,
	hasNoProjects,
	hasReceivedSnapshot,
	isDocumentVisible,
	setBoard,
	setSessions,
	setCanPersistWorkspaceState,
	onWorkspaceStateConflict,
	getPendingPersistBoard,
}: UseWorkspaceSyncInput): UseWorkspaceSyncResult {
	const [workspacePath, setWorkspacePath] = useState<string | null>(null);
	const [workspaceGit, setWorkspaceGit] = useState<RuntimeGitRepositoryInfo | null>(null);
	const [appliedWorkspaceProjectId, setAppliedWorkspaceProjectId] = useState<string | null>(null);
	const [workspaceRevision, setWorkspaceRevision] = useState<number | null>(null);
	const [workspaceBaseBoard, setWorkspaceBaseBoard] = useState<BoardData | null>(null);
	const [isWorkspaceStateRefreshing, setIsWorkspaceStateRefreshing] = useState(false);
	const boardRef = useRef(board);
	boardRef.current = board;
	const workspaceVersionRef = useRef<{ projectId: string | null; revision: number | null }>({
		projectId: null,
		revision: null,
	});
	const workspaceBaseBoardRef = useRef<{ projectId: string | null; board: BoardData | null }>({
		projectId: null,
		board: null,
	});
	const workspaceRefreshRequestIdRef = useRef(0);
	const hasProcessedCurrentRuntimeSnapshotRef = useRef(false);

	const isWorkspaceMetadataPending = currentProjectId !== null && appliedWorkspaceProjectId !== currentProjectId;

	useEffect(() => {
		if (workspaceVersionRef.current.projectId !== currentProjectId) {
			return;
		}
		workspaceVersionRef.current = {
			projectId: currentProjectId,
			revision: workspaceRevision,
		};
	}, [currentProjectId, workspaceRevision]);

	const applyWorkspaceState = useCallback(
		(nextWorkspaceState: RuntimeWorkspaceStateResponse | null, options: RefreshWorkspaceStateOptions = {}) => {
			if (!nextWorkspaceState) {
				setCanPersistWorkspaceState(false);
				setWorkspacePath(null);
				setWorkspaceGit(null);
				setAppliedWorkspaceProjectId(null);
				setBoard(createInitialBoardData());
				setSessions({});
				setWorkspaceRevision(null);
				setWorkspaceBaseBoard(null);
				workspaceVersionRef.current = {
					projectId: currentProjectId,
					revision: null,
				};
				workspaceBaseBoardRef.current = {
					projectId: currentProjectId,
					board: null,
				};
				return;
			}
			const currentVersion = workspaceVersionRef.current;
			const isSameProject = currentVersion.projectId === currentProjectId;
			const currentRevision = isSameProject ? currentVersion.revision : null;
			if (isSameProject && currentRevision !== null && nextWorkspaceState.revision < currentRevision) {
				return;
			}
			setWorkspacePath(nextWorkspaceState.repoPath);
			setWorkspaceGit(nextWorkspaceState.git);
			setSessions((currentSessions) => {
				const incomingSessions = nextWorkspaceState.sessions ?? {};
				return mergeTaskSessionSummaries(currentSessions, incomingSessions);
			});
			const normalizedRemoteBoard = normalizeBoardData(nextWorkspaceState.board) ?? createInitialBoardData();
			const shouldApplyBoard =
				options.discardLocalBoardChanges || !isSameProject || currentRevision !== nextWorkspaceState.revision;
			if (shouldApplyBoard) {
				let currentBaseBoard =
					options.mergeBaseBoard ??
					(workspaceBaseBoardRef.current.projectId === currentProjectId
						? workspaceBaseBoardRef.current.board
						: null);
				const pendingPersistBoard = options.mergeBaseBoard ? null : getPendingPersistBoard?.();
				if (isSameProject && currentBaseBoard && pendingPersistBoard) {
					const pendingInRemote = mergeWorkspaceBoards(
						currentBaseBoard,
						pendingPersistBoard,
						normalizedRemoteBoard,
					);
					if (
						pendingInRemote.status === "merged" &&
						areWorkspaceBoardsEqual(pendingInRemote.board, normalizedRemoteBoard)
					) {
						currentBaseBoard = pendingPersistBoard;
					}
				}
				let nextBoard = normalizedRemoteBoard;
				if (isSameProject && currentBaseBoard && !options.discardLocalBoardChanges) {
					const merged = mergeWorkspaceBoards(currentBaseBoard, boardRef.current, normalizedRemoteBoard);
					if (merged.status === "merged") {
						nextBoard = merged.board;
					} else {
						// Never replace unsaved browser state merely because reconciliation
						// failed. A later user edit or refresh can retry from the new baseline.
						nextBoard = boardRef.current;
						onWorkspaceStateConflict?.({
							workspaceId: currentProjectId ?? "",
							currentRevision: nextWorkspaceState.revision,
						});
					}
				}
				if (!areWorkspaceBoardsEqual(boardRef.current, nextBoard)) {
					boardRef.current = nextBoard;
					setBoard(nextBoard);
				}
				setWorkspaceBaseBoard(normalizedRemoteBoard);
				workspaceBaseBoardRef.current = {
					projectId: currentProjectId,
					board: normalizedRemoteBoard,
				};
			}
			setWorkspaceRevision(nextWorkspaceState.revision);
			workspaceVersionRef.current = {
				projectId: currentProjectId,
				revision: nextWorkspaceState.revision,
			};
			setAppliedWorkspaceProjectId(currentProjectId);
			setCanPersistWorkspaceState(true);
		},
		[
			currentProjectId,
			getPendingPersistBoard,
			onWorkspaceStateConflict,
			setBoard,
			setCanPersistWorkspaceState,
			setSessions,
		],
	);

	const refreshWorkspaceState = useCallback(
		async (options: RefreshWorkspaceStateOptions = {}) => {
			if (!currentProjectId) {
				return;
			}
			const requestId = workspaceRefreshRequestIdRef.current + 1;
			workspaceRefreshRequestIdRef.current = requestId;
			const requestedProjectId = currentProjectId;
			setIsWorkspaceStateRefreshing(true);
			try {
				const refreshed = await fetchWorkspaceState(requestedProjectId);
				if (
					workspaceRefreshRequestIdRef.current !== requestId ||
					workspaceVersionRef.current.projectId !== requestedProjectId
				) {
					return;
				}
				applyWorkspaceState(refreshed, options);
			} catch (error) {
				if (
					workspaceRefreshRequestIdRef.current !== requestId ||
					workspaceVersionRef.current.projectId !== requestedProjectId
				) {
					return;
				}
				const message = error instanceof Error ? error.message : String(error);
				notifyError(message);
			} finally {
				if (workspaceRefreshRequestIdRef.current === requestId) {
					setIsWorkspaceStateRefreshing(false);
				}
			}
		},
		[applyWorkspaceState, currentProjectId],
	);

	const acceptWorkspaceState = useCallback(
		(workspaceState: RuntimeWorkspaceStateResponse, persistedBoard?: BoardData) => {
			applyWorkspaceState(workspaceState, { mergeBaseBoard: persistedBoard });
		},
		[applyWorkspaceState],
	);

	const resetWorkspaceSyncState = useCallback(() => {
		workspaceRefreshRequestIdRef.current += 1;
		setCanPersistWorkspaceState(false);
		setWorkspaceRevision(null);
		setWorkspaceBaseBoard(null);
		setIsWorkspaceStateRefreshing(false);
		setAppliedWorkspaceProjectId(null);
		workspaceVersionRef.current = {
			projectId: currentProjectId,
			revision: null,
		};
		workspaceBaseBoardRef.current = {
			projectId: currentProjectId,
			board: null,
		};
	}, [currentProjectId, setCanPersistWorkspaceState]);

	useEffect(() => {
		if (hasNoProjects) {
			applyWorkspaceState(null);
			return;
		}
		if (!streamedWorkspaceState) {
			return;
		}
		applyWorkspaceState(streamedWorkspaceState);
	}, [applyWorkspaceState, hasNoProjects, streamedWorkspaceState]);

	useEffect(() => {
		if (!hasReceivedSnapshot) {
			hasProcessedCurrentRuntimeSnapshotRef.current = false;
			return;
		}
		if (!hasProcessedCurrentRuntimeSnapshotRef.current) {
			hasProcessedCurrentRuntimeSnapshotRef.current = true;
			return;
		}
		if (!isDocumentVisible) {
			return;
		}
		void refreshWorkspaceState();
	}, [hasReceivedSnapshot, isDocumentVisible, refreshWorkspaceState]);

	return {
		workspacePath,
		workspaceGit,
		workspaceRevision,
		workspaceBaseBoard,
		isWorkspaceStateRefreshing,
		isWorkspaceMetadataPending,
		refreshWorkspaceState,
		acceptWorkspaceState,
		resetWorkspaceSyncState,
	};
}

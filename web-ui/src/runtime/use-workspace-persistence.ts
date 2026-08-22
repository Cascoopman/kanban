import { useEffect, useRef, useState } from "react";
import { areWorkspaceBoardsEqual, mergeWorkspaceBoards } from "@/runtime/merge-workspace-board";
import type {
	RuntimeTaskSessionSummary,
	RuntimeWorkspaceStateResponse,
	RuntimeWorkspaceStateSaveRequest,
} from "@/runtime/types";
import { WorkspaceStateConflictError } from "@/runtime/workspace-state-query";
import type { BoardData } from "@/types";

const WORKSPACE_STATE_PERSIST_DEBOUNCE_MS = 120;
const WORKSPACE_STATE_CONFLICT_RETRY_LIMIT = 3;

function mergeSessionSummaries(
	currentSessions: Record<string, RuntimeTaskSessionSummary>,
	localSessions: Record<string, RuntimeTaskSessionSummary>,
): Record<string, RuntimeTaskSessionSummary> {
	const mergedSessions = { ...currentSessions };
	for (const [taskId, localSummary] of Object.entries(localSessions)) {
		const currentSummary = mergedSessions[taskId];
		if (!currentSummary || localSummary.updatedAt >= currentSummary.updatedAt) {
			mergedSessions[taskId] = localSummary;
		}
	}
	return mergedSessions;
}

export interface UseWorkspacePersistenceParams {
	board: BoardData;
	workspaceBaseBoard: BoardData | null;
	sessions: Record<string, RuntimeTaskSessionSummary>;
	currentProjectId: string | null;
	workspaceRevision: number | null;
	canPersistWorkspaceState: boolean;
	isDocumentVisible: boolean;
	isWorkspaceStateRefreshing: boolean;
	persistWorkspaceState: (input: {
		workspaceId: string;
		payload: RuntimeWorkspaceStateSaveRequest;
	}) => Promise<RuntimeWorkspaceStateResponse>;
	loadWorkspaceState: (workspaceId: string) => Promise<RuntimeWorkspaceStateResponse>;
	resolveWorkspaceStateConflict: () => Promise<unknown>;
	onWorkspaceStateSaved: (workspaceState: RuntimeWorkspaceStateResponse, persistedBoard: BoardData) => void;
	onWorkspaceStateConflict?: (input: { workspaceId: string; currentRevision: number }) => void;
	onPendingPersistBoardChange?: (board: BoardData | null) => void;
}

export function useWorkspacePersistence({
	board,
	workspaceBaseBoard,
	sessions,
	currentProjectId,
	workspaceRevision,
	canPersistWorkspaceState,
	isDocumentVisible,
	isWorkspaceStateRefreshing,
	persistWorkspaceState,
	loadWorkspaceState,
	resolveWorkspaceStateConflict,
	onWorkspaceStateSaved,
	onWorkspaceStateConflict,
	onPendingPersistBoardChange,
}: UseWorkspacePersistenceParams): void {
	const [persistCycle, setPersistCycle] = useState(0);
	const latestPersistRequestIdRef = useRef(0);
	const persistInFlightRef = useRef(false);
	const persistQueuedRef = useRef(false);
	const currentProjectIdRef = useRef<string | null>(currentProjectId);
	const sessionsRef = useRef(sessions);

	useEffect(() => {
		currentProjectIdRef.current = currentProjectId;
	}, [currentProjectId]);

	useEffect(() => {
		sessionsRef.current = sessions;
	}, [sessions]);

	useEffect(() => {
		if (
			!canPersistWorkspaceState ||
			!isDocumentVisible ||
			isWorkspaceStateRefreshing ||
			workspaceRevision == null ||
			workspaceBaseBoard == null
		) {
			return;
		}
		if (persistInFlightRef.current) {
			persistQueuedRef.current = true;
			return;
		}
		if (areWorkspaceBoardsEqual(workspaceBaseBoard, board)) {
			return;
		}
		const timeoutId = window.setTimeout(() => {
			const requestId = latestPersistRequestIdRef.current + 1;
			latestPersistRequestIdRef.current = requestId;
			const persistWorkspaceId = currentProjectId;
			if (!persistWorkspaceId) {
				return;
			}
			const payload: RuntimeWorkspaceStateSaveRequest = {
				board,
				sessions: sessionsRef.current,
				expectedRevision: workspaceRevision,
			};
			let mergeBaseBoard = workspaceBaseBoard;
			onPendingPersistBoardChange?.(payload.board);
			void (async () => {
				persistInFlightRef.current = true;
				try {
					let pendingPayload = payload;
					let conflictRetryCount = 0;
					let saved: RuntimeWorkspaceStateResponse | null = null;
					while (!saved) {
						try {
							saved = await persistWorkspaceState({
								workspaceId: persistWorkspaceId,
								payload: pendingPayload,
							});
						} catch (error) {
							if (!(error instanceof WorkspaceStateConflictError)) {
								throw error;
							}
							if (currentProjectIdRef.current !== persistWorkspaceId) {
								return;
							}

							const currentWorkspaceState = await loadWorkspaceState(persistWorkspaceId);
							if (currentProjectIdRef.current !== persistWorkspaceId) {
								return;
							}
							const mergedBoard = mergeWorkspaceBoards(
								mergeBaseBoard,
								pendingPayload.board,
								currentWorkspaceState.board,
							);
							if (
								mergedBoard.status === "conflict" ||
								conflictRetryCount >= WORKSPACE_STATE_CONFLICT_RETRY_LIMIT
							) {
								onWorkspaceStateConflict?.({
									workspaceId: persistWorkspaceId,
									currentRevision: currentWorkspaceState.revision,
								});
								await resolveWorkspaceStateConflict();
								return;
							}

							conflictRetryCount += 1;
							mergeBaseBoard = currentWorkspaceState.board;
							pendingPayload = {
								...pendingPayload,
								board: mergedBoard.board,
								sessions: mergeSessionSummaries(currentWorkspaceState.sessions, sessionsRef.current),
								expectedRevision: currentWorkspaceState.revision,
							};
							onPendingPersistBoardChange?.(pendingPayload.board);
						}
					}
					if (
						requestId !== latestPersistRequestIdRef.current ||
						currentProjectIdRef.current !== persistWorkspaceId
					) {
						return;
					}
					onWorkspaceStateSaved(saved, pendingPayload.board);
				} catch {
					// Keep the UI usable even if persistence is temporarily unavailable.
				} finally {
					onPendingPersistBoardChange?.(null);
					persistInFlightRef.current = false;
					if (persistQueuedRef.current) {
						persistQueuedRef.current = false;
						setPersistCycle((current) => current + 1);
					}
				}
			})();
		}, WORKSPACE_STATE_PERSIST_DEBOUNCE_MS);
		return () => {
			window.clearTimeout(timeoutId);
		};
	}, [
		board,
		canPersistWorkspaceState,
		currentProjectId,
		isDocumentVisible,
		isWorkspaceStateRefreshing,
		loadWorkspaceState,
		onWorkspaceStateSaved,
		onPendingPersistBoardChange,
		persistCycle,
		persistWorkspaceState,
		resolveWorkspaceStateConflict,
		onWorkspaceStateConflict,
		workspaceBaseBoard,
		workspaceRevision,
	]);
}

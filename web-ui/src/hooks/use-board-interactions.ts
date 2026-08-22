import type { DropResult } from "@hello-pangea/dnd";
import pLimit from "p-limit";
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { notifyError, showAppToast } from "@/components/app-toaster";
import { useProgrammaticCardMoves } from "@/hooks/use-programmatic-card-moves";
import type { StartTaskSessionOptions, UseTaskSessionsResult } from "@/hooks/use-task-sessions";
import { useTaskTrashActions } from "@/hooks/use-task-trash-actions";
import type { RuntimeTaskSessionSummary, RuntimeTaskWorkspaceInfoResponse } from "@/runtime/types";
import {
	applyDragResult,
	clearColumnTasks,
	findCardSelection,
	getTaskColumnId,
	moveTaskToColumn,
} from "@/state/board-state";
import { clearTaskWorkspaceInfo, setTaskWorkspaceInfo } from "@/stores/workspace-metadata-store";
import type { SendTerminalInputOptions } from "@/terminal/terminal-input";
import type { BoardCard, BoardColumnId, BoardData } from "@/types";
import {
	getBrowserNotificationPermission,
	hasPromptedForBrowserNotificationPermission,
	requestBrowserNotificationPermission,
} from "@/utils/notification-permission";

// Clearing the Done column fires stopTaskSession + cleanupTaskWorkspace per task.
// The tRPC client batches same-tick calls into one request, so an unbounded
// Promise.all makes the server run every stop/worktree-delete concurrently —
// with a large column that means 100+ simultaneous git operations against the
// shared repo, which can freeze or crash the runtime. Bound the fan-out instead.
const CLEAR_TRASH_CLEANUP_CONCURRENCY = 4;

interface SelectedBoardCard {
	card: BoardCard;
	column: {
		id: BoardColumnId;
	};
}

interface UseBoardInteractionsInput {
	board: BoardData;
	setBoard: Dispatch<SetStateAction<BoardData>>;
	setSessions: Dispatch<SetStateAction<Record<string, RuntimeTaskSessionSummary>>>;
	selectedCard: SelectedBoardCard | null;
	selectedTaskId: string | null;
	currentProjectId: string | null;
	setSelectedTaskId: Dispatch<SetStateAction<string | null>>;
	setIsClearTrashDialogOpen: Dispatch<SetStateAction<boolean>>;
	setIsGitHistoryOpen: Dispatch<SetStateAction<boolean>>;
	stopTaskSession: (taskId: string) => Promise<void>;
	cleanupTaskWorkspace: (taskId: string) => Promise<unknown>;
	ensureTaskWorkspace: UseTaskSessionsResult["ensureTaskWorkspace"];
	startTaskSession: UseTaskSessionsResult["startTaskSession"];
	fetchTaskWorkspaceInfo: (task: BoardCard) => Promise<RuntimeTaskWorkspaceInfoResponse | null>;
	sendTaskSessionInput: (
		taskId: string,
		input: string,
		options?: SendTerminalInputOptions,
	) => Promise<{ ok: boolean; message?: string }>;
	readyForReviewNotificationsEnabled: boolean;
}

export interface UseBoardInteractionsResult {
	handleProgrammaticCardMoveReady: ReturnType<typeof useProgrammaticCardMoves>["handleProgrammaticCardMoveReady"];
	confirmMoveTaskToTrash: (task: BoardCard, currentBoard?: BoardData) => Promise<void>;
	handleDragEnd: (result: DropResult, options?: { selectDroppedTask?: boolean }) => void;
	handleStartTask: (taskId: string, options?: StartTaskSessionOptions) => void;
	handleDetailTaskDragEnd: (result: DropResult) => void;
	handleCardSelect: (taskId: string) => void;
	handleMoveToTrash: () => void;
	handleMoveReviewCardToTrash: (taskId: string) => void;
	handleRestoreTaskFromTrash: (taskId: string) => void;
	handleOpenClearTrash: () => void;
	handleConfirmClearTrash: () => void;
	handleAddReviewComments: (taskId: string, text: string) => Promise<void>;
	handleSendReviewComments: (taskId: string, text: string) => Promise<void>;
	moveToTrashLoadingById: Record<string, boolean>;
	trashTaskCount: number;
}

export function useBoardInteractions({
	board,
	setBoard,
	setSessions,
	selectedCard,
	selectedTaskId,
	currentProjectId,
	setSelectedTaskId,
	setIsClearTrashDialogOpen,
	setIsGitHistoryOpen,
	stopTaskSession,
	cleanupTaskWorkspace,
	ensureTaskWorkspace,
	startTaskSession,
	fetchTaskWorkspaceInfo,
	sendTaskSessionInput,
	readyForReviewNotificationsEnabled,
}: UseBoardInteractionsInput): UseBoardInteractionsResult {
	const notificationPermissionPromptInFlightRef = useRef(false);
	const moveToTrashLoadingByIdRef = useRef<Record<string, true>>({});
	const [moveToTrashLoadingById, setMoveToTrashLoadingById] = useState<Record<string, boolean>>({});
	const {
		handleProgrammaticCardMoveReady,
		setRequestMoveTaskToTrashHandler,
		tryProgrammaticCardMove,
		consumeProgrammaticCardMove,
		resolvePendingProgrammaticTrashMove,
		resetProgrammaticCardMoves,
		requestMoveTaskToTrashWithAnimation,
	} = useProgrammaticCardMoves();

	const setTaskMoveToTrashLoading = useCallback((taskId: string, isLoading: boolean) => {
		if (isLoading) {
			moveToTrashLoadingByIdRef.current[taskId] = true;
			setMoveToTrashLoadingById((current) => {
				if (current[taskId]) {
					return current;
				}
				return {
					...current,
					[taskId]: true,
				};
			});
			return;
		}

		delete moveToTrashLoadingByIdRef.current[taskId];
		setMoveToTrashLoadingById((current) => {
			if (!current[taskId]) {
				return current;
			}
			const next = { ...current };
			delete next[taskId];
			return next;
		});
	}, []);

	const handleAddReviewComments = useCallback(
		async (taskId: string, text: string) => {
			const typed = await sendTaskSessionInput(taskId, text, { appendNewline: false, mode: "paste" });
			if (!typed.ok) {
				showAppToast({
					intent: "danger",
					icon: "warning-sign",
					message: typed.message ?? "Could not add review comments to the task session.",
					timeout: 7000,
				});
			}
		},
		[sendTaskSessionInput],
	);

	const handleSendReviewComments = useCallback(
		async (taskId: string, text: string) => {
			const typed = await sendTaskSessionInput(taskId, text, { appendNewline: false, mode: "paste" });
			if (!typed.ok) {
				showAppToast({
					intent: "danger",
					icon: "warning-sign",
					message: typed.message ?? "Could not send review comments to the task session.",
					timeout: 7000,
				});
				return;
			}
			await new Promise<void>((resolve) => {
				setTimeout(resolve, 200);
			});
			const submitted = await sendTaskSessionInput(taskId, "\r", { appendNewline: false });
			if (!submitted.ok) {
				showAppToast({
					intent: "danger",
					icon: "warning-sign",
					message: submitted.message ?? "Could not submit review comments to the task session.",
					timeout: 7000,
				});
			}
		},
		[sendTaskSessionInput],
	);

	const trashTaskIds = useMemo(() => {
		const trashColumn = board.columns.find((column) => column.id === "trash");
		return trashColumn ? trashColumn.cards.map((card) => card.id) : [];
	}, [board.columns]);
	const trashTaskCount = trashTaskIds.length;

	const maybeRequestNotificationPermissionForTaskStart = useCallback(() => {
		const shouldPromptForNotificationPermission =
			readyForReviewNotificationsEnabled &&
			getBrowserNotificationPermission() === "default" &&
			!hasPromptedForBrowserNotificationPermission() &&
			!notificationPermissionPromptInFlightRef.current;
		if (!shouldPromptForNotificationPermission) {
			return;
		}
		notificationPermissionPromptInFlightRef.current = true;
		void requestBrowserNotificationPermission().finally(() => {
			notificationPermissionPromptInFlightRef.current = false;
		});
	}, [readyForReviewNotificationsEnabled]);

	const kickoffTaskInProgress = useCallback(
		async (task: BoardCard, sessionOptions?: StartTaskSessionOptions): Promise<boolean> => {
			const ensured = await ensureTaskWorkspace(task);
			if (!ensured.ok) {
				notifyError(ensured.message ?? "Could not set up task workspace.");
				return false;
			}
			if (ensured.response?.warning) {
				showAppToast({
					intent: "warning",
					icon: "warning-sign",
					message: ensured.response.warning,
					timeout: 7000,
				});
			}
			if (selectedTaskId === task.id) {
				if (ensured.response) {
					setTaskWorkspaceInfo({
						taskId: task.id,
						path: ensured.response.path,
						exists: true,
						baseRef: ensured.response.baseRef,
						branch: null,
						isDetached: true,
						headCommit: ensured.response.baseCommit,
					});
				}
				const infoAfterEnsure = await fetchTaskWorkspaceInfo(task);
				if (infoAfterEnsure) {
					setTaskWorkspaceInfo(infoAfterEnsure);
				}
			}
			const started = sessionOptions ? await startTaskSession(task, sessionOptions) : await startTaskSession(task);
			if (!started.ok) {
				notifyError(started.message ?? "Could not start task session.");
				return false;
			}
			return true;
		},
		[ensureTaskWorkspace, fetchTaskWorkspaceInfo, selectedTaskId, startTaskSession],
	);
	const { confirmMoveTaskToTrash, requestMoveTaskToTrash } = useTaskTrashActions({
		board,
		setBoard,
		setSelectedTaskId,
		stopTaskSession,
		cleanupTaskWorkspace,
	});

	useEffect(() => {
		setRequestMoveTaskToTrashHandler(requestMoveTaskToTrash);
	}, [requestMoveTaskToTrash, setRequestMoveTaskToTrashHandler]);

	const resumeTaskFromTrash = useCallback(
		async (task: BoardCard, taskId: string, options?: { optimisticMoveApplied?: boolean }): Promise<void> => {
			const ensured = await ensureTaskWorkspace(task);
			if (!ensured.ok) {
				notifyError(ensured.message ?? "Could not set up task workspace.");
				if (!options?.optimisticMoveApplied) {
					return;
				}
				setBoard((currentBoard) => {
					const currentColumnId = getTaskColumnId(currentBoard, taskId);
					if (currentColumnId !== "review") {
						return currentBoard;
					}
					const reverted = moveTaskToColumn(currentBoard, taskId, "trash", {
						insertAtTop: true,
					});
					return reverted.moved ? reverted.board : currentBoard;
				});
				return;
			}
			if (ensured.response?.warning) {
				showAppToast({
					intent: "warning",
					icon: "warning-sign",
					message: ensured.response.warning,
					timeout: 7000,
				});
			}
			const resumed = await startTaskSession(task, { resumeFromTrash: true });
			if (resumed.ok) {
				return;
			}

			notifyError(resumed.message ?? "Could not resume task session.");
			if (!options?.optimisticMoveApplied) {
				return;
			}
			setBoard((currentBoard) => {
				const currentColumnId = getTaskColumnId(currentBoard, taskId);
				if (currentColumnId !== "review") {
					return currentBoard;
				}
				const reverted = moveTaskToColumn(currentBoard, taskId, "trash", {
					insertAtTop: true,
				});
				return reverted.moved ? reverted.board : currentBoard;
			});
		},
		[ensureTaskWorkspace, setBoard, startTaskSession],
	);

	const handleDragEnd = useCallback(
		(result: DropResult, options?: { selectDroppedTask?: boolean }) => {
			if (options?.selectDroppedTask && result.type.startsWith("CARD") && result.destination) {
				setSelectedTaskId(result.draggableId);
			}
			const { behavior: programmaticMoveBehavior, programmaticCardMoveInFlight } = consumeProgrammaticCardMove(
				result.draggableId,
			);

			const applied = applyDragResult(board, result, { programmaticCardMoveInFlight });

			const moveEvent = applied.moveEvent;
			if (!moveEvent) {
				setBoard(applied.board);
				return;
			}

			if (moveEvent.toColumnId === "trash") {
				setBoard(applied.board);
				if (programmaticMoveBehavior?.skipTrashWorkflow) {
					resolvePendingProgrammaticTrashMove(moveEvent.taskId);
					return;
				}
				const requestPromise = requestMoveTaskToTrash(moveEvent.taskId, moveEvent.fromColumnId, {
					optimisticMoveApplied: true,
					skipWorkingChangeWarning: programmaticMoveBehavior?.skipWorkingChangeWarning,
				});
				void requestPromise.finally(() => {
					resolvePendingProgrammaticTrashMove(moveEvent.taskId);
				});
				return;
			}

			if (moveEvent.fromColumnId === "trash" && moveEvent.toColumnId === "review") {
				setBoard(applied.board);
				const movedSelection = findCardSelection(applied.board, moveEvent.taskId);
				if (!movedSelection) {
					return;
				}
				void resumeTaskFromTrash(movedSelection.card, moveEvent.taskId, { optimisticMoveApplied: true });
				return;
			}

			setBoard(applied.board);
		},
		[
			board,
			consumeProgrammaticCardMove,
			requestMoveTaskToTrash,
			resumeTaskFromTrash,
			resolvePendingProgrammaticTrashMove,
			setBoard,
			setSelectedTaskId,
		],
	);

	const handleStartTask = useCallback(
		(taskId: string, options?: StartTaskSessionOptions) => {
			const selection = findCardSelection(board, taskId);
			if (!selection || selection.column.id !== "in_progress") {
				return;
			}
			maybeRequestNotificationPermissionForTaskStart();
			void kickoffTaskInProgress(selection.card, options);
		},
		[board, kickoffTaskInProgress, maybeRequestNotificationPermissionForTaskStart],
	);

	const handleDetailTaskDragEnd = useCallback(
		(result: DropResult) => {
			handleDragEnd(result);
		},
		[handleDragEnd],
	);

	const handleCardSelect = useCallback(
		(taskId: string) => {
			const selection = findCardSelection(board, taskId);
			if (!selection || selection.column.id === "trash") {
				return;
			}
			setSelectedTaskId(taskId);
			setIsGitHistoryOpen(false);
		},
		[board, setIsGitHistoryOpen, setSelectedTaskId],
	);

	const handleMoveToTrash = useCallback(() => {
		if (!selectedCard) {
			return;
		}
		if (moveToTrashLoadingByIdRef.current[selectedCard.card.id]) {
			return;
		}
		setTaskMoveToTrashLoading(selectedCard.card.id, true);
		void requestMoveTaskToTrashWithAnimation(selectedCard.card.id, selectedCard.column.id).finally(() => {
			setTaskMoveToTrashLoading(selectedCard.card.id, false);
		});
	}, [requestMoveTaskToTrashWithAnimation, selectedCard, setTaskMoveToTrashLoading]);

	const handleMoveReviewCardToTrash = useCallback(
		(taskId: string) => {
			if (moveToTrashLoadingByIdRef.current[taskId]) {
				return;
			}
			setTaskMoveToTrashLoading(taskId, true);
			void requestMoveTaskToTrashWithAnimation(taskId, "review").finally(() => {
				setTaskMoveToTrashLoading(taskId, false);
			});
		},
		[requestMoveTaskToTrashWithAnimation, setTaskMoveToTrashLoading],
	);

	const handleRestoreTaskFromTrash = useCallback(
		(taskId: string) => {
			const programmaticMoveAttempt = tryProgrammaticCardMove(taskId, "trash", "review");
			if (programmaticMoveAttempt === "started" || programmaticMoveAttempt === "blocked") {
				return;
			}

			const selection = findCardSelection(board, taskId);
			if (!selection || selection.column.id !== "trash") {
				return;
			}

			const moved = moveTaskToColumn(board, taskId, "review", { insertAtTop: true });
			if (!moved.moved) {
				return;
			}
			setBoard(moved.board);
			const movedSelection = findCardSelection(moved.board, taskId);
			if (!movedSelection) {
				return;
			}
			void resumeTaskFromTrash(movedSelection.card, taskId, { optimisticMoveApplied: true });
		},
		[board, resumeTaskFromTrash, setBoard, tryProgrammaticCardMove],
	);

	const handleOpenClearTrash = useCallback(() => {
		if (trashTaskCount === 0) {
			return;
		}
		setIsClearTrashDialogOpen(true);
	}, [setIsClearTrashDialogOpen, trashTaskCount]);

	const handleConfirmClearTrash = useCallback(() => {
		const taskIds = [...trashTaskIds];
		setIsClearTrashDialogOpen(false);
		if (taskIds.length === 0) {
			return;
		}

		setBoard((currentBoard) => clearColumnTasks(currentBoard, "trash").board);
		setSessions((currentSessions) => {
			const nextSessions = { ...currentSessions };
			for (const taskId of taskIds) {
				delete nextSessions[taskId];
			}
			return nextSessions;
		});
		if (selectedTaskId && taskIds.includes(selectedTaskId)) {
			setSelectedTaskId(null);
			clearTaskWorkspaceInfo(selectedTaskId);
		}

		const limitCleanup = pLimit(CLEAR_TRASH_CLEANUP_CONCURRENCY);
		void (async () => {
			await Promise.all(
				taskIds.map((taskId) =>
					limitCleanup(async () => {
						await stopTaskSession(taskId);
						await cleanupTaskWorkspace(taskId);
					}),
				),
			);
		})();
	}, [
		cleanupTaskWorkspace,
		selectedTaskId,
		setBoard,
		setIsClearTrashDialogOpen,
		setSelectedTaskId,
		setSessions,
		stopTaskSession,
		trashTaskIds,
	]);

	const resetBoardInteractionsState = useCallback(() => {
		moveToTrashLoadingByIdRef.current = {};
		setMoveToTrashLoadingById({});
		resetProgrammaticCardMoves();
		setIsClearTrashDialogOpen(false);
	}, [resetProgrammaticCardMoves, setIsClearTrashDialogOpen]);

	useEffect(() => {
		resetBoardInteractionsState();
	}, [currentProjectId, resetBoardInteractionsState]);

	return {
		handleProgrammaticCardMoveReady,
		confirmMoveTaskToTrash,
		handleDragEnd,
		handleStartTask,
		handleDetailTaskDragEnd,
		handleCardSelect,
		handleMoveToTrash,
		handleMoveReviewCardToTrash,
		handleRestoreTaskFromTrash,
		handleOpenClearTrash,
		handleConfirmClearTrash,
		handleAddReviewComments,
		handleSendReviewComments,
		moveToTrashLoadingById,
		trashTaskCount,
	};
}

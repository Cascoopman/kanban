import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useRef } from "react";

import { getDetailTerminalTaskId } from "@/hooks/use-terminal-panels";
import { findCardSelection, moveTaskToColumn } from "@/state/board-state";
import type { BoardCard, BoardColumnId, BoardData } from "@/types";
import { getNextDetailTaskIdAfterTrashMove } from "@/utils/detail-view-task-order";

interface RequestMoveTaskToTrashOptions {
	optimisticMoveApplied?: boolean;
	skipWorkingChangeWarning?: boolean;
}

export function useTaskTrashActions({
	board,
	setBoard,
	setSelectedTaskId,
	stopTaskSession,
	cleanupTaskWorkspace,
}: {
	board: BoardData;
	setBoard: Dispatch<SetStateAction<BoardData>>;
	setSelectedTaskId: Dispatch<SetStateAction<string | null>>;
	stopTaskSession: (taskId: string) => Promise<void>;
	cleanupTaskWorkspace: (taskId: string) => Promise<unknown>;
}): {
	confirmMoveTaskToTrash: (task: BoardCard, currentBoard?: BoardData) => Promise<void>;
	requestMoveTaskToTrash: (
		taskId: string,
		fromColumnId: BoardColumnId,
		options?: RequestMoveTaskToTrashOptions,
	) => Promise<void>;
} {
	const boardRef = useRef(board);

	useEffect(() => {
		boardRef.current = board;
	}, [board]);

	const performMoveTaskToTrash = useCallback(
		async (task: BoardCard, currentBoard?: BoardData): Promise<void> => {
			const boardBeforeTrash = currentBoard ?? boardRef.current;
			const trashed = moveTaskToColumn(boardBeforeTrash, task.id, "trash", { insertAtTop: true });
			if (trashed.moved) {
				setBoard((currentBoardState) => {
					const latestTrashResult = moveTaskToColumn(currentBoardState, task.id, "trash", { insertAtTop: true });
					return latestTrashResult.moved ? latestTrashResult.board : currentBoardState;
				});
				setSelectedTaskId((currentSelectedTaskId) =>
					currentSelectedTaskId === task.id
						? getNextDetailTaskIdAfterTrashMove(boardBeforeTrash, task.id)
						: currentSelectedTaskId,
				);
			}

			await Promise.all([stopTaskSession(task.id), stopTaskSession(getDetailTerminalTaskId(task.id))]);
			await cleanupTaskWorkspace(task.id);
		},
		[cleanupTaskWorkspace, setBoard, setSelectedTaskId, stopTaskSession],
	);

	const requestMoveTaskToTrash = useCallback(
		async (taskId: string, _fromColumnId: BoardColumnId, options?: RequestMoveTaskToTrashOptions): Promise<void> => {
			const boardSnapshot = boardRef.current;
			const selection = findCardSelection(boardSnapshot, taskId);
			if (!selection) {
				return;
			}

			if (options?.optimisticMoveApplied) {
				setSelectedTaskId((currentSelectedTaskId) =>
					currentSelectedTaskId === taskId
						? getNextDetailTaskIdAfterTrashMove(boardSnapshot, taskId)
						: currentSelectedTaskId,
				);
			}
			await performMoveTaskToTrash(selection.card, boardSnapshot);
		},
		[performMoveTaskToTrash, setSelectedTaskId],
	);

	return {
		confirmMoveTaskToTrash: performMoveTaskToTrash,
		requestMoveTaskToTrash,
	};
}

import type { Dispatch, SetStateAction } from "react";
import { useCallback } from "react";

import type { RuntimeAgentId } from "@/runtime/types";
import { addTaskToColumnWithResult } from "@/state/board-state";
import type { BoardData } from "@/types";

interface UseTaskEditorInput {
	board: BoardData;
	setBoard: Dispatch<SetStateAction<BoardData>>;
	defaultTaskBranchRef: string;
	selectedAgentId: RuntimeAgentId | null;
}

export interface CreatedTask {
	taskId: string;
}

export interface UseTaskEditorResult {
	handleCreateTask: () => CreatedTask | null;
}

export function useTaskEditor({
	board,
	setBoard,
	defaultTaskBranchRef,
	selectedAgentId,
}: UseTaskEditorInput): UseTaskEditorResult {
	const handleCreateTask = useCallback((): CreatedTask | null => {
		if (!defaultTaskBranchRef) {
			return null;
		}
		const created = addTaskToColumnWithResult(board, "in_progress", {
			title: "New task",
			startInPlanMode: false,
			agentId: selectedAgentId ?? undefined,
			baseRef: defaultTaskBranchRef,
		});
		setBoard(created.board);
		return { taskId: created.task.id };
	}, [board, defaultTaskBranchRef, selectedAgentId, setBoard]);

	return {
		handleCreateTask,
	};
}

import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useState } from "react";

import type { CreatedTask } from "@/hooks/use-task-editor";
import type { StartTaskSessionOptions } from "@/hooks/use-task-sessions";
import { findCardSelection } from "@/state/board-state";
import type { BoardData } from "@/types";

interface UseTaskStartActionsInput {
	board: BoardData;
	handleCreateTask: () => CreatedTask | null;
	handleStartTask: (taskId: string, options?: StartTaskSessionOptions) => void;
	setSelectedTaskId: Dispatch<SetStateAction<string | null>>;
}

export interface UseTaskStartActionsResult {
	handleCreateStartAndOpenTask: () => string | null;
}

export function useTaskStartActions({
	board,
	handleCreateTask,
	handleStartTask,
	setSelectedTaskId,
}: UseTaskStartActionsInput): UseTaskStartActionsResult {
	const [pendingTaskStartAfterCreate, setPendingTaskStartAfterCreate] = useState<CreatedTask | null>(null);

	const handleCreateStartAndOpenTask = useCallback((): string | null => {
		const createdTask = handleCreateTask();
		if (!createdTask) {
			return null;
		}
		setPendingTaskStartAfterCreate(createdTask);
		setSelectedTaskId(createdTask.taskId);
		return createdTask.taskId;
	}, [handleCreateTask, setSelectedTaskId]);

	useEffect(() => {
		if (!pendingTaskStartAfterCreate) {
			return;
		}
		const selection = findCardSelection(board, pendingTaskStartAfterCreate.taskId);
		if (selection?.column.id !== "in_progress") {
			return;
		}
		handleStartTask(pendingTaskStartAfterCreate.taskId);
		setPendingTaskStartAfterCreate(null);
	}, [board, handleStartTask, pendingTaskStartAfterCreate]);

	return {
		handleCreateStartAndOpenTask,
	};
}

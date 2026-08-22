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
	handleStartAllBacklogTasks: (taskIds?: string[]) => void;
	setSelectedTaskId: Dispatch<SetStateAction<string | null>>;
}

export interface UseTaskStartActionsResult {
	handleCreateStartAndOpenTask: () => string | null;
	handleStartTaskFromBoard: (taskId: string) => void;
	handleStartAllBacklogTasksFromBoard: () => void;
}

export function getStartableBacklogTaskIds(board: BoardData): string[] {
	const allBacklogTasks = new Set<string>();
	const allInProgressTasks = new Set<string>();
	const startableTaskIds: string[] = [];

	const backlogCards = board.columns.find((column) => column.id === "backlog")?.cards;
	const inProgressTasks = board.columns.find((column) => column.id === "in_progress")?.cards;

	backlogCards?.forEach((card) => {
		allBacklogTasks.add(card.id);
	});
	inProgressTasks?.forEach((card) => {
		allInProgressTasks.add(card.id);
	});

	backlogCards?.forEach((card) => {
		const dependency = board.dependencies.find((d) => d.fromTaskId === card.id);
		const isChildTaskInBacklog = dependency && allBacklogTasks.has(dependency.toTaskId);
		const isChildTaskInProgress = dependency && allInProgressTasks.has(dependency.toTaskId);

		if (!isChildTaskInBacklog && !isChildTaskInProgress) {
			startableTaskIds.push(card.id);
		}
	});

	return startableTaskIds;
}

export function useTaskStartActions({
	board,
	handleCreateTask,
	handleStartTask,
	handleStartAllBacklogTasks,
	setSelectedTaskId,
}: UseTaskStartActionsInput): UseTaskStartActionsResult {
	const [pendingTaskStartAfterCreate, setPendingTaskStartAfterCreate] = useState<CreatedTask | null>(null);

	const startBacklogTasks = useCallback(
		(taskIds: string[]) => {
			const backlogTaskIds = [...new Set(taskIds.filter((taskId) => taskId.trim().length > 0))].filter((taskId) => {
				const selection = findCardSelection(board, taskId);
				return selection?.column.id === "backlog";
			});

			if (backlogTaskIds.length === 0) {
				return;
			}

			if (backlogTaskIds.length === 1) {
				const firstTaskId = backlogTaskIds[0];
				if (!firstTaskId) {
					return;
				}
				handleStartTask(firstTaskId);
				return;
			}
			handleStartAllBacklogTasks(backlogTaskIds);
		},
		[board, handleStartAllBacklogTasks, handleStartTask],
	);

	const handleStartTaskFromBoard = useCallback(
		(taskId: string) => {
			const selection = findCardSelection(board, taskId);
			if (!selection || selection.column.id !== "backlog") {
				handleStartTask(taskId);
				return;
			}
			startBacklogTasks([taskId]);
		},
		[board, handleStartTask, startBacklogTasks],
	);

	const handleStartAllBacklogTasksFromBoard = useCallback(() => {
		const backlogTaskIds = getStartableBacklogTaskIds(board);

		if (backlogTaskIds.length === 0) {
			return;
		}
		startBacklogTasks(backlogTaskIds);
	}, [board, startBacklogTasks]);

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
		if (selection?.column.id !== "backlog") {
			return;
		}
		handleStartTask(pendingTaskStartAfterCreate.taskId, {
			initialPrompt: pendingTaskStartAfterCreate.prompt,
			images: pendingTaskStartAfterCreate.images,
		});
		setPendingTaskStartAfterCreate(null);
	}, [board, handleStartTask, pendingTaskStartAfterCreate]);

	return {
		handleCreateStartAndOpenTask,
		handleStartTaskFromBoard,
		handleStartAllBacklogTasksFromBoard,
	};
}

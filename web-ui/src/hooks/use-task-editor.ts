import type { Dispatch, SetStateAction } from "react";
import { useCallback } from "react";

import type { RuntimeAgentId } from "@/runtime/types";
import { addTaskToColumnWithResult, updateTaskTitle } from "@/state/board-state";
import { toTelemetrySelectedAgentId, trackTaskCreated } from "@/telemetry/events";
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
	handleSaveTaskTitle: (taskId: string, title: string) => void;
	handleCreateTask: () => CreatedTask | null;
}

export function useTaskEditor({
	board,
	setBoard,
	defaultTaskBranchRef,
	selectedAgentId,
}: UseTaskEditorInput): UseTaskEditorResult {
	const handleSaveTaskTitle = useCallback(
		(taskId: string, title: string) => {
			setBoard((currentBoard) => {
				const updated = updateTaskTitle(currentBoard, taskId, title);
				return updated.updated ? updated.board : currentBoard;
			});
		},
		[setBoard],
	);

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
		trackTaskCreated({
			selected_agent_id: toTelemetrySelectedAgentId(selectedAgentId),
			start_in_plan_mode: false,
		});
		return { taskId: created.task.id };
	}, [board, defaultTaskBranchRef, selectedAgentId, setBoard]);

	return {
		handleSaveTaskTitle,
		handleCreateTask,
	};
}
